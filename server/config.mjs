/** 运行时配置：按需读取环境变量，便于本地开发与测试切换。 */

export function appUrl() {
  const raw = String(process.env.APP_URL || '').trim()
  const fallback = `http://127.0.0.1:${Number(process.env.PORT || 8787)}`
  return (raw || fallback).replace(/\/+$/, '')
}

export function requiresVerifiedEmail() {
  return process.env.REQUIRE_VERIFIED_TO_POST !== '0'
}

export function devMailEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.DEV_MAIL !== '0'
}

export function mailFrom() {
  return process.env.MAIL_FROM || '大家来决定 <noreply@dajia.local>'
}

/** 邮件服务：显式 MAIL_PROVIDER 优先，否则按已配置的 API key 自动选择。 */
export function mailProvider() {
  const explicit = String(process.env.MAIL_PROVIDER || '').trim().toLowerCase()
  if (explicit) return explicit
  if (process.env.BREVO_API_KEY) return 'brevo'
  if (process.env.RESEND_API_KEY) return 'resend'
  return 'console'
}

/** 只有明确部署在反向代理后才信任转发头，避免客户端伪造 IP / 协议。 */
export function trustProxy() {
  return process.env.TRUST_PROXY === '1'
}

function normalizeIp(value = '') {
  return String(value).trim().replace(/^::ffff:/, '').slice(0, 64)
}

export function requestIp(req) {
  if (trustProxy()) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0]
    const ip = normalizeIp(forwarded)
    if (ip) return ip
  }
  return normalizeIp(req.socket?.remoteAddress || '')
}

export function requestScheme(req) {
  if (trustProxy()) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
    if (forwarded === 'https' || forwarded === 'http') return forwarded
  }
  return req.socket?.encrypted ? 'https' : 'http'
}

export function cookieSecure(req) {
  if (process.env.COOKIE_SECURE === '1') return true
  if (process.env.COOKIE_SECURE === '0') return false
  return requestScheme(req) === 'https' || process.env.NODE_ENV === 'production'
}

export function appOrigin() {
  try {
    return new URL(appUrl()).origin
  } catch {
    return ''
  }
}

function positiveInt(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function maxLinksPerField() {
  return positiveInt(process.env.MAX_LINKS_PER_FIELD, 2)
}

export function postDailyLimit() {
  return positiveInt(process.env.POST_DAILY_LIMIT, 5)
}

export function votePerMinute() {
  return positiveInt(process.env.VOTE_RATE_LIMIT, 20)
}

export function blocklistPath() {
  return process.env.BLOCKLIST_PATH || ''
}
