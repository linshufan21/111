export class ApiError extends Error {
  constructor(status, code, message, field, retryAfter = null) {
    super(message)
    this.status = status
    this.code = code
    this.field = field
    this.retryAfter = retryAfter
  }
}

export function bad(message, field) {
  throw new ApiError(400, 'INVALID_INPUT', message, field)
}

export function unauthorized(message = '请先登录') {
  throw new ApiError(401, 'UNAUTHORIZED', message)
}

export function notFound(message = '内容不存在') {
  throw new ApiError(404, 'NOT_FOUND', message)
}

export function conflict(message, field) {
  throw new ApiError(409, 'CONFLICT', message, field)
}

export function rateLimited(message, retryAfter, code = 'RATE_LIMITED') {
  throw new ApiError(429, code, message, undefined, Math.max(1, Math.ceil(retryAfter)))
}

export async function readJson(req, limit = 32 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      throw new ApiError(413, 'PAYLOAD_TOO_LARGE', '请求内容过大')
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8')
  try {
    const value = JSON.parse(raw)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      bad('请求格式不正确')
    }
    return value
  } catch (err) {
    if (err instanceof ApiError) throw err
    bad('请求格式不正确')
  }
}

export function str(value, { field, min = 1, max = 200, trim = true, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) bad('这一项不能为空', field)
    return ''
  }
  if (typeof value !== 'string') bad('格式不正确', field)
  const out = trim ? value.trim() : value
  if (out.length < min) bad(`至少需要 ${min} 个字符`, field)
  if (out.length > max) bad(`最多 ${max} 个字符`, field)
  return out
}

export function email(value) {
  const out = str(value, { field: 'email', min: 5, max: 120 })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out)) bad('邮箱格式不正确', 'email')
  return out.toLowerCase()
}

export function bool(value, fallback = false) {
  if (value === undefined || value === null) return fallback
  return Boolean(value)
}

export function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) bad('选项不合法', field)
  return value
}

export function isoDate(value, field) {
  if (value === undefined || value === null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) bad('时间格式不正确', field)
  return date.toISOString()
}
