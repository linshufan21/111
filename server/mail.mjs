import { randomUUID } from 'node:crypto'
import { appUrl, devMailEnabled, mailFrom, mailProvider } from './config.mjs'

const outbox = []
const MAX_OUTBOX = 50

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function verificationLink(token) {
  return `${appUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`
}

export function passwordResetLink(token) {
  return `${appUrl()}/reset-password?token=${encodeURIComponent(token)}`
}

function parseFrom(value) {
  const raw = String(value || '').trim()
  const match = /^(.*?)\s*<([^>]+)>$/.exec(raw)
  if (match) {
    return {
      name: match[1].trim().replace(/^"|"$/g, '') || '大家来决定',
      email: match[2].trim(),
    }
  }
  return { name: '大家来决定', email: raw || 'noreply@dajia.local' }
}

async function postJson(url, headers, payload, provider) {
  if (typeof fetch !== 'function') {
    throw new Error(`${provider} 需要 Node 内置 fetch`)
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`${provider} HTTP ${response.status}: ${body.slice(0, 300)}`)
  }
  return body
}

async function sendBrevo(item) {
  const key = String(process.env.BREVO_API_KEY || '').trim()
  if (!key) throw new Error('BREVO_API_KEY 未配置')
  const sender = parseFrom(item.from)
  await postJson(
    'https://api.brevo.com/v3/smtp/email',
    { 'api-key': key },
    {
      sender,
      to: [{ email: item.to }],
      subject: item.subject,
      htmlContent: item.html,
      textContent: item.text,
    },
    'Brevo',
  )
  return { sent: true, dev: false, provider: 'brevo' }
}

async function sendResend(item) {
  const key = String(process.env.RESEND_API_KEY || '').trim()
  if (!key) throw new Error('RESEND_API_KEY 未配置')
  await postJson(
    'https://api.resend.com/emails',
    { Authorization: `Bearer ${key}` },
    {
      from: item.from,
      to: [item.to],
      subject: item.subject,
      html: item.html,
      text: item.text,
    },
    'Resend',
  )
  return { sent: true, dev: false, provider: 'resend' }
}

/**
 * 开发环境写入控制台 + 内存邮件箱；生产环境走 Brevo / Resend 的 HTTPS API。
 * 失败直接抛出，由调用方转成 verificationSent=false 或 502，不吞掉错误。
 */
async function deliver(item) {
  if (devMailEnabled()) {
    outbox.unshift(item)
    if (outbox.length > MAX_OUTBOX) outbox.length = MAX_OUTBOX
    console.log(`[mail] ${item.kind} for ${item.to}: ${item.link}`)
    return { sent: true, dev: true, link: item.link }
  }

  const provider = mailProvider()
  if (provider === 'brevo') return sendBrevo(item)
  if (provider === 'resend') return sendResend(item)

  console.warn('[mail] 未配置 BREVO_API_KEY / RESEND_API_KEY，邮件未发送')
  return { sent: false, dev: false, provider }
}

/** 健康检查/启动日志用，不暴露密钥。 */
export function mailStatus() {
  if (devMailEnabled()) return 'dev'
  const provider = mailProvider()
  if (provider === 'brevo' && process.env.BREVO_API_KEY) return 'brevo'
  if (provider === 'resend' && process.env.RESEND_API_KEY) return 'resend'
  return 'disabled'
}

/**
 * Day 2/3 的邮件通道；Day 21 提前接入免费 HTTPS 邮件 API。
 * 生产环境未配置时不会把 token 打进日志。
 */
export async function sendVerificationEmail(user, token, expiresAt) {
  const link = verificationLink(token)
  const expiresLabel = new Date(expiresAt).toLocaleString('zh-CN')
  const username = user.username || '你好'
  const subject = '验证你的邮箱 · 大家来决定'
  const text =
    `${username}，你好：\n\n` +
    `请点击下面的链接验证你的邮箱（24 小时内有效）：\n${link}\n\n` +
    `链接有效期至：${expiresLabel}\n` +
    '如果这不是你本人操作，请忽略这封邮件。\n\n' +
    '—— 大家来决定'
  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:28px;background:#f7f3ea;color:#191a1d;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:26px 28px;background:#fffdf8;border:1px solid #dcd3c0;border-radius:16px;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:.18em;color:#c74420;">DAJIA DECIDES</p>
      <h1 style="margin:0 0 14px;font-family:Georgia,'Songti SC',serif;font-size:24px;">验证你的邮箱</h1>
      <p style="margin:0 0 18px;font-size:13px;line-height:1.8;color:#6b675e;">
        ${escapeHtml(username)}，你好。点击下面的按钮完成验证，之后就可以在广场发起投票。
      </p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(link)}" style="display:inline-block;padding:11px 20px;background:#e4572e;color:#fff;border-radius:9px;text-decoration:none;font-size:13px;font-weight:600;">验证邮箱</a>
      </p>
      <p style="margin:0 0 6px;font-size:11px;line-height:1.7;color:#9a9384;">链接 24 小时内有效，过期后可在账号设置里重新发送。</p>
      <p style="margin:0;font-size:11px;line-height:1.7;color:#9a9384;">如果这不是你本人操作，请忽略这封邮件。</p>
    </div>
  </body>
</html>`

  return deliver({
    id: randomUUID(),
    kind: 'email_verify',
    from: mailFrom(),
    to: user.email,
    subject,
    text,
    html,
    link,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
}

export async function sendPasswordResetEmail(user, token, expiresAt) {
  const link = passwordResetLink(token)
  const expiresLabel = new Date(expiresAt).toLocaleString('zh-CN')
  const username = user.username || '你好'
  const subject = '重置你的密码 · 大家来决定'
  const text =
    `${username}，你好：\n\n` +
    `我们收到了重置密码的请求。点击下面的链接设置新密码（30 分钟内有效）：\n${link}\n\n` +
    `链接有效期至：${expiresLabel}\n` +
    '如果这不是你本人操作，请忽略这封邮件，你的密码不会改变。\n\n' +
    '—— 大家来决定'
  const html = `<!doctype html>
<html lang="zh-CN">
  <body style="margin:0;padding:28px;background:#f7f3ea;color:#191a1d;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:26px 28px;background:#fffdf8;border:1px solid #dcd3c0;border-radius:16px;">
      <p style="margin:0 0 6px;font-size:10px;letter-spacing:.18em;color:#c74420;">DAJIA DECIDES</p>
      <h1 style="margin:0 0 14px;font-family:Georgia,'Songti SC',serif;font-size:24px;">重置你的密码</h1>
      <p style="margin:0 0 18px;font-size:13px;line-height:1.8;color:#6b675e;">
        ${escapeHtml(username)}，你好。点击下面的按钮设置新密码。链接 30 分钟内有效，且只能使用一次。
      </p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(link)}" style="display:inline-block;padding:11px 20px;background:#e4572e;color:#fff;border-radius:9px;text-decoration:none;font-size:13px;font-weight:600;">重置密码</a>
      </p>
      <p style="margin:0 0 6px;font-size:11px;line-height:1.7;color:#9a9384;">如果这不是你本人操作，请忽略这封邮件，你的密码不会改变。</p>
      <p style="margin:0;font-size:11px;line-height:1.7;color:#9a9384;">为安全起见，重置成功后所有设备都会退出登录。</p>
    </div>
  </body>
</html>`

  return deliver({
    id: randomUUID(),
    kind: 'password_reset',
    from: mailFrom(),
    to: user.email,
    subject,
    text,
    html,
    link,
    createdAt: new Date().toISOString(),
    expiresAt,
  })
}

export function listDevMail() {
  return outbox.map(({ html, ...item }) => item)
}
