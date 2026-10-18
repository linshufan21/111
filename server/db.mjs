import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { ensureSchemaMeta, getSchemaInfo, SCHEMA_NAME, SCHEMA_VERSION } from './schema-meta.mjs'

export { getSchemaInfo, SCHEMA_NAME, SCHEMA_VERSION }

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DB = join(here, 'data', 'app.db')

function ensureColumn(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
    return true
  }
  return false
}

/**
 * Day 7：举报记录要在问题被删除后仍保留，因此 question_id 改为
 * ON DELETE SET NULL，并增加标题/作者快照。这里重建旧表而不丢数据。
 */
function migrateReports(db) {
  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports'")
    .get()
  if (!table) return
  const cols = db.prepare('PRAGMA table_info(reports)').all()
  const hasSnapshot = cols.some((c) => c.name === 'question_title')
  const questionFk = db
    .prepare('PRAGMA foreign_key_list(reports)')
    .all()
    .find((fk) => fk.from === 'question_id')
  if (hasSnapshot && questionFk?.on_delete === 'SET NULL') return

  db.exec('PRAGMA foreign_keys = OFF')
  try {
    db.exec('BEGIN IMMEDIATE')
    db.exec('ALTER TABLE reports RENAME TO reports_old')
    db.exec(`
      CREATE TABLE reports (
        id          TEXT PRIMARY KEY,
        reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        question_id TEXT REFERENCES questions(id) ON DELETE SET NULL,
        question_title TEXT NOT NULL DEFAULT '',
        question_author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason      TEXT NOT NULL CHECK (reason IN ('spam', 'abuse', 'privacy', 'misleading', 'other')),
        detail      TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved', 'rejected')),
        handled_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
        handled_at  TEXT,
        created_at  TEXT NOT NULL,
        UNIQUE (question_id, reporter_id)
      )
    `)
    db.exec(`
      INSERT INTO reports
        (id, reporter_id, question_id, question_title, question_author_id,
         reason, detail, status, handled_by, handled_at, created_at)
      SELECT r.id, r.reporter_id, r.question_id, COALESCE(q.title, ''), q.user_id,
             r.reason, r.detail, r.status, r.handled_by, r.handled_at, r.created_at
        FROM reports_old r
        LEFT JOIN questions q ON q.id = r.question_id
    `)
    db.exec('DROP TABLE reports_old')
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports(reporter_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_reports_question ON reports(question_id, created_at DESC);
    `)
    db.exec('COMMIT')
  } catch (err) {
    try {
      db.exec('ROLLBACK')
    } catch {
      // 已经回滚过
    }
    throw err
  } finally {
    db.exec('PRAGMA foreign_keys = ON')
  }
}

export function createDb(dbPath = process.env.DB_PATH || DEFAULT_DB) {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'))
  migrateReports(db)

  // 轻量迁移：兼容已经创建过的旧库
  ensureColumn(db, 'users', 'role', "role TEXT NOT NULL DEFAULT 'user'")
  ensureColumn(db, 'users', 'status', "status TEXT NOT NULL DEFAULT 'active'")
  const verifiedColumnAdded = ensureColumn(db, 'users', 'email_verified_at', 'email_verified_at TEXT')
  ensureColumn(db, 'users', 'failed_login_count', 'failed_login_count INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'users', 'locked_until', 'locked_until TEXT')
  ensureColumn(db, 'users', 'deleted_at', 'deleted_at TEXT')
  ensureColumn(db, 'questions', 'featured', 'featured INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'questions', 'close_notified_at', 'close_notified_at TEXT')
  ensureColumn(db, 'sessions', 'id', 'id TEXT')
  ensureColumn(db, 'sessions', 'user_agent', "user_agent TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'ip', "ip TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'last_seen_at', 'last_seen_at TEXT')

  // 老库第一次加列时，把既有账号视为已验证，避免升级后突然不能发帖。
  if (verifiedColumnAdded) {
    db.exec("UPDATE users SET email_verified_at = created_at WHERE status <> 'deleted'")
  }

  // 旧会话补一个稳定的公开 id；token_hash 永远不对外暴露
  db.exec("UPDATE sessions SET id = lower(hex(randomblob(16))) WHERE id IS NULL OR id = ''")
  db.exec('UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at IS NULL')
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_id ON sessions(id)')
  db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)')

  // Day 14：记录迁移版本；旧库首次启动时引导到当前版本。
  ensureSchemaMeta(db)
  return db
}
