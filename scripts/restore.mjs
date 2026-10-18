import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DB, inspectDatabase } from './backup.mjs'

function parseArgs(argv) {
  const options = {
    backupPath: '',
    dbPath: process.env.DB_PATH || DEFAULT_DB,
    force: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--db') options.dbPath = argv[++i]
    else if (arg === '--force') options.force = true
    else if (!arg.startsWith('-') && !options.backupPath) options.backupPath = arg
  }
  return options
}

/**
 * 恢复备份。必须停止应用后执行，避免 SQLite 正在写入时替换文件。
 * --force 是显式确认；替换前会保留当前库的 .pre-restore-* 安全副本。
 */
export function restoreBackup({ backupPath, dbPath = DEFAULT_DB, force = false }) {
  const source = resolve(backupPath)
  const target = resolve(dbPath)
  if (!force) {
    throw new Error('恢复会覆盖当前数据库，请加 --force 并确认应用已停止')
  }
  if (!existsSync(source)) throw new Error(`备份不存在：${source}`)
  const expected = inspectDatabase(source)

  mkdirSync(dirname(target), { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:.]/g, '')
  const safety = `${target}.pre-restore-${stamp}`
  const temp = `${target}.restore-${stamp}`
  if (existsSync(target)) copyFileSync(target, safety)
  copyFileSync(source, temp)
  try {
    for (const suffix of ['', '-wal', '-shm']) rmSync(`${target}${suffix}`, { force: true })
    renameSync(temp, target)
  } finally {
    rmSync(temp, { force: true })
  }

  const actual = inspectDatabase(target)
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(`恢复后计数不一致：${JSON.stringify({ expected, actual })}`)
  }
  return { target, safety: existsSync(safety) ? safety : null, counts: actual }
}

const isMain =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2))
    if (!options.backupPath) throw new Error('用法：node scripts/restore.mjs <backup.db> --db <target.db> --force')
    const result = restoreBackup(options)
    console.log(`[restore] ${result.target}`)
    console.log(`[restore] ${JSON.stringify(result.counts)}`)
    if (result.safety) console.log(`[restore] 恢复前安全副本：${result.safety}`)
  } catch (err) {
    console.error('[restore] 失败：', err.message)
    process.exitCode = 1
  }
}
