#!/usr/bin/env node
/**
 * 上线前配置自检：在目标服务器加载 /etc/dajia/dajia.env 后运行。
 *
 *   sudo -u dajia bash -c 'set -a; . /etc/dajia/dajia.env; set +a; node /opt/dajia/scripts/preflight.mjs'
 *
 * 只输出配置状态，不打印任何密钥或密码。
 */
import { accessSync, constants, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { verifyPassword } from '../server/auth.mjs'
import { createDb, getSchemaInfo, SCHEMA_VERSION } from '../server/db.mjs'
import { mailStatus } from '../server/mail.mjs'

const failures = []
const warnings = []
const ok = []

function check(condition, message, { warn = false } = {}) {
  if (condition) ok.push(message)
  else if (warn) warnings.push(message)
  else failures.push(message)
}

function main() {
  const production = process.env.NODE_ENV === 'production'
  check(production, 'NODE_ENV=production', { warn: true })

  const appUrl = String(process.env.APP_URL || '')
  check(appUrl.startsWith('https://'), 'APP_URL 使用 https://', { warn: !production })
  check(String(process.env.CSRF_SECRET || '').length >= 32, 'CSRF_SECRET 至少 32 字符')
  check(process.env.COOKIE_SECURE !== '0', 'COOKIE_SECURE 未显式关闭')
  check(process.env.DEV_MAIL !== '1', 'DEV_MAIL 未开启')
  check(mailStatus() !== 'disabled', '邮件服务已配置（Brevo/Resend）', { warn: !production })

  const db = createDb()
  try {
    const schema = getSchemaInfo(db)
    check(schema?.version === SCHEMA_VERSION, `schema 版本为 v${SCHEMA_VERSION}`)

    const admins = db
      .prepare("SELECT id, username, password_hash, salt FROM users WHERE role = 'admin' AND status = 'active'")
      .all()
    check(admins.length > 0, '至少有一个启用的管理员账号')

    const defaultAdmin = admins.find((row) => verifyPassword('admin1234', row.salt, row.password_hash))
    check(!defaultAdmin, '管理员未使用默认密码 admin1234')

    const demo = db
      .prepare("SELECT password_hash, salt FROM users WHERE username = 'demo' COLLATE NOCASE")
      .get()
    const defaultDemo = demo && verifyPassword('demo1234', demo.salt, demo.password_hash)
    check(!defaultDemo, '不存在可登录的 demo/demo1234 演示账号')

    const backupDir = resolve(process.env.BACKUP_DIR || 'backups')
    mkdirSync(backupDir, { recursive: true })
    accessSync(backupDir, constants.W_OK)
    ok.push(`备份目录可写：${backupDir}`)

    const dbPath = process.env.DB_PATH || 'server/data/app.db'
    if (dbPath !== ':memory:') {
      const dataDir = dirname(resolve(dbPath))
      accessSync(dataDir, constants.W_OK)
      ok.push(`数据库目录可写：${dataDir}`)
    }
  } finally {
    db.close()
  }

  for (const item of ok) console.log(`[ok] ${item}`)
  for (const item of warnings) console.warn(`[warn] ${item}`)
  for (const item of failures) console.error(`[fail] ${item}`)

  if (failures.length) {
    console.error(`\n[preflight] ${failures.length} 项未通过；先修复再上线。`)
    process.exitCode = 1
    return
  }
  console.log(`\n[preflight] 通过${warnings.length ? `（${warnings.length} 项警告）` : ''}。`)
}

try {
  main()
} catch (error) {
  console.error(`[preflight] 无法完成检查：${error.message}`)
  process.exitCode = 1
}
