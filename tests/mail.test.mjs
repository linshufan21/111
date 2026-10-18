import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  mailStatus,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../server/mail.mjs'

const KEYS = [
  'NODE_ENV',
  'DEV_MAIL',
  'MAIL_PROVIDER',
  'BREVO_API_KEY',
  'RESEND_API_KEY',
  'APP_URL',
  'MAIL_FROM',
]

function snapshotEnv() {
  return Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
}

function restoreEnv(before) {
  for (const key of KEYS) {
    if (before[key] === undefined) delete process.env[key]
    else process.env[key] = before[key]
  }
}

function productionEnv(provider) {
  process.env.NODE_ENV = 'production'
  delete process.env.DEV_MAIL
  process.env.APP_URL = 'https://dajia.test'
  process.env.MAIL_FROM = '大家来决定 <noreply@dajia.test>'
  process.env.MAIL_PROVIDER = provider
}

test('Brevo provider posts verification mail with API key', async () => {
  const before = snapshotEnv()
  const originalFetch = globalThis.fetch
  const calls = []
  productionEnv('brevo')
  process.env.BREVO_API_KEY = 'brevo-test-key'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ messageId: 'm1' }), {
      status: 201,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const result = await sendVerificationEmail(
      { username: '林小满', email: 'lin@example.com' },
      'verify-token',
      new Date(Date.now() + 3600_000).toISOString(),
    )
    assert.equal(result.sent, true)
    assert.equal(result.provider, 'brevo')
    assert.equal(mailStatus(), 'brevo')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, 'https://api.brevo.com/v3/smtp/email')
    assert.equal(calls[0].init.headers['api-key'], 'brevo-test-key')
    const payload = JSON.parse(calls[0].init.body)
    assert.deepEqual(payload.sender, { name: '大家来决定', email: 'noreply@dajia.test' })
    assert.deepEqual(payload.to, [{ email: 'lin@example.com' }])
    assert.match(payload.subject, /验证你的邮箱/)
    assert.match(payload.htmlContent, /verify-token/)
    assert.match(payload.textContent, /https:\/\/dajia\.test\/api\/auth\/verify/)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(before)
  }
})

test('Resend provider posts password reset mail', async () => {
  const before = snapshotEnv()
  const originalFetch = globalThis.fetch
  const calls = []
  productionEnv('resend')
  process.env.RESEND_API_KEY = 'resend-test-key'
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ id: 'mail-1' }), { status: 200 })
  }
  try {
    const result = await sendPasswordResetEmail(
      { username: '阿哲', email: 'azhe@example.com' },
      'reset-token',
      new Date(Date.now() + 1800_000).toISOString(),
    )
    assert.equal(result.sent, true)
    assert.equal(result.provider, 'resend')
    assert.equal(calls[0].url, 'https://api.resend.com/emails')
    assert.equal(calls[0].init.headers.Authorization, 'Bearer resend-test-key')
    const payload = JSON.parse(calls[0].init.body)
    assert.deepEqual(payload.to, ['azhe@example.com'])
    assert.match(payload.html, /reset-token/)
  } finally {
    globalThis.fetch = originalFetch
    restoreEnv(before)
  }
})

test('no provider returns sent=false without leaking link', async () => {
  const before = snapshotEnv()
  const originalFetch = globalThis.fetch
  const originalWarn = console.warn
  let called = false
  productionEnv('console')
  delete process.env.BREVO_API_KEY
  delete process.env.RESEND_API_KEY
  console.warn = () => {}
  globalThis.fetch = async () => {
    called = true
    throw new Error('should not call fetch')
  }
  try {
    const result = await sendVerificationEmail(
      { username: '测试', email: 'test@example.com' },
      'secret-token',
      new Date(Date.now() + 3600_000).toISOString(),
    )
    assert.equal(result.sent, false)
    assert.equal(mailStatus(), 'disabled')
    assert.equal(called, false)
  } finally {
    console.warn = originalWarn
    globalThis.fetch = originalFetch
    restoreEnv(before)
  }
})
