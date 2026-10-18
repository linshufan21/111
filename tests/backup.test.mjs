import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDb } from '../server/db.mjs'
import { createBackup, inspectDatabase } from '../scripts/backup.mjs'
import { restoreBackup } from '../scripts/restore.mjs'
import { exportCsv } from '../scripts/export-csv.mjs'

test('backup, clear, restore and CSV export keep exact counts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dajia-backup-'))
  const dbPath = join(dir, 'app.db')
  const backupDir = join(dir, 'backups')
  const csvDir = join(dir, 'exports')
  try {
    const db = createDb(dbPath)
    const now = new Date().toISOString()
    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('u1', '备份用户', 'backup@example.com', 'hash', 'salt', now)
    db.prepare(
      `INSERT INTO questions
         (id, user_id, title, description, category, closes_at, anonymous, featured, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`,
    ).run('q1', 'u1', '备份问题', '说明', '其他', null, now)
    db.prepare(
      `INSERT INTO votes
         (id, question_id, user_id, choice, reason, anonymous, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    ).run('v1', 'q1', 'u1', 'yes', '备份理由', now, now)
    db.close()

    const backup = createBackup({ dbPath, outDir: backupDir, retentionDays: 14 })
    assert.deepEqual(backup.counts, {
      users: 1,
      questions: 1,
      votes: 1,
      reports: 0,
      notifications: 0,
    })
    assert.ok(readFileSync(backup.file).length > 0)

    const empty = createDb(dbPath)
    empty.exec('DELETE FROM votes; DELETE FROM questions; DELETE FROM users;')
    empty.close()
    assert.equal(inspectDatabase(dbPath).users, 0)

    const restored = restoreBackup({ backupPath: backup.file, dbPath, force: true })
    assert.deepEqual(restored.counts, backup.counts)
    assert.ok(restored.safety)

    const exported = exportCsv({ dbPath, outDir: csvDir })
    assert.equal(exported.questions, 1)
    assert.equal(exported.votes, 1)
    assert.match(readFileSync(exported.questionsFile, 'utf8'), /备份问题/)
    assert.match(readFileSync(exported.votesFile, 'utf8'), /备份理由/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
