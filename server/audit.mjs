import { randomUUID } from 'node:crypto'

/**
 * 轻量审计写入。管理台通过只读的 /admin/audit 查询。
 * 审计失败不能影响主流程，因此所有异常只记录到服务端日志。
 */
export function recordAudit(
  db,
  { actorId = null, action, targetType = null, targetId = null, meta = {}, ip = '' },
) {
  try {
    db.prepare(
      `INSERT INTO audit_logs
         (id, actor_id, action, target_type, target_id, meta, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      actorId,
      action,
      targetType,
      targetId,
      JSON.stringify(meta ?? {}),
      String(ip ?? '').slice(0, 64),
      new Date().toISOString(),
    )
  } catch (err) {
    console.error('[audit] 写入失败', action, err)
  }
}
