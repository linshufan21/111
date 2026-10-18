import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'

export const SESSION_COOKIE = 'dd_session'
const SESSION_DAYS = 30
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000

export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(password, salt, 64).toString('hex')
  return { hash, salt }
}

export function verifyPassword(password, salt, expectedHex) {
  const actual = scryptSync(password, salt, 64)
  const expected = Buffer.from(expectedHex, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function createSession(db, userId, meta = {}) {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_MS)
  db.prepare(
    `INSERT INTO sessions
       (id, token_hash, user_id, expires_at, created_at, user_agent, ip, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    sha256(token),
    userId,
    expires.toISOString(),
    now.toISOString(),
    String(meta.userAgent ?? '').slice(0, 300),
    String(meta.ip ?? '').slice(0, 64),
    now.toISOString(),
  )
  return { token, maxAge: SESSION_DAYS * 24 * 60 * 60 }
}

export function destroySession(db, token) {
  if (!token) return
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token))
}

export function sessionUser(db, token) {
  if (!token) return null
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.email, u.avatar_hue, u.role, u.status, u.created_at,
              u.email_verified_at, s.expires_at, s.token_hash, s.last_seen_at
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .get(sha256(token))
  if (!row) return null
  if (new Date(row.expires_at).getTime() < Date.now() || row.status !== 'active') {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(row.token_hash)
    return null
  }
  // 每个请求都写库太浪费；五分钟更新一次“最近活动”即可
  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(
      new Date().toISOString(),
      row.token_hash,
    )
  }
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatarHue: row.avatar_hue,
    role: row.role,
    status: row.status,
    emailVerified: Boolean(row.email_verified_at),
    emailVerifiedAt: row.email_verified_at ?? null,
    createdAt: row.created_at,
  }
}

export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (!key) continue
    try {
      out[key] = decodeURIComponent(value)
    } catch {
      out[key] = value
    }
  }
  return out
}

export function sessionCookie(token, maxAge, secure = false) {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ]
  if (secure) bits.push('Secure')
  return bits.join('; ')
}

export function clearCookie(secure = false) {
  const bits = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) bits.push('Secure')
  return bits.join('; ')
}

/**
 * 追加 Set-Cookie，并按 Cookie 名替换旧值。
 * Node 的 res.writeHead 会覆盖同名字段，因此统一先写入响应头再输出。
 */
export function appendSetCookie(res, cookie) {
  const name = String(cookie).split('=', 1)[0].trim()
  const current = res.getHeader('Set-Cookie')
  const list = current
    ? (Array.isArray(current) ? current.map(String) : [String(current)])
    : []
  const kept = list.filter((item) => item.split('=', 1)[0].trim() !== name)
  kept.push(String(cookie))
  res.setHeader('Set-Cookie', kept)
}
