#!/usr/bin/env node
/**
 * 生产环境管理员初始化：不写入任何默认密码。
 *
 *   ADMIN_USERNAME=admin ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' \
 *     node scripts/create-admin.mjs
 *
 * 已存在同名/同邮箱账号时默认报错；--force 会重置该账号密码并提升为管理员。
 */
import { randomUUID } from 'node:crypto'
import { createDb } from '../server/db.mjs'
import { hashPassword } from '../server/auth.mjs'

const COMMON = new Set([
  'admin1234',
  'password123',
  '12345678',
  '123456789',
  'qwerty123',
  'admin123456',
  'dajia1234',
])

function parseArgs(argv) {
  const options = { username: '', email: '', force: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`)
      i += 1
      return value
    }
    if (arg === '--username') options.username = next()
    else if (arg === '--email') options.email = next()
    else if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function fail(message) {
  console.error(`[create-admin] ${message}`)
  process.exitCode = 1
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(`用法：node scripts/create-admin.mjs [选项]

  --username <name>   管理员昵称（也可用 ADMIN_USERNAME）
  --email <mail>      管理员邮箱（也可用 ADMIN_EMAIL）
  --force             已存在时重置密码并提升为管理员

密码从 ADMIN_PASSWORD 读取，至少 12 位，不写入日志。`)
    return
  }

  const username = String(options.username || process.env.ADMIN_USERNAME || '').trim()
  const email = String(options.email || process.env.ADMIN_EMAIL || '')
    .trim()
    .toLowerCase()
  const password = String(process.env.ADMIN_PASSWORD || '')

  if (!/^[\w\u4e00-\u9fa5-]{2,20}$/u.test(username)) {
    fail('管理员昵称需为 2–20 位中英文、数字、下划线或短横线')
    return
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    fail('管理员邮箱格式不正确')
    return
  }
  if (password.length < 12 || password.length > 72) {
    fail('ADMIN_PASSWORD 需为 12–72 位')
    return
  }
  if (COMMON.has(password.toLowerCase()) || password.toLowerCase().includes(username.toLowerCase())) {
    fail('密码过于常见，或包含管理员昵称')
    return
  }

  const db = createDb()
  try {
    const existing = db
      .prepare(
        `SELECT id, role, email FROM users
          WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE`,
      )
      .get(username, email)
    const now = new Date().toISOString()
    const { hash, salt } = hashPassword(password)

    let id
    if (existing) {
      if (!options.force) {
        fail(`账号已存在（${existing.email}）；如确认重置，请加 --force`)
        return
      }
      id = existing.id
      db.prepare(
        `UPDATE users
            SET password_hash = ?, salt = ?, role = 'admin', status = 'active',
                email_verified_at = COALESCE(email_verified_at, ?), deleted_at = NULL
          WHERE id = ?`,
      ).run(hash, salt, now, id)
      console.log(`[create-admin] 已重置并提升为管理员：${username} <${email}>`)
    } else {
      id = randomUUID()
      db.prepare(
        `INSERT INTO users
           (id, username, email, password_hash, salt, avatar_hue, role, status, email_verified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'admin', 'active', ?, ?)`,
      ).run(id, username, email, hash, salt, Math.floor(Math.random() * 360), now, now)
      console.log(`[create-admin] 已创建管理员：${username} <${email}>`)
    }

    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, meta, ip, created_at)
       VALUES (?, NULL, 'admin.bootstrap', 'user', ?, ?, '', ?)`,
    ).run(randomUUID(), id, JSON.stringify({ via: 'create-admin-cli' }), now)
  } finally {
    db.close()
  }
}

try {
  main()
} catch (error) {
  console.error(`[create-admin] 失败：${error.message}`)
  process.exitCode = 1
}
