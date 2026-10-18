import { randomBytes, randomUUID } from 'node:crypto'
import { sha256 } from './auth.mjs'

export const PURPOSE_EMAIL_VERIFY = 'email_verify'
export const PURPOSE_PASSWORD_RESET = 'password_reset'
export const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000
export const RESEND_COOLDOWN_MS = 60 * 1000

const nowIso = () => new Date().toISOString()

/**
 * 生成一次性 token；同一用户同一 purpose 的旧 token 立即作废。
 * 数据库只保存 token 的 SHA-256，明文只出现在邮件/开发日志里。
 */
export function issueToken(db, userId, purpose, ttlMs = EMAIL_TOKEN_TTL_MS) {
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString()
  const token = randomBytes(32).toString('base64url')

  db.prepare(
    'UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
  ).run(createdAt, userId, purpose)
  db.prepare(
    'DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND expires_at < ?',
  ).run(userId, purpose, createdAt)
  db.prepare(
    `INSERT INTO auth_tokens (id, user_id, purpose, token_hash, expires_at, used_at, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(randomUUID(), userId, purpose, sha256(token), expiresAt, createdAt)

  return { token, expiresAt, createdAt }
}

export function findToken(db, token, purpose) {
  if (!token) return null
  return (
    db
      .prepare(
        `SELECT t.id, t.user_id, t.purpose, t.expires_at, t.used_at, t.created_at,
                u.username, u.email, u.status AS user_status, u.email_verified_at
           FROM auth_tokens t JOIN users u ON u.id = t.user_id
          WHERE t.token_hash = ? AND t.purpose = ?`,
      )
      .get(sha256(token), purpose) ?? null
  )
}

export function lastToken(db, userId, purpose) {
  return (
    db
      .prepare(
        `SELECT id, created_at, expires_at, used_at
           FROM auth_tokens
          WHERE user_id = ? AND purpose = ?
          ORDER BY created_at DESC LIMIT 1`,
      )
      .get(userId, purpose) ?? null
  )
}

export function tokenState(row, now = Date.now()) {
  if (!row) return 'invalid'
  if (row.used_at) return 'used'
  if (new Date(row.expires_at).getTime() < now) return 'expired'
  if (row.user_status !== 'active') return 'invalid'
  return 'valid'
}

export function markUsed(db, tokenId, usedAt = nowIso()) {
  return db
    .prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(usedAt, tokenId)
}

export function markAllUsed(db, userId, purpose, usedAt = nowIso()) {
  return db
    .prepare(
      'UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL',
    )
    .run(usedAt, userId, purpose)
}

export function deleteTokensForUser(db, userId) {
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(userId)
}
