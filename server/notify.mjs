import { randomUUID } from 'node:crypto'

/**
 * 站内通知。举报处理结果、投票、理由与截止提醒都走这里。
 * 通知失败不能影响主流程，因此所有异常只记录到服务端日志。
 */
export function notifyUser(db, { id = randomUUID(), userId, type, payload = {} }) {
  try {
    db.prepare(
      `INSERT OR IGNORE INTO notifications (id, user_id, type, payload, read_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    ).run(
      id,
      userId,
      type,
      JSON.stringify(payload ?? {}),
      new Date().toISOString(),
    )
  } catch (err) {
    console.error('[notify] 写入失败', type, err)
  }
}

/** 找出已经截止但还没提醒作者的题目，写入一次 question.closed。 */
export function notifyClosingQuestions(db) {
  const now = new Date().toISOString()
  const rows = db
    .prepare(
      `SELECT id, user_id, title, closes_at
         FROM questions
        WHERE closes_at IS NOT NULL AND closes_at <= ? AND close_notified_at IS NULL`,
    )
    .all(now)
  for (const row of rows) {
    notifyUser(db, {
      id: `question-closed:${row.id}`,
      userId: row.user_id,
      type: 'question.closed',
      payload: {
        questionId: row.id,
        title: row.title,
        closesAt: row.closes_at,
      },
    })
    db.prepare('UPDATE questions SET close_notified_at = ? WHERE id = ?').run(now, row.id)
  }
  return rows.length
}

/** 进程内轻量 worker；测试环境与 NOTIFY_WORKER=0 时关闭。 */
export function startNotificationWorker(db) {
  if (process.env.NODE_ENV === 'test' || process.env.NOTIFY_WORKER === '0') return null
  notifyClosingQuestions(db)
  const timer = setInterval(() => {
    notifyClosingQuestions(db)
  }, 60_000)
  timer.unref?.()
  return timer
}
