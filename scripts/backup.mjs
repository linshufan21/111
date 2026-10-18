import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_DB = resolve(here, '..', 'server', 'data', 'app.db')
export const DEFAULT_BACKUP_DIR = resolve(here, '..', 'backups')
const TABLES = ['users', 'questions', 'votes', 'reports', 'notifications']

export function inspectDatabase(dbPath) {
  if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const check = db.prepare('PRAGMA quick_check').get()
    if (!check || check.quick_check !== 'ok') throw new Error(`数据库校验失败：${dbPath}`)
    const counts = {}
    for (const table of TABLES) {
      counts[table] = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0)
    }
    return counts
  } finally {
    db.close()
  }
}

function backupName(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.]/g, '')
  return `app-${stamp}.db`
}

export function pruneBackups(outDir, retentionDays) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return []
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const removed = []
  for (const name of readdirSync(outDir)) {
    if (!/^app-.*\.db$/.test(name)) continue
    const file = join(outDir, name)
    if (statSync(file).mtimeMs < cutoff) {
      unlinkSync(file)
      removed.push(file)
    }
  }
  return removed
}

/**
 * 用 VACUUM INTO 生成一致性快照，再打开快照做完整性校验和计数比对。
 */
export function createBackup({
  dbPath = DEFAULT_DB,
  outDir = DEFAULT_BACKUP_DIR,
  retentionDays = 14,
} = {}) {
  if (!existsSync(dbPath)) throw new Error(`数据库不存在：${dbPath}`)
  mkdirSync(outDir, { recursive: true })
  const source = inspectDatabase(dbPath)
  const file = join(outDir, backupName())
  if (existsSync(file)) throw new Error(`备份文件已存在：${file}`)

  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    db.prepare('VACUUM INTO ?').run(file)
  } finally {
    db.close()
  }

  try {
    chmodSync(file, 0o600)
  } catch {
    // Windows 不强制 POSIX 权限
  }
  const copied = inspectDatabase(file)
  if (JSON.stringify(source) !== JSON.stringify(copied)) {
    throw new Error(`备份计数不一致：${JSON.stringify({ source, copied })}`)
  }
  const removed = pruneBackups(outDir, retentionDays)
  return { file, counts: copied, removed }
}

function parseArgs(argv) {
  const options = {
    dbPath: process.env.DB_PATH || DEFAULT_DB,
    outDir: process.env.BACKUP_DIR || DEFAULT_BACKUP_DIR,
    retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 14),
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--db') options.dbPath = argv[++i]
    else if (arg === '--out') options.outDir = argv[++i]
    else if (arg === '--retention') options.retentionDays = Number(argv[++i])
  }
  return options
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const result = createBackup(parseArgs(process.argv.slice(2)))
    console.log(`[backup] ${result.file}`)
    console.log(`[backup] ${JSON.stringify(result.counts)}`)
    if (result.removed.length) console.log(`[backup] 清理旧备份 ${result.removed.length} 个`)
  } catch (err) {
    console.error('[backup] 失败：', err.message)
    process.exitCode = 1
  }
}
