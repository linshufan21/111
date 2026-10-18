import { accessSync, constants } from 'node:fs'
import { dirname, resolve } from 'node:path'

function checkDb(db) {
  const row = db.prepare('PRAGMA quick_check').get()
  if (!row || row.quick_check !== 'ok') {
    throw new Error('数据库完整性检查失败')
  }
}

function checkWritable(dbPath) {
  if (!dbPath || dbPath === ':memory:') return
  const absolute = resolve(dbPath)
  accessSync(dirname(absolute), constants.W_OK | constants.X_OK)
}

function checkSecret() {
  if (process.env.NODE_ENV !== 'production') return
  const secret = String(process.env.CSRF_SECRET || '').trim()
  if (secret.length < 32) {
    throw new Error('production 环境必须设置至少 32 字符的 CSRF_SECRET')
  }
  if (process.env.COOKIE_SECURE === '0') {
    console.warn('[startup] COOKIE_SECURE=0：仅适用于本地 HTTP 容器，公网必须使用 HTTPS')
  }
}

function checkMail() {
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.BREVO_API_KEY && !process.env.RESEND_API_KEY) {
    console.warn(
      '[startup] 未配置 BREVO_API_KEY / RESEND_API_KEY：注册验证邮件和找回密码邮件无法送达。' +
        '请参考 docs/LAUNCH.md 配置免费邮件额度。',
    )
  }
}

/** 启动自检：数据库完整、目录可写、生产密钥存在。失败直接退出。 */
export function validateStartup(db, dbPath) {
  checkDb(db)
  checkWritable(dbPath)
  checkSecret()
  checkMail()
}
