import { randomBytes, randomUUID } from 'node:crypto'
import {
  appendSetCookie,
  clearCookie,
  createSession,
  destroySession,
  hashPassword,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  sessionUser,
  sha256,
  verifyPassword,
} from './auth.mjs'
import {
  ApiError,
  bad,
  bool,
  conflict,
  email as emailField,
  isoDate,
  notFound,
  oneOf,
  rateLimited,
  readJson,
  str,
  unauthorized,
} from './validate.mjs'
import { contentText, reasonKey } from './content.mjs'
import {
  appOrigin,
  cookieSecure,
  devMailEnabled,
  postDailyLimit,
  requestIp,
  requestScheme,
  requiresVerifiedEmail,
  votePerMinute,
} from './config.mjs'
import { assertCsrf, readOrIssueCsrf, rotateCsrf } from './csrf.mjs'
import { healthPayload } from './health.mjs'
import { recordAudit } from './audit.mjs'
import { notifyUser } from './notify.mjs'
import {
  listDevMail,
  mailStatus,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './mail.mjs'
import {
  deleteTokensForUser,
  EMAIL_TOKEN_TTL_MS,
  findToken,
  issueToken,
  lastToken,
  markAllUsed,
  markUsed,
  PASSWORD_RESET_TTL_MS,
  PURPOSE_EMAIL_VERIFY,
  PURPOSE_PASSWORD_RESET,
  RESEND_COOLDOWN_MS,
  tokenState,
} from './tokens.mjs'

export const CATEGORIES = ['消费', '生活', '工作', '关系', '其他']
const SORTS = ['new', 'hot', 'controversial', 'closing']
const REPORT_REASONS = ['spam', 'abuse', 'privacy', 'misleading', 'other']
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const nowIso = () => new Date().toISOString()

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  const { 'Set-Cookie': cookies, ...rest } = headers
  if (cookies) {
    for (const cookie of Array.isArray(cookies) ? cookies : [cookies]) {
      appendSetCookie(res, cookie)
    }
  }
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...rest,
  })
  res.end(body)
}

function redirect(res, location) {
  res.writeHead(303, {
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex',
  })
  res.end()
}

function decodeCursor(cursor) {
  if (!cursor) return 0
  try {
    const raw = Buffer.from(String(cursor), 'base64url').toString('utf8')
    if (!raw.startsWith('o:')) return 0
    const n = Number(raw.slice(2))
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function encodeCursor(offset) {
  return Buffer.from(`o:${offset}`).toString('base64url')
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    avatarHue: row.avatar_hue ?? row.avatarHue ?? 18,
    role: row.role ?? 'user',
    status: row.status ?? 'active',
    emailVerified: Boolean(row.email_verified_at ?? row.emailVerified),
    emailVerifiedAt: row.email_verified_at ?? row.emailVerifiedAt ?? null,
    createdAt: row.created_at ?? row.createdAt ?? null,
  }
}

/** 已注销用户的内容仍然保留，但不再展示原昵称。 */
function publicAuthor(row) {
  if (row.user_status === 'deleted') {
    return { username: '已注销用户', avatarHue: 18, deleted: true }
  }
  return { username: row.username, avatarHue: row.avatar_hue ?? 18 }
}

function clientIp(req) {
  return requestIp(req)
}

function requestMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || ''),
    ip: clientIp(req),
  }
}

function deviceLabel(userAgent = '') {
  const ua = userAgent.toLowerCase()
  if (!ua) return '未知设备'
  let browser = '浏览器'
  if (ua.includes('edg/')) browser = 'Edge'
  else if (ua.includes('firefox/')) browser = 'Firefox'
  else if (ua.includes('chrome/') || ua.includes('crios/')) browser = 'Chrome'
  else if (ua.includes('safari/')) browser = 'Safari'
  let os = ''
  if (ua.includes('iphone')) os = 'iPhone'
  else if (ua.includes('ipad')) os = 'iPad'
  else if (ua.includes('android')) os = 'Android'
  else if (ua.includes('windows')) os = 'Windows'
  else if (ua.includes('mac os')) os = 'macOS'
  else if (ua.includes('linux')) os = 'Linux'
  return os ? `${browser} · ${os}` : browser
}

function currentTokenHash(req) {
  const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE]
  return token ? sha256(token) : ''
}

function sessionDTO(row, currentHash) {
  return {
    id: row.id,
    current: row.token_hash === currentHash,
    device: deviceLabel(row.user_agent),
    ip: row.ip || '',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at || row.created_at,
    expiresAt: row.expires_at,
  }
}

function statusOf(row) {
  return row.closes_at && row.closes_at <= nowIso() ? 'closed' : 'open'
}

function parseAuditMeta(raw) {
  try {
    const value = JSON.parse(raw || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function auditDTO(row) {
  return {
    id: row.id,
    action: row.action,
    actor: row.actor_id ? { id: row.actor_id, username: row.actor_username } : null,
    targetType: row.target_type ?? null,
    targetId: row.target_id ?? null,
    meta: parseAuditMeta(row.meta),
    ip: row.ip ?? '',
    createdAt: row.created_at,
  }
}

function reportDTO(row) {
  return {
    id: row.id,
    reason: row.reason,
    detail: row.detail ?? '',
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at ?? null,
  }
}

function adminReportDTO(row) {
  const question = row.question_id
    ? {
        id: row.question_id,
        title: row.question_title,
        status: statusOf(row),
        author: row.author_id
          ? { id: row.author_id, username: row.author_username }
          : null,
        reportCount: Number(row.report_count ?? 0),
      }
    : null
  return {
    ...reportDTO(row),
    question,
    questionTitle: row.question_title,
    reporter: { id: row.reporter_id, username: row.reporter_username },
    handledBy: row.handler_username ? { username: row.handler_username } : null,
  }
}

function notificationDTO(row) {
  let payload = {}
  try {
    const parsed = JSON.parse(row.payload || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed
  } catch {
    payload = {}
  }
  return {
    id: row.id,
    type: row.type,
    payload,
    readAt: row.read_at ?? null,
    createdAt: row.created_at,
  }
}

function questionDTO(db, row, userId) {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(choice = 'yes'), 0) AS yes,
              COALESCE(SUM(choice = 'no'), 0) AS no,
              COALESCE(SUM(CASE WHEN reason <> '' THEN 1 ELSE 0 END), 0) AS reasons
         FROM votes WHERE question_id = ?`,
    )
    .get(row.id)
  const myVote = userId
    ? db
        .prepare(
          'SELECT choice, reason, anonymous, updated_at FROM votes WHERE question_id = ? AND user_id = ?',
        )
        .get(row.id, userId)
    : null
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    createdAt: row.created_at,
    closesAt: row.closes_at ?? null,
    status: statusOf(row),
    anonymous: Boolean(row.anonymous),
    featured: Boolean(row.featured),
    author: row.anonymous ? null : publicAuthor(row),
    counts: {
      yes: Number(counts?.yes ?? 0),
      no: Number(counts?.no ?? 0),
      total: Number(counts?.total ?? 0),
      reasons: Number(counts?.reasons ?? 0),
    },
    myVote: myVote
      ? { choice: myVote.choice, reason: myVote.reason ?? '', anonymous: Boolean(myVote.anonymous) }
      : null,
    isMine: Boolean(userId) && row.user_id === userId,
  }
}

function getQuestionRow(db, id) {
  return db
    .prepare(
      `SELECT q.id, q.user_id, q.title, q.description, q.category, q.closes_at,
              q.anonymous, q.featured, q.created_at, u.username, u.avatar_hue,
              u.status AS user_status
         FROM questions q JOIN users u ON u.id = q.user_id
        WHERE q.id = ?`,
    )
    .get(id)
}

function attachMyVotes(db, rows, userId) {
  if (!rows.length) return []
  if (!userId) return rows.map((row) => ({ row, vote: null }))
  const ids = rows.map((r) => r.id)
  const placeholders = ids.map(() => '?').join(',')
  const votes = db
    .prepare(
      `SELECT question_id, choice, reason FROM votes
        WHERE user_id = ? AND question_id IN (${placeholders})`,
    )
    .all(userId, ...ids)
  const map = new Map(votes.map((v) => [v.question_id, v]))
  return rows.map((row) => ({ row, vote: map.get(row.id) ?? null }))
}

function listQuestions(db, params, userId) {
  const { sort = 'new', category = '', q = '', cursor = '', limit = 12 } = params
  const where = []
  const args = []
  if (category && category !== 'all') {
    where.push('q.category = ?')
    args.push(category)
  }
  if (q) {
    where.push('(q.title LIKE ? OR q.description LIKE ?)')
    const like = `%${q.replace(/[%_]/g, '\\$&')}%`
    args.push(like, like)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const order = {
    new: 'q.created_at DESC, q.id DESC',
    hot: 'total DESC, q.created_at DESC',
    controversial:
      'CASE WHEN COUNT(v.id) = 0 THEN 1 ELSE 0 END ASC, ABS(COALESCE(SUM(CASE WHEN v.choice = \'yes\' THEN 1 WHEN v.choice = \'no\' THEN -1 ELSE 0 END), 0)) * 1.0 / (COUNT(v.id) + 0.0001) ASC, total DESC',
    closing:
      'CASE WHEN q.closes_at IS NULL THEN 1 ELSE 0 END ASC, q.closes_at ASC, q.created_at DESC',
  }[SORTS.includes(sort) ? sort : 'new']

  const offset = decodeCursor(cursor)
  const size = Math.min(Math.max(Number(limit) || 12, 1), 30)
  const rows = db
    .prepare(
      `SELECT q.id, q.user_id, q.title, q.description, q.category, q.closes_at,
              q.anonymous, q.featured, q.created_at, u.username, u.avatar_hue,
              u.status AS user_status,
              COUNT(v.id) AS total,
              SUM(CASE WHEN v.choice = 'yes' THEN 1 ELSE 0 END) AS yes,
              SUM(CASE WHEN v.choice = 'no' THEN 1 ELSE 0 END) AS no,
              SUM(CASE WHEN v.reason <> '' THEN 1 ELSE 0 END) AS reasons
         FROM questions q
         JOIN users u ON u.id = q.user_id
         LEFT JOIN votes v ON v.question_id = q.id
         ${whereSql}
        GROUP BY q.id
        ORDER BY q.featured DESC, ${order}
        LIMIT ? OFFSET ?`,
    )
    .all(...args, size + 1, offset)
  const hasMore = rows.length > size
  const page = rows.slice(0, size)
  const withVotes = attachMyVotes(db, page, userId)
  const items = withVotes.map(({ row, vote }) => ({
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    category: row.category,
    createdAt: row.created_at,
    closesAt: row.closes_at ?? null,
    status: statusOf(row),
    anonymous: Boolean(row.anonymous),
    featured: Boolean(row.featured),
    author: row.anonymous ? null : publicAuthor(row),
    counts: {
      yes: Number(row.yes ?? 0),
      no: Number(row.no ?? 0),
      total: Number(row.total ?? 0),
      reasons: Number(row.reasons ?? 0),
    },
    myVote: vote ? { choice: vote.choice, reason: vote.reason ?? '' } : null,
    isMine: Boolean(userId) && row.user_id === userId,
  }))
  return {
    items,
    nextCursor: hasMore ? encodeCursor(offset + size) : null,
  }
}

function reasonsFor(db, questionId, userId) {
  const rows = db
    .prepare(
      `SELECT v.choice, v.reason, v.anonymous, v.updated_at, v.user_id,
              u.username, u.avatar_hue, u.status AS user_status
         FROM votes v JOIN users u ON u.id = v.user_id
        WHERE v.question_id = ? AND v.reason <> ''
        ORDER BY v.updated_at DESC
        LIMIT 60`,
    )
    .all(questionId)
  return rows.map((r) => ({
    choice: r.choice,
    reason: r.reason,
    updatedAt: r.updated_at,
    mine: Boolean(userId) && r.user_id === userId,
    author: r.anonymous ? null : publicAuthor(r),
  }))
}

const loginAttempts = new Map()
const LOGIN_WINDOW_MS = 60_000
const LOGIN_ID_LIMIT = 10
const LOGIN_IP_LIMIT = 60
const LOGIN_MAX_FAILURES = 5
const LOGIN_LOCK_MS = 15 * 60_000

function bumpRate(key, limit) {
  const now = Date.now()
  const rec = loginAttempts.get(key)
  if (!rec || rec.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  rec.count += 1
  if (rec.count > limit) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '尝试次数过多，请稍后再试')
  }
}

function checkLoginRate(ip, identifier) {
  bumpRate(`ip:${ip}`, LOGIN_IP_LIMIT)
  bumpRate(`id:${ip}:${identifier.toLowerCase()}`, LOGIN_ID_LIMIT)
}

const voteEvents = new Map()

function assertPostRate(db, userId) {
  const limit = postDailyLimit()
  if (!limit) return
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const next = new Date(start)
  next.setUTCDate(next.getUTCDate() + 1)
  const count = Number(
    db
      .prepare('SELECT COUNT(*) AS n FROM questions WHERE user_id = ? AND created_at >= ?')
      .get(userId, start.toISOString())?.n ?? 0,
  )
  if (count >= limit) {
    const retryAfter = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 1000))
    throw rateLimited(
      `今天最多发起 ${limit} 个问题，请明天再来`,
      retryAfter,
      'POST_RATE_LIMITED',
    )
  }
}

function assertVoteRate(userId) {
  const limit = votePerMinute()
  if (!limit) return
  const now = Date.now()
  const windowMs = 60_000
  const recent = (voteEvents.get(userId) ?? []).filter((ts) => now - ts < windowMs)
  if (recent.length >= limit) {
    const retryAfter = Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000))
    throw rateLimited(
      `投票太频繁，请 ${retryAfter} 秒后再试`,
      retryAfter,
      'VOTE_RATE_LIMITED',
    )
  }
  recent.push(now)
  voteEvents.set(userId, recent)
  if (voteEvents.size > 5000) {
    for (const [key, events] of voteEvents) {
      if (!events.some((ts) => now - ts < windowMs)) voteEvents.delete(key)
    }
  }
}

function assertUniqueReason(db, userId, questionId, reason) {
  if (reason.length < 6) return
  const key = reasonKey(reason)
  if (!key) return
  const rows = db
    .prepare('SELECT reason FROM votes WHERE user_id = ? AND question_id <> ? LIMIT 100')
    .all(userId, questionId)
  if (rows.some((row) => reasonKey(row.reason) === key)) {
    throw new ApiError(
      400,
      'DUPLICATE_REASON',
      '这个理由已经用过，请换一个表达',
      'reason',
    )
  }
}

function currentUser(db, req) {
  const cookies = parseCookies(req.headers.cookie || '')
  return sessionUser(db, cookies[SESSION_COOKIE])
}

function requireUser(db, req) {
  const user = currentUser(db, req)
  if (!user) unauthorized()
  return user
}

function requireAdmin(db, req) {
  const user = requireUser(db, req)
  if (user.role !== 'admin') {
    throw new ApiError(403, 'FORBIDDEN', '需要管理员权限')
  }
  return user
}

function allowOrigin(req) {
  const raw = req.headers.origin
  if (!raw) return
  if (raw === 'null') {
    throw new ApiError(403, 'BAD_ORIGIN', '请求来源不被允许')
  }
  let origin = ''
  try {
    const parsed = new URL(String(raw))
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('unsupported protocol')
    }
    origin = parsed.origin
  } catch {
    throw new ApiError(403, 'BAD_ORIGIN', '请求来源不被允许')
  }

  let requestOrigin = ''
  try {
    requestOrigin = new URL(`${requestScheme(req)}://${req.headers.host || '127.0.0.1'}`).origin
  } catch {
    requestOrigin = ''
  }
  const configured = appOrigin()
  if (origin === requestOrigin || (configured && origin === configured)) return

  // Vite 开发服务器端口与 API 不同；只在非生产环境放行本机来源。
  if (
    process.env.NODE_ENV !== 'production' &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  ) {
    return
  }
  throw new ApiError(403, 'BAD_ORIGIN', '请求来源不被允许')
}

/** 登录/注册时换发会话，避免沿用请求里旧 Cookie 对应的 token。 */
function startSession(db, req, userId) {
  const oldToken = parseCookies(req.headers.cookie || '')[SESSION_COOKIE]
  if (oldToken) destroySession(db, oldToken)
  return createSession(db, userId, requestMeta(req))
}

export async function handleApi(db, req, res, url) {
  const path = url.pathname.replace(/^\/api/, '') || '/'
  const method = req.method || 'GET'

  // 所有写请求先过来源白名单，再做双提交 CSRF 校验。
  // 放在读取当前用户之前，恶意请求不触碰会话与请求体。
  if (WRITE_METHODS.has(method)) {
    allowOrigin(req)
    assertCsrf(req)
  }

  const user = currentUser(db, req)

  // ---------- health ----------
  if (path === '/health' && method === 'GET') {
    const health = healthPayload(db)
    return json(res, health.status === 'ok' ? 200 : 503, health)
  }

  // ---------- auth ----------
  if (path === '/csrf' && method === 'GET') {
    return json(res, 200, { token: readOrIssueCsrf(req, res) })
  }

  if (path === '/auth/register' && method === 'POST') {
    const body = await readJson(req)
    const username = contentText(body.username, { field: 'username', min: 2, max: 20 })
    if (!/^[\w\u4e00-\u9fa5-]+$/.test(username)) {
      bad('昵称只能包含中英文、数字、下划线或短横线', 'username')
    }
    const mail = emailField(body.email)
    const password = str(body.password, { field: 'password', min: 8, max: 72 })
    if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
      conflict('这个昵称已被使用', 'username')
    }
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(mail)) {
      conflict('这个邮箱已注册', 'email')
    }
    const { hash, salt } = hashPassword(password)
    const id = randomUUID()
    const hue = Math.floor(Math.random() * 360)
    db.prepare(
      'INSERT INTO users (id, username, email, password_hash, salt, avatar_hue, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(id, username, mail, hash, salt, hue, nowIso())
    const csrfToken = rotateCsrf(req, res)
    const session = startSession(db, req, id)

    let verificationSent = false
    try {
      const issued = issueToken(db, id, PURPOSE_EMAIL_VERIFY, EMAIL_TOKEN_TTL_MS)
      verificationSent = (
        await sendVerificationEmail(
          { id, username, email: mail },
          issued.token,
          issued.expiresAt,
        )
      ).sent
    } catch (err) {
      console.error('[auth] 验证邮件发送失败', err)
    }

    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id)
    recordAudit(db, {
      actorId: id,
      action: 'auth.register',
      targetType: 'user',
      targetId: id,
      ip: clientIp(req),
    })
    return json(
      res,
      201,
      { user: publicUser(row), verificationSent, csrfToken },
      { 'Set-Cookie': sessionCookie(session.token, session.maxAge, cookieSecure(req)) },
    )
  }

  if (path === '/auth/login' && method === 'POST') {
    const body = await readJson(req)
    const identifier = str(body.identifier, { field: 'identifier', min: 2, max: 120 })
    const password = str(body.password, { field: 'password', min: 1, max: 72 })
    const ip = clientIp(req) || 'local'
    checkLoginRate(ip, identifier)
    const row = db
      .prepare('SELECT * FROM users WHERE username = ? OR email = ?')
      .get(identifier, identifier.toLowerCase())

    if (row?.status === 'active' && row.locked_until) {
      const lockedUntil = new Date(row.locked_until).getTime()
      if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
        const minutes = Math.max(1, Math.ceil((lockedUntil - Date.now()) / 60_000))
        recordAudit(db, {
          actorId: row.id,
          action: 'auth.login.locked',
          targetType: 'user',
          targetId: row.id,
          meta: { minutes },
          ip,
        })
        throw new ApiError(429, 'ACCOUNT_LOCKED', `登录尝试过多，请 ${minutes} 分钟后再试`)
      }
    }

    const passwordOk = row ? verifyPassword(password, row.salt, row.password_hash) : false
    if (!row || !passwordOk) {
      if (row?.status === 'active') {
        const lockExpired = Boolean(
          row.locked_until && new Date(row.locked_until).getTime() <= Date.now(),
        )
        const failures = (lockExpired ? 0 : Number(row.failed_login_count ?? 0)) + 1
        if (failures >= LOGIN_MAX_FAILURES) {
          const lockedUntil = new Date(Date.now() + LOGIN_LOCK_MS).toISOString()
          db.prepare(
            'UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?',
          ).run(failures, lockedUntil, row.id)
          recordAudit(db, {
            actorId: row.id,
            action: 'auth.login.locked',
            targetType: 'user',
            targetId: row.id,
            meta: { failures },
            ip,
          })
          throw new ApiError(429, 'ACCOUNT_LOCKED', '登录尝试过多，账号已锁定 15 分钟')
        }
        db.prepare(
          'UPDATE users SET failed_login_count = ?, locked_until = NULL WHERE id = ?',
        ).run(failures, row.id)
        recordAudit(db, {
          actorId: row.id,
          action: 'auth.login.failed',
          targetType: 'user',
          targetId: row.id,
          meta: { failures },
          ip,
        })
      } else if (row) {
        recordAudit(db, {
          actorId: row.id,
          action: 'auth.login.failed',
          targetType: 'user',
          targetId: row.id,
          meta: { reason: 'inactive_account' },
          ip,
        })
      } else {
        recordAudit(db, {
          action: 'auth.login.failed',
          meta: { reason: 'unknown_identifier' },
          ip,
        })
      }
      throw new ApiError(401, 'BAD_CREDENTIALS', '账号或密码不正确', 'password')
    }

    if (row.status === 'deleted') {
      throw new ApiError(403, 'ACCOUNT_DELETED', '该账号已注销，无法登录')
    }
    if (row.status !== 'active') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '该账号已被停用，请联系管理员')
    }

    if (row.failed_login_count || row.locked_until) {
      db.prepare(
        'UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?',
      ).run(row.id)
    }
    recordAudit(db, {
      actorId: row.id,
      action: 'auth.login.success',
      targetType: 'user',
      targetId: row.id,
      ip,
    })
    const csrfToken = rotateCsrf(req, res)
    const session = startSession(db, req, row.id)
    return json(
      res,
      200,
      { user: publicUser(row), csrfToken },
      { 'Set-Cookie': sessionCookie(session.token, session.maxAge, cookieSecure(req)) },
    )
  }

  if (path === '/auth/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie || '')
    destroySession(db, cookies[SESSION_COOKIE])
    const csrfToken = rotateCsrf(req, res)
    return json(
      res,
      200,
      { ok: true, csrfToken },
      { 'Set-Cookie': clearCookie(cookieSecure(req)) },
    )
  }

  if (path === '/auth/me' && method === 'GET') {
    return json(res, 200, { user: user ?? null })
  }

  if (path === '/auth/forgot' && method === 'POST') {
    const body = await readJson(req)
    const mail = emailField(body.email)
    const row = db.prepare('SELECT * FROM users WHERE email = ?').get(mail)
    const ip = clientIp(req)

    // 无论邮箱是否存在都返回同样的结果，避免账号枚举
    if (!row || row.status !== 'active') {
      return json(res, 200, { ok: true })
    }

    const previous = lastToken(db, row.id, PURPOSE_PASSWORD_RESET)
    if (previous) {
      const elapsed = Date.now() - new Date(previous.created_at).getTime()
      if (Number.isFinite(elapsed) && elapsed < RESEND_COOLDOWN_MS) {
        return json(res, 200, { ok: true })
      }
    }

    const issued = issueToken(db, row.id, PURPOSE_PASSWORD_RESET, PASSWORD_RESET_TTL_MS)
    // 不等待外部邮件 API：否则「邮箱存在」的请求会明显更慢，形成账号枚举时间侧信道。
    let sent = mailStatus() !== 'disabled'
    try {
      sendPasswordResetEmail(row, issued.token, issued.expiresAt).catch((err) => {
        console.error('[auth] 重置密码邮件发送失败', err)
      })
    } catch (err) {
      sent = false
      console.error('[auth] 重置密码邮件发送失败', err)
    }
    recordAudit(db, {
      actorId: row.id,
      action: 'auth.password.reset_requested',
      targetType: 'user',
      targetId: row.id,
      meta: { sent },
      ip,
    })
    return json(res, 200, { ok: true })
  }

  if (path === '/auth/reset' && method === 'POST') {
    const body = await readJson(req)
    const token = str(body.token, { field: 'token', min: 10, max: 200 })
    const password = str(body.password, { field: 'password', min: 8, max: 72 })
    const row = findToken(db, token, PURPOSE_PASSWORD_RESET)
    if (tokenState(row) !== 'valid') {
      throw new ApiError(
        400,
        'INVALID_RESET_TOKEN',
        '重置链接无效或已过期，请重新申请',
        'token',
      )
    }

    const { hash, salt } = hashPassword(password)
    const ts = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      const marked = markUsed(db, row.id, ts)
      if (!Number(marked.changes)) {
        db.exec('ROLLBACK')
        throw new ApiError(
          400,
          'INVALID_RESET_TOKEN',
          '重置链接无效或已过期，请重新申请',
          'token',
        )
      }
      markAllUsed(db, row.user_id, PURPOSE_PASSWORD_RESET, ts)
      markAllUsed(db, row.user_id, PURPOSE_EMAIL_VERIFY, ts)
      db.prepare(
        `UPDATE users
            SET password_hash = ?, salt = ?, email_verified_at = COALESCE(email_verified_at, ?),
                failed_login_count = 0, locked_until = NULL
          WHERE id = ?`,
      ).run(hash, salt, ts, row.user_id)
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.user_id)
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        // 已经回滚过
      }
      throw err
    }

    recordAudit(db, {
      actorId: row.user_id,
      action: 'auth.password.reset',
      targetType: 'user',
      targetId: row.user_id,
      ip: clientIp(req),
    })
    const csrfToken = rotateCsrf(req, res)
    return json(
      res,
      200,
      { ok: true, csrfToken },
      { 'Set-Cookie': clearCookie(cookieSecure(req)) },
    )
  }

  if (path === '/auth/verify' && method === 'GET') {
    const token = url.searchParams.get('token') || ''
    const row = findToken(db, token, PURPOSE_EMAIL_VERIFY)
    const state = tokenState(row)
    if (state !== 'valid') {
      return redirect(res, `/verify-email?status=${state}`)
    }

    const verifiedAt = nowIso()
    db.exec('BEGIN IMMEDIATE')
    try {
      const marked = markUsed(db, row.id, verifiedAt)
      if (!Number(marked.changes)) {
        db.exec('ROLLBACK')
        return redirect(res, '/verify-email?status=used')
      }
      markAllUsed(db, row.user_id, PURPOSE_EMAIL_VERIFY, verifiedAt)
      db.prepare(
        'UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?) WHERE id = ? AND status = ?',
      ).run(verifiedAt, row.user_id, 'active')
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
    return redirect(res, '/verify-email?status=success')
  }

  if (path === '/auth/resend-verification' && method === 'POST') {
    const me = requireUser(db, req)
    if (me.emailVerified) {
      throw new ApiError(409, 'EMAIL_ALREADY_VERIFIED', '这个邮箱已经验证过了')
    }
    const previous = lastToken(db, me.id, PURPOSE_EMAIL_VERIFY)
    const sentCount = Number(
      db
        .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ? AND purpose = ?')
        .get(me.id, PURPOSE_EMAIL_VERIFY)?.n ?? 0,
    )
    // 注册时已经发过一封；从第二次发送开始执行 60 秒冷却
    if (previous && sentCount > 1) {
      const elapsed = Date.now() - new Date(previous.created_at).getTime()
      if (Number.isFinite(elapsed) && elapsed < RESEND_COOLDOWN_MS) {
        const seconds = Math.max(1, Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000))
        throw new ApiError(429, 'TOO_MANY_REQUESTS', `发送太频繁了，请 ${seconds} 秒后再试`)
      }
    }

    const issued = issueToken(db, me.id, PURPOSE_EMAIL_VERIFY, EMAIL_TOKEN_TTL_MS)
    let sent = false
    try {
      sent = (await sendVerificationEmail(me, issued.token, issued.expiresAt)).sent
    } catch (err) {
      console.error('[auth] 重发验证邮件失败', err)
    }
    if (!sent) {
      throw new ApiError(502, 'MAIL_SEND_FAILED', '验证邮件发送失败，请稍后再试')
    }
    return json(res, 200, { ok: true })
  }

  if (path === '/meta' && method === 'GET') {
    return json(res, 200, {
      requireEmailVerification: requiresVerifiedEmail(),
      devMail: devMailEnabled(),
    })
  }

  if (path === '/dev/mail' && method === 'GET') {
    if (!devMailEnabled()) notFound('开发邮件箱未启用')
    return json(res, 200, { items: listDevMail() })
  }

  // ---------- questions ----------
  if (path === '/questions' && method === 'GET') {
    const result = listQuestions(
      db,
      {
        sort: url.searchParams.get('sort') || 'new',
        category: url.searchParams.get('category') || 'all',
        q: (url.searchParams.get('q') || '').slice(0, 80),
        cursor: url.searchParams.get('cursor') || '',
        limit: url.searchParams.get('limit') || 12,
      },
      user?.id,
    )
    return json(res, 200, result)
  }

  if (path === '/questions' && method === 'POST') {
    const me = requireUser(db, req)
    if (requiresVerifiedEmail() && !me.emailVerified) {
      throw new ApiError(403, 'EMAIL_NOT_VERIFIED', '验证邮箱后才能发起投票')
    }
    assertPostRate(db, me.id)
    const body = await readJson(req)
    const title = contentText(body.title, { field: 'title', min: 4, max: 80 })
    const description = contentText(body.description, {
      field: 'description',
      min: 0,
      max: 500,
      required: false,
    })
    const category = oneOf(body.category || '其他', CATEGORIES, 'category')
    const closesAt = isoDate(body.closesAt, 'closesAt')
    if (closesAt && new Date(closesAt).getTime() <= Date.now() + 60_000) {
      bad('截止时间必须晚于现在', 'closesAt')
    }
    const id = randomUUID()
    db.prepare(
      `INSERT INTO questions (id, user_id, title, description, category, closes_at, anonymous, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, me.id, title, description, category, closesAt, bool(body.anonymous) ? 1 : 0, nowIso())
    const row = getQuestionRow(db, id)
    return json(res, 201, { question: questionDTO(db, row, me.id) })
  }

  const questionMatch = path.match(/^\/questions\/([A-Za-z0-9-]+)$/)
  if (questionMatch && method === 'GET') {
    const row = getQuestionRow(db, questionMatch[1])
    if (!row) notFound('这个问题不存在或已被删除')
    const myReport = user
      ? db
          .prepare(
            `SELECT id, reason, detail, status, created_at, handled_at
               FROM reports WHERE question_id = ? AND reporter_id = ?`,
          )
          .get(row.id, user.id)
      : null
    return json(res, 200, {
      question: questionDTO(db, row, user?.id),
      reasons: reasonsFor(db, row.id, user?.id),
      myReport: myReport ? reportDTO(myReport) : null,
    })
  }

  const reportMatch = path.match(/^\/questions\/([A-Za-z0-9-]+)\/report$/)
  if (reportMatch && method === 'POST') {
    const me = requireUser(db, req)
    const row = getQuestionRow(db, reportMatch[1])
    if (!row) notFound('这个问题不存在或已被删除')
    const body = await readJson(req)
    const reason = oneOf(body.reason, REPORT_REASONS, 'reason')
    const detail = contentText(body.detail, {
      field: 'detail',
      min: 0,
      max: 300,
      required: false,
    })
    if (reason === 'other' && detail.length < 5) {
      bad('选择「其他」时，请补充至少 5 个字的说明', 'detail')
    }

    const id = randomUUID()
    const ts = nowIso()
    const inserted = db
      .prepare(
        `INSERT INTO reports
           (id, reporter_id, question_id, question_title, question_author_id,
            reason, detail, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT(question_id, reporter_id) DO NOTHING`,
      )
      .run(id, me.id, row.id, row.title, row.user_id, reason, detail, ts)

    let reportRow
    let duplicate = false
    if (Number(inserted.changes)) {
      reportRow = db.prepare('SELECT * FROM reports WHERE id = ?').get(id)
      recordAudit(db, {
        actorId: me.id,
        action: 'report.created',
        targetType: 'question',
        targetId: row.id,
        meta: { reportId: id, reason, title: row.title },
        ip: clientIp(req),
      })
    } else {
      duplicate = true
      reportRow = db
        .prepare('SELECT * FROM reports WHERE question_id = ? AND reporter_id = ?')
        .get(row.id, me.id)
    }
    if (!reportRow) {
      throw new ApiError(409, 'REPORT_CONFLICT', '举报提交失败，请稍后再试')
    }
    return json(res, duplicate ? 200 : 201, {
      report: reportDTO(reportRow),
      duplicate,
    })
  }

  const voteMatch = path.match(/^\/questions\/([A-Za-z0-9-]+)\/vote$/)
  if (voteMatch) {
    const me = requireUser(db, req)
    const row = getQuestionRow(db, voteMatch[1])
    if (!row) notFound('这个问题不存在或已被删除')
    if (statusOf(row) === 'closed') {
      throw new ApiError(409, 'QUESTION_CLOSED', '这个问题已经截止，不能再投票')
    }
    assertVoteRate(me.id)
    if (method === 'POST') {
      const body = await readJson(req)
      const choice = oneOf(body.choice, ['yes', 'no'], 'choice')
      const reason = contentText(body.reason, {
        field: 'reason',
        min: 0,
        max: 200,
        required: false,
      })
      assertUniqueReason(db, me.id, row.id, reason)
      const anonymous = bool(body.anonymous) ? 1 : 0
      const existing = db
        .prepare('SELECT reason FROM votes WHERE question_id = ? AND user_id = ?')
        .get(row.id, me.id)
      const ts = nowIso()
      db.prepare(
        `INSERT INTO votes (id, question_id, user_id, choice, reason, anonymous, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(question_id, user_id) DO UPDATE SET
           choice = excluded.choice,
           reason = excluded.reason,
           anonymous = excluded.anonymous,
           updated_at = excluded.updated_at`,
      ).run(randomUUID(), row.id, me.id, choice, reason, anonymous, ts, ts)

      if (row.user_id !== me.id) {
        const meta = {
          questionId: row.id,
          title: row.title,
          choice,
          voter: anonymous ? null : me.username,
        }
        if (!existing) {
          notifyUser(db, {
            userId: row.user_id,
            type: 'question.vote',
            payload: meta,
          })
        }
        if (reason && reason !== (existing?.reason ?? '')) {
          notifyUser(db, {
            userId: row.user_id,
            type: 'question.reason',
            payload: meta,
          })
        }
      }
      return json(res, 200, { question: questionDTO(db, row, me.id) })
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM votes WHERE question_id = ? AND user_id = ?').run(row.id, me.id)
      return json(res, 200, { question: questionDTO(db, row, me.id) })
    }
  }

  // ---------- me ----------
  if (path === '/me/questions' && method === 'GET') {
    const me = requireUser(db, req)
    const rows = db
      .prepare(
        `SELECT q.id, q.user_id, q.title, q.description, q.category, q.closes_at,
                q.anonymous, q.featured, q.created_at, u.username, u.avatar_hue,
                u.status AS user_status
           FROM questions q JOIN users u ON u.id = q.user_id
          WHERE q.user_id = ?
          ORDER BY q.created_at DESC`,
      )
      .all(me.id)
    return json(res, 200, { items: rows.map((row) => questionDTO(db, row, me.id)) })
  }

  if (path === '/me/votes' && method === 'GET') {
    const me = requireUser(db, req)
    const rows = db
      .prepare(
        `SELECT q.id, q.user_id, q.title, q.description, q.category, q.closes_at,
                q.anonymous, q.featured, q.created_at, u.username, u.avatar_hue,
                u.status AS user_status
           FROM votes v
           JOIN questions q ON q.id = v.question_id
           JOIN users u ON u.id = q.user_id
          WHERE v.user_id = ?
          ORDER BY v.updated_at DESC`,
      )
      .all(me.id)
    return json(res, 200, { items: rows.map((row) => questionDTO(db, row, me.id)) })
  }

  if (path === '/me/reports' && method === 'GET') {
    const me = requireUser(db, req)
    const rows = db
      .prepare(
        `SELECT r.id, r.reason, r.detail, r.status, r.created_at, r.handled_at,
                r.question_id, COALESCE(q.title, r.question_title) AS question_title,
                q.closes_at
           FROM reports r LEFT JOIN questions q ON q.id = r.question_id
          WHERE r.reporter_id = ?
          ORDER BY r.created_at DESC`,
      )
      .all(me.id)
    return json(res, 200, {
      items: rows.map((row) => ({
        ...reportDTO(row),
        ...(row.question_id
          ? {
              question: {
                id: row.question_id,
                title: row.question_title,
                status: statusOf(row),
              },
            }
          : {}),
      })),
    })
  }

  if (path === '/me/notifications' && method === 'GET') {
    const me = requireUser(db, req)
    const rows = db
      .prepare(
        `SELECT id, type, payload, read_at, created_at
           FROM notifications
          WHERE user_id = ?
          ORDER BY CASE WHEN read_at IS NULL THEN 0 ELSE 1 END, created_at DESC
          LIMIT 20`,
      )
      .all(me.id)
    const unread = Number(
      db
        .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
        .get(me.id)?.n ?? 0,
    )
    return json(res, 200, { items: rows.map(notificationDTO), unread })
  }

  if (path === '/me/notifications/read' && method === 'POST') {
    const me = requireUser(db, req)
    const result = db
      .prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .run(nowIso(), me.id)
    return json(res, 200, { ok: true, read: Number(result.changes) })
  }

  // ---------- 账号自助 ----------
  if (path === '/me/password' && method === 'POST') {
    const me = requireUser(db, req)
    const body = await readJson(req)
    const currentPassword = str(body.currentPassword, {
      field: 'currentPassword',
      min: 1,
      max: 72,
    })
    const newPassword = str(body.newPassword, { field: 'newPassword', min: 8, max: 72 })
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id)
    if (!row || !verifyPassword(currentPassword, row.salt, row.password_hash)) {
      bad('当前密码不正确', 'currentPassword')
    }
    if (currentPassword === newPassword) {
      bad('新密码不能与当前密码相同', 'newPassword')
    }
    const { hash, salt } = hashPassword(newPassword)
    db.prepare(
      'UPDATE users SET password_hash = ?, salt = ?, failed_login_count = 0, locked_until = NULL WHERE id = ?',
    ).run(hash, salt, me.id)
    // 改密后所有旧会话立即失效，再为当前设备换发一枚新 token
    const revoked = db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id).changes
    recordAudit(db, {
      actorId: me.id,
      action: 'auth.password.change',
      targetType: 'user',
      targetId: me.id,
      ip: clientIp(req),
    })
    const csrfToken = rotateCsrf(req, res)
    const session = startSession(db, req, me.id)
    return json(
      res,
      200,
      { ok: true, revoked: Number(revoked), csrfToken },
      { 'Set-Cookie': sessionCookie(session.token, session.maxAge, cookieSecure(req)) },
    )
  }

  if (path === '/me/sessions' && method === 'GET') {
    const me = requireUser(db, req)
    const hash = currentTokenHash(req)
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(me.id, nowIso())
    const rows = db
      .prepare(
        `SELECT id, token_hash, user_agent, ip, expires_at, created_at, last_seen_at
           FROM sessions
          WHERE user_id = ?
          ORDER BY CASE WHEN token_hash = ? THEN 0 ELSE 1 END,
                   COALESCE(last_seen_at, created_at) DESC`,
      )
      .all(me.id, hash)
    return json(res, 200, { items: rows.map((row) => sessionDTO(row, hash)) })
  }

  if (path === '/me/sessions/revoke-others' && method === 'POST') {
    const me = requireUser(db, req)
    const hash = currentTokenHash(req)
    const result = db
      .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?')
      .run(me.id, hash)
    return json(res, 200, { ok: true, revoked: Number(result.changes) })
  }

  const sessionMatch = path.match(/^\/me\/sessions\/([A-Za-z0-9-]+)$/)
  if (sessionMatch && method === 'DELETE') {
    const me = requireUser(db, req)
    const row = db
      .prepare('SELECT id, token_hash FROM sessions WHERE id = ? AND user_id = ?')
      .get(sessionMatch[1], me.id)
    if (!row) notFound('这个登录记录不存在，可能已经退出')
    if (row.token_hash === currentTokenHash(req)) {
      bad('当前设备请使用右上角的退出登录')
    }
    db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(row.id, me.id)
    return json(res, 200, { ok: true })
  }

  if (path === '/me' && method === 'DELETE') {
    const me = requireUser(db, req)
    const body = await readJson(req)
    const confirm = str(body.confirm, { field: 'confirm', min: 1, max: 20 })
    if (confirm !== '注销') {
      bad('请输入「注销」以确认', 'confirm')
    }
    const password = str(body.password, { field: 'password', min: 1, max: 72 })
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(me.id)
    if (row?.role === 'admin') {
      throw new ApiError(403, 'ADMIN_PROTECTED', '管理员账号不能自助注销，请先移交管理员权限')
    }
    if (!row || !verifyPassword(password, row.salt, row.password_hash)) {
      bad('密码不正确', 'password')
    }
    const { hash, salt } = hashPassword(randomBytes(32).toString('hex'))
    db.prepare(
      `UPDATE users
          SET username = ?, email = ?, password_hash = ?, salt = ?,
              avatar_hue = 18, status = 'deleted', deleted_at = ?
        WHERE id = ?`,
    ).run(
      `已注销用户-${me.id.slice(0, 8)}`,
      `deleted-${me.id}@deleted.invalid`,
      hash,
      salt,
      nowIso(),
      me.id,
    )
    db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(me.id)
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(me.id)
    const csrfToken = rotateCsrf(req, res)
    return json(
      res,
      200,
      { ok: true, csrfToken },
      { 'Set-Cookie': clearCookie(cookieSecure(req)) },
    )
  }

  // ---------- admin ----------
  if (path.startsWith('/admin/')) {
    const admin = requireAdmin(db, req)

    if (path === '/admin/reports' && method === 'GET') {
      const rawStatus = url.searchParams.get('status') || 'pending'
      const status = ['pending', 'resolved', 'rejected', 'all'].includes(rawStatus)
        ? rawStatus
        : 'pending'
      const rawSort = url.searchParams.get('sort') || 'new'
      const sort = ['new', 'old', 'most'].includes(rawSort) ? rawSort : 'new'
      const q = (url.searchParams.get('q') || '').slice(0, 80)
      const rawPage = Number(url.searchParams.get('page') || 1)
      const rawLimit = Number(url.searchParams.get('limit') || 20)
      const page = Math.max(Number.isFinite(rawPage) ? Math.floor(rawPage) : 1, 1)
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20, 1),
        50,
      )
      const offset = (page - 1) * limit
      const where = []
      const args = []
      if (status !== 'all') {
        where.push('r.status = ?')
        args.push(status)
      }
      if (q) {
        const like = `%${q}%`
        where.push(
          '(rp.username LIKE ? OR COALESCE(q.title, r.question_title) LIKE ? OR r.detail LIKE ? OR r.reason LIKE ?)',
        )
        args.push(like, like, like, like)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const orderSql = {
        new: 'r.created_at DESC, r.id DESC',
        old: 'r.created_at ASC, r.id ASC',
        most: 'report_count DESC, r.created_at DESC',
      }[sort]
      const total = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n
               FROM reports r
               JOIN users rp ON rp.id = r.reporter_id
               LEFT JOIN questions q ON q.id = r.question_id
               ${whereSql}`,
          )
          .get(...args)?.n ?? 0,
      )
      const rows = db
        .prepare(
          `SELECT r.id, r.reason, r.detail, r.status, r.created_at, r.handled_at,
                  r.question_id, COALESCE(q.title, r.question_title) AS question_title,
                  q.closes_at, COALESCE(q.user_id, r.question_author_id) AS author_id,
                  au.username AS author_username,
                  rp.id AS reporter_id, rp.username AS reporter_username,
                  h.username AS handler_username,
                  (SELECT COUNT(*) FROM reports r2 WHERE r2.question_id = r.question_id) AS report_count
             FROM reports r
             JOIN users rp ON rp.id = r.reporter_id
             LEFT JOIN questions q ON q.id = r.question_id
             LEFT JOIN users au ON au.id = COALESCE(q.user_id, r.question_author_id)
             LEFT JOIN users h ON h.id = r.handled_by
             ${whereSql}
            ORDER BY ${orderSql}
            LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset)
      const counts = { pending: 0, resolved: 0, rejected: 0 }
      for (const row of db
        .prepare('SELECT status, COUNT(*) AS n FROM reports GROUP BY status')
        .all()) {
        if (row.status in counts) counts[row.status] = Number(row.n)
      }
      return json(res, 200, {
        items: rows.map(adminReportDTO),
        total,
        page,
        limit,
        counts,
      })
    }

    const adminReport = path.match(/^\/admin\/reports\/([A-Za-z0-9-]+)$/)
    if (adminReport && method === 'PATCH') {
      const body = await readJson(req)
      const action = oneOf(
        body.action,
        ['resolve', 'reject', 'delete_question', 'ban_author'],
        'action',
      )
      const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(adminReport[1])
      if (!row) notFound('举报记录不存在')
      if (row.status !== 'pending') {
        throw new ApiError(409, 'REPORT_ALREADY_HANDLED', '这条举报已经处理过了')
      }

      const ts = nowIso()
      const question = row.question_id ? getQuestionRow(db, row.question_id) : null
      const title = question?.title ?? row.question_title ?? ''
      const notifyPayload = {
        reportId: row.id,
        questionId: row.question_id,
        title,
        status: action === 'reject' ? 'rejected' : 'resolved',
        action,
      }

      if (action === 'delete_question') {
        const pending = row.question_id
          ? db
              .prepare(
                "SELECT id, reporter_id FROM reports WHERE question_id = ? AND status = 'pending'",
              )
              .all(row.question_id)
          : [{ id: row.id, reporter_id: row.reporter_id }]
        if (row.question_id) {
          db.prepare(
            `UPDATE reports
                SET status = 'resolved', handled_by = ?, handled_at = ?
              WHERE question_id = ? AND status = 'pending'`,
          ).run(admin.id, ts, row.question_id)
        } else {
          db.prepare(
            "UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?",
          ).run(admin.id, ts, row.id)
        }
        if (question) {
          db.prepare('DELETE FROM questions WHERE id = ?').run(question.id)
        }
        for (const item of pending) {
          notifyUser(db, {
            userId: item.reporter_id,
            type: 'report.question_deleted',
            payload: { ...notifyPayload, reportId: item.id },
          })
        }
        recordAudit(db, {
          actorId: admin.id,
          action: 'admin.report.question_deleted',
          targetType: 'question',
          targetId: question?.id ?? row.question_id,
          meta: { reportId: row.id, title, reporters: pending.length },
          ip: clientIp(req),
        })
      } else if (action === 'ban_author') {
        const authorId = question?.user_id ?? row.question_author_id
        const author = authorId
          ? db.prepare('SELECT id, username, role, status FROM users WHERE id = ?').get(authorId)
          : null
        if (!author) notFound('问题作者不存在')
        if (author.role === 'admin') {
          throw new ApiError(403, 'ADMIN_PROTECTED', '不能通过举报队列停用管理员')
        }
        if (author.id === admin.id) {
          throw new ApiError(400, 'INVALID_INPUT', '不能停用自己的账号')
        }
        db.prepare("UPDATE users SET status = 'banned' WHERE id = ?").run(author.id)
        deleteTokensForUser(db, author.id)
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(author.id)
        db.prepare(
          "UPDATE reports SET status = 'resolved', handled_by = ?, handled_at = ? WHERE id = ?",
        ).run(admin.id, ts, row.id)
        notifyUser(db, {
          userId: row.reporter_id,
          type: 'report.author_banned',
          payload: notifyPayload,
        })
        recordAudit(db, {
          actorId: admin.id,
          action: 'admin.report.author_banned',
          targetType: 'user',
          targetId: author.id,
          meta: { reportId: row.id, title, author: author.username },
          ip: clientIp(req),
        })
      } else {
        const status = action === 'reject' ? 'rejected' : 'resolved'
        db.prepare(
          'UPDATE reports SET status = ?, handled_by = ?, handled_at = ? WHERE id = ?',
        ).run(status, admin.id, ts, row.id)
        notifyUser(db, {
          userId: row.reporter_id,
          type: action === 'reject' ? 'report.rejected' : 'report.resolved',
          payload: notifyPayload,
        })
        recordAudit(db, {
          actorId: admin.id,
          action: action === 'reject' ? 'admin.report.rejected' : 'admin.report.resolved',
          targetType: 'question',
          targetId: row.question_id,
          meta: { reportId: row.id, title },
          ip: clientIp(req),
        })
      }

      const updated = db.prepare('SELECT * FROM reports WHERE id = ?').get(row.id)
      return json(res, 200, { report: updated ? reportDTO(updated) : null, ok: true })
    }

    if (path === '/admin/audit' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').slice(0, 80)
      const category = url.searchParams.get('category') || 'all'
      const action = url.searchParams.get('action') || ''
      const targetType = url.searchParams.get('targetType') || ''
      const rawPage = Number(url.searchParams.get('page') || 1)
      const rawLimit = Number(url.searchParams.get('limit') || 20)
      const page = Math.max(Number.isFinite(rawPage) ? Math.floor(rawPage) : 1, 1)
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 20, 1),
        50,
      )
      const offset = (page - 1) * limit
      const where = []
      const args = []

      if (action) {
        where.push('a.action = ?')
        args.push(action)
      }
      if (targetType) {
        where.push('a.target_type = ?')
        args.push(targetType)
      }
      const prefix = {
        admin: 'admin.%',
        auth: 'auth.%',
        content: 'admin.question.%',
        users: 'admin.user.%',
      }[category]
      if (prefix) {
        where.push('a.action LIKE ?')
        args.push(prefix)
      }
      if (q) {
        const like = `%${q}%`
        where.push('(a.action LIKE ? OR u.username LIKE ? OR a.target_id LIKE ? OR a.meta LIKE ?)')
        args.push(like, like, like, like)
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n
               FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
               ${whereSql}`,
          )
          .get(...args)?.n ?? 0,
      )
      const rows = db
        .prepare(
          `SELECT a.id, a.action, a.target_type, a.target_id, a.meta, a.ip, a.created_at,
                  u.id AS actor_id, u.username AS actor_username
             FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
             ${whereSql}
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset)
      return json(res, 200, { items: rows.map(auditDTO), total, page, limit })
    }

    if (path === '/admin/stats' && method === 'GET') {
      const now = nowIso()
      const today = new Date().toISOString().slice(0, 10)
      const count = (sql, ...args) => Number(db.prepare(sql).get(...args)?.n ?? 0)
      const stats = {
        users: count("SELECT COUNT(*) n FROM users WHERE status <> 'deleted'"),
        questions: count('SELECT COUNT(*) n FROM questions'),
        votes: count('SELECT COUNT(*) n FROM votes'),
        reasons: count("SELECT COUNT(*) n FROM votes WHERE reason <> ''"),
        open: count('SELECT COUNT(*) n FROM questions WHERE closes_at IS NULL OR closes_at > ?', now),
        closed: count('SELECT COUNT(*) n FROM questions WHERE closes_at IS NOT NULL AND closes_at <= ?', now),
        banned: count("SELECT COUNT(*) n FROM users WHERE status = 'banned'"),
        deletedUsers: count("SELECT COUNT(*) n FROM users WHERE status = 'deleted'"),
        todayUsers: count('SELECT COUNT(*) n FROM users WHERE created_at LIKE ? AND status <> ?', `${today}%`, 'deleted'),
        todayQuestions: count('SELECT COUNT(*) n FROM questions WHERE created_at LIKE ?', `${today}%`),
        todayVotes: count('SELECT COUNT(*) n FROM votes WHERE created_at LIKE ?', `${today}%`),
        pendingReports: count("SELECT COUNT(*) n FROM reports WHERE status = 'pending'"),
      }
      const categories = db
        .prepare('SELECT category, COUNT(*) AS n FROM questions GROUP BY category ORDER BY n DESC')
        .all()
        .map((r) => ({ category: r.category, count: Number(r.n) }))
      const recent = db
        .prepare(
          `SELECT q.id, q.title, q.created_at, q.closes_at, q.featured,
                  u.username, u.avatar_hue, u.status AS user_status
             FROM questions q JOIN users u ON u.id = q.user_id
            ORDER BY q.created_at DESC LIMIT 6`,
        )
        .all()
        .map((r) => ({
          id: r.id,
          title: r.title,
          createdAt: r.created_at,
          status: statusOf(r),
          featured: Boolean(r.featured),
          author: publicAuthor(r).username,
        }))
      return json(res, 200, { stats, categories, recent })
    }

    if (path === '/admin/questions' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').slice(0, 80)
      const status = url.searchParams.get('status') || 'all'
      const page = Math.max(Number(url.searchParams.get('page') || 1), 1)
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || 20), 1), 50)
      const offset = (page - 1) * limit
      const where = []
      const args = []
      if (q) {
        where.push('(q.title LIKE ? OR u.username LIKE ?)')
        args.push(`%${q}%`, `%${q}%`)
      }
      if (status === 'open') {
        where.push('(q.closes_at IS NULL OR q.closes_at > ?)')
        args.push(nowIso())
      } else if (status === 'closed') {
        where.push('(q.closes_at IS NOT NULL AND q.closes_at <= ?)')
        args.push(nowIso())
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM questions q JOIN users u ON u.id = q.user_id ${whereSql}`,
          )
          .get(...args)?.n ?? 0,
      )
      const rows = db
        .prepare(
          `SELECT q.id, q.user_id, q.title, q.category, q.closes_at, q.anonymous,
                  q.featured, q.created_at, u.username, u.avatar_hue,
                  u.status AS user_status,
                  (SELECT COUNT(*) FROM votes v WHERE v.question_id = q.id) AS total,
                  (SELECT COUNT(*) FROM votes v WHERE v.question_id = q.id AND v.choice = 'yes') AS yes,
                  (SELECT COUNT(*) FROM votes v WHERE v.question_id = q.id AND v.choice = 'no') AS no,
                  (SELECT COUNT(*) FROM votes v WHERE v.question_id = q.id AND v.reason <> '') AS reasons
             FROM questions q JOIN users u ON u.id = q.user_id
             ${whereSql}
            ORDER BY q.created_at DESC
            LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset)
      return json(res, 200, {
        items: rows.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category,
          status: statusOf(r),
          featured: Boolean(r.featured),
          anonymous: Boolean(r.anonymous),
          author: r.anonymous ? null : publicAuthor(r),
          createdAt: r.created_at,
          closesAt: r.closes_at ?? null,
          counts: {
            yes: Number(r.yes ?? 0),
            no: Number(r.no ?? 0),
            total: Number(r.total ?? 0),
            reasons: Number(r.reasons ?? 0),
          },
        })),
        total,
        page,
        limit,
      })
    }

    const adminQuestion = path.match(/^\/admin\/questions\/([A-Za-z0-9-]+)$/)
    if (adminQuestion) {
      const id = adminQuestion[1]
      const row = getQuestionRow(db, id)
      if (!row) notFound('这个问题不存在')
      if (method === 'PATCH') {
        const body = await readJson(req)
        const updates = []
        const args = []
        const wasFeatured = Boolean(row.featured)
        const wasClosed = statusOf(row) === 'closed'
        const nextFeatured = typeof body.featured === 'boolean' ? body.featured : wasFeatured
        const nextClosed = typeof body.closed === 'boolean' ? body.closed : wasClosed
        if (typeof body.featured === 'boolean') {
          updates.push('featured = ?')
          args.push(body.featured ? 1 : 0)
        }
        if (typeof body.closed === 'boolean') {
          updates.push('closes_at = ?')
          args.push(body.closed ? nowIso() : null)
          updates.push('close_notified_at = NULL')
        }
        if (!updates.length) bad('没有需要更新的字段')
        args.push(id)
        db.prepare(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`).run(...args)
        if (nextFeatured !== wasFeatured) {
          recordAudit(db, {
            actorId: admin.id,
            action: nextFeatured ? 'admin.question.featured' : 'admin.question.unfeatured',
            targetType: 'question',
            targetId: id,
            meta: { title: row.title, featured: nextFeatured },
            ip: clientIp(req),
          })
        }
        if (nextClosed !== wasClosed) {
          recordAudit(db, {
            actorId: admin.id,
            action: nextClosed ? 'admin.question.closed' : 'admin.question.reopened',
            targetType: 'question',
            targetId: id,
            meta: { title: row.title, closed: nextClosed },
            ip: clientIp(req),
          })
        }
        const updated = getQuestionRow(db, id)
        return json(res, 200, { question: questionDTO(db, updated, admin.id) })
      }
      if (method === 'DELETE') {
        const votes = Number(
          db.prepare('SELECT COUNT(*) AS n FROM votes WHERE question_id = ?').get(id)?.n ?? 0,
        )
        db.prepare('DELETE FROM questions WHERE id = ?').run(id)
        recordAudit(db, {
          actorId: admin.id,
          action: 'admin.question.deleted',
          targetType: 'question',
          targetId: id,
          meta: {
            title: row.title,
            category: row.category,
            author: row.username,
            votes,
          },
          ip: clientIp(req),
        })
        return json(res, 200, { ok: true })
      }
    }

    if (path === '/admin/users' && method === 'GET') {
      const q = (url.searchParams.get('q') || '').slice(0, 80)
      const where = q ? 'WHERE u.username LIKE ? OR u.email LIKE ?' : ''
      const args = q ? [`%${q}%`, `%${q}%`] : []
      const rows = db
        .prepare(
          `SELECT u.id, u.username, u.email, u.role, u.status, u.avatar_hue, u.created_at,
                  u.email_verified_at,
                  (SELECT COUNT(*) FROM questions q WHERE q.user_id = u.id) AS questions,
                  (SELECT COUNT(*) FROM votes v WHERE v.user_id = u.id) AS votes
             FROM users u ${where}
            ORDER BY u.created_at DESC LIMIT 100`,
        )
        .all(...args)
      return json(res, 200, {
        items: rows.map((r) => ({
          id: r.id,
          username: r.username,
          email: r.email,
          role: r.role,
          status: r.status,
          emailVerified: Boolean(r.email_verified_at),
          avatarHue: r.avatar_hue ?? 18,
          createdAt: r.created_at,
          questions: Number(r.questions ?? 0),
          votes: Number(r.votes ?? 0),
        })),
      })
    }

    const adminUser = path.match(/^\/admin\/users\/([A-Za-z0-9-]+)$/)
    if (adminUser && method === 'PATCH') {
      const target = db.prepare('SELECT * FROM users WHERE id = ?').get(adminUser[1])
      if (!target) notFound('用户不存在')
      if (target.status === 'deleted') bad('已注销账号不可操作')
      if (target.id === admin.id) bad('不能停用自己的账号')
      if (target.role === 'admin') bad('不能操作管理员账号')
      const body = await readJson(req)
      const status = oneOf(body.status, ['active', 'banned'], 'status')
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, target.id)
      if (status === 'banned') {
        deleteTokensForUser(db, target.id)
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id)
      }
      if (status !== target.status) {
        recordAudit(db, {
          actorId: admin.id,
          action: status === 'banned' ? 'admin.user.banned' : 'admin.user.unbanned',
          targetType: 'user',
          targetId: target.id,
          meta: { username: target.username },
          ip: clientIp(req),
        })
      }
      return json(res, 200, { user: publicUser({ ...target, status }) })
    }
  }

  return json(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
}
