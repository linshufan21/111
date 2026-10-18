import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { appendSetCookie, parseCookies } from './auth.mjs'
import { cookieSecure } from './config.mjs'
import { ApiError } from './validate.mjs'

export const CSRF_COOKIE = 'dd_csrf'
export const CSRF_HEADER = 'x-csrf-token'
const CSRF_MAX_AGE = 30 * 24 * 60 * 60

let cachedSecret = ''

function csrfSecret() {
  if (cachedSecret) return cachedSecret
  const configured = String(process.env.CSRF_SECRET || '').trim()
  cachedSecret = configured || randomBytes(32).toString('hex')
  return cachedSecret
}

function sign(nonce) {
  return createHmac('sha256', csrfSecret()).update(nonce).digest('base64url')
}

export function createCsrfToken() {
  const nonce = randomBytes(24).toString('base64url')
  return `${nonce}.${sign(nonce)}`
}

export function isValidCsrfToken(token) {
  if (typeof token !== 'string' || token.length < 40 || token.length > 200) return false
  const dot = token.lastIndexOf('.')
  if (dot <= 0 || dot === token.length - 1) return false
  const nonce = token.slice(0, dot)
  const provided = token.slice(dot + 1)
  const expected = sign(nonce)
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

function csrfCookie(token, secure) {
  const bits = [
    `${CSRF_COOKIE}=${token}`,
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${CSRF_MAX_AGE}`,
  ]
  if (secure) bits.push('Secure')
  return bits.join('; ')
}

/** 读取现有 token；不存在或签名失效时签发新 token。 */
export function readOrIssueCsrf(req, res) {
  const cookies = parseCookies(req.headers.cookie || '')
  const existing = cookies[CSRF_COOKIE]
  if (isValidCsrfToken(existing)) return existing
  const token = createCsrfToken()
  appendSetCookie(res, csrfCookie(token, cookieSecure(req)))
  return token
}

/** 认证边界（登录/登出/改密等）强制换一枚新 token。 */
export function rotateCsrf(req, res) {
  const token = createCsrfToken()
  appendSetCookie(res, csrfCookie(token, cookieSecure(req)))
  return token
}

/** 双提交校验：Cookie 与 Header 都必须存在、签名有效且完全一致。 */
export function assertCsrf(req) {
  const cookies = parseCookies(req.headers.cookie || '')
  const cookieToken = cookies[CSRF_COOKIE]
  const headerToken = String(req.headers[CSRF_HEADER] || '')
  if (
    !isValidCsrfToken(cookieToken) ||
    !isValidCsrfToken(headerToken) ||
    cookieToken.length !== headerToken.length
  ) {
    throw new ApiError(403, 'BAD_CSRF', '请求校验失败，请刷新页面后重试')
  }
  const a = Buffer.from(cookieToken)
  const b = Buffer.from(headerToken)
  if (!timingSafeEqual(a, b)) {
    throw new ApiError(403, 'BAD_CSRF', '请求校验失败，请刷新页面后重试')
  }
}
