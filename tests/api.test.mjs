import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { createApp } from '../server/index.mjs'
import { notifyClosingQuestions } from '../server/notify.mjs'
import { SCHEMA_NAME, SCHEMA_VERSION } from '../server/schema-meta.mjs'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

let server
let db
let base

function makeClient() {
  const cookies = new Map()
  let csrf = ''
  let csrfPromise = null

  const cookieHeader = () =>
    [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')

  const captureCookies = (res) => {
    const setCookies =
      typeof res.headers.getSetCookie === 'function'
        ? res.headers.getSetCookie()
        : [res.headers.get('set-cookie')].filter(Boolean)
    for (const raw of setCookies) {
      const pair = String(raw).split(';', 1)[0]
      const idx = pair.indexOf('=')
      if (idx === -1) continue
      const name = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (/Max-Age=0/i.test(String(raw)) || !value) cookies.delete(name)
      else cookies.set(name, value)
    }
    return setCookies
  }

  const ensureCsrf = async (force = false) => {
    if (force) {
      csrf = ''
      csrfPromise = null
    }
    if (csrf) return csrf
    if (!csrfPromise) {
      csrfPromise = (async () => {
        const res = await fetch(`${base}/csrf`, {
          headers: cookieHeader() ? { cookie: cookieHeader() } : undefined,
        })
        captureCookies(res)
        const data = await res.json()
        if (!res.ok || !data.token) throw new Error('CSRF bootstrap failed')
        csrf = data.token
        return csrf
      })().finally(() => {
        csrfPromise = null
      })
    }
    return csrfPromise
  }

  const client = async (path, options = {}) => {
    const { csrf: csrfOption, ...init } = options
    const method = String(init.method || 'GET').toUpperCase()
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
    const headers = {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    }
    if (mutating && csrfOption !== false) {
      headers['X-CSRF-Token'] =
        typeof csrfOption === 'string' ? csrfOption : await ensureCsrf()
    }
    // CSRF 引导可能刚刚写入 Cookie，必须在 await 之后再取。
    if (!headers.cookie && cookieHeader()) headers.cookie = cookieHeader()
    const res = await fetch(base + path, {
      redirect: init.redirect ?? 'follow',
      ...init,
      headers,
    })
    const setCookies = captureCookies(res)
    const text = await res.text()
    const body = text ? JSON.parse(text) : null
    if (body && typeof body === 'object' && typeof body.csrfToken === 'string') {
      csrf = body.csrfToken
    }
    return {
      status: res.status,
      body,
      location: res.headers.get('location'),
      setCookies,
      headers: res.headers,
    }
  }

  client.cookies = cookieHeader
  client.cookie = (name) => cookies.get(name) ?? ''
  client.csrf = () => csrf
  client.ensureCsrf = ensureCsrf
  client.setCookie = (raw) => {
    for (const part of String(raw).split(';')) {
      const idx = part.indexOf('=')
      if (idx === -1) continue
      const name = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (name && value) cookies.set(name, value)
    }
  }
  return client
}

/** 测试夹具：绕过邮件流程，直接把测试账号标记为已验证。 */
function markVerified(username) {
  db.prepare('UPDATE users SET email_verified_at = ? WHERE username = ?').run(
    new Date().toISOString(),
    username,
  )
}

async function mailFor(api, email, kind = null) {
  const mailbox = await api('/dev/mail')
  return (
    mailbox.body.items.find(
      (item) => item.to === email && (!kind || item.kind === kind),
    ) ?? null
  )
}

before(async () => {
  process.env.NODE_ENV = 'test'
  process.env.DEV_MAIL = '1'
  process.env.REQUIRE_VERIFIED_TO_POST = '1'
  const app = createApp({ dbPath: ':memory:' })
  server = app.server
  db = app.db
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  base = `http://127.0.0.1:${port}/api`
})

after(async () => {
  await new Promise((resolve) => server.close(resolve))
  db.close()
})

test('register, session and me', async () => {
  const api = makeClient()
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '测试用户',
      email: 'test@example.com',
      password: 'password123',
    }),
  })
  assert.equal(reg.status, 201)
  assert.equal(reg.body.user.username, '测试用户')
  assert.equal(reg.body.verificationSent, true)

  const me = await api('/auth/me')
  assert.equal(me.body.user.email, 'test@example.com')
  assert.equal(me.body.user.emailVerified, false)

  const meta = await api('/meta')
  assert.equal(meta.status, 200)
  assert.equal(meta.body.requireEmailVerification, true)
  assert.equal(meta.body.devMail, true)

  markVerified('测试用户')
})

test('rejects duplicate username and bad password', async () => {
  const api = makeClient()
  const dup = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: '测试用户', email: 'x@example.com', password: 'password123' }),
  })
  assert.equal(dup.status, 409)
  assert.equal(dup.body.error.field, 'username')

  const bad = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '测试用户', password: 'wrong-pass' }),
  })
  assert.equal(bad.status, 401)
})

test('create, list, vote and change vote', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: '投票者', email: 'voter@example.com', password: 'password123' }),
  })
  markVerified('投票者')

  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({
      title: '要不要在测试里投票？',
      description: '这是一条测试问题',
      category: '其他',
    }),
  })
  assert.equal(created.status, 201)
  const id = created.body.question.id
  assert.equal(created.body.question.counts.total, 0)

  const vote = await api(`/questions/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '因为测试需要' }),
  })
  assert.equal(vote.status, 200)
  assert.equal(vote.body.question.counts.yes, 1)
  assert.equal(vote.body.question.myVote.choice, 'yes')

  const change = await api(`/questions/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'no', reason: '改主意了' }),
  })
  assert.equal(change.body.question.counts.yes, 0)
  assert.equal(change.body.question.counts.no, 1)
  assert.equal(change.body.question.counts.total, 1)

  const detail = await api(`/questions/${id}`)
  assert.equal(detail.body.reasons.length, 1)
  assert.equal(detail.body.reasons[0].reason, '改主意了')
  assert.equal(detail.body.reasons[0].mine, true)

  const list = await api('/questions?sort=new&limit=5')
  assert.ok(list.body.items.some((q) => q.id === id))
})

test('anonymous question hides author', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: '匿名君', email: 'anon@example.com', password: 'password123' }),
  })
  markVerified('匿名君')
  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '要不要匿名问一句？', description: '', category: '其他', anonymous: true }),
  })
  assert.equal(created.body.question.author, null)
  assert.equal(created.body.question.anonymous, true)
})

test('rejects short title, bad category, unauthenticated vote', async () => {
  const api = makeClient()
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '测试用户', password: 'password123' }),
  })
  const short = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '短', description: '', category: '其他' }),
  })
  assert.equal(short.status, 400)
  assert.equal(short.body.error.field, 'title')

  const badCat = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '这个问题分类不对', description: '', category: '不存在的分类' }),
  })
  assert.equal(badCat.status, 400)
  assert.equal(badCat.body.error.field, 'category')

  const anon = makeClient()
  const unauth = await anon('/questions/does-not-exist/vote', {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes' }),
  })
  assert.equal(unauth.status, 401)
})

test('closed question cannot be voted', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: '截止测试', email: 'close@example.com', password: 'password123' }),
  })
  markVerified('截止测试')
  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '这个投票马上截止', description: '', category: '其他' }),
  })
  const id = created.body.question.id
  db.prepare('UPDATE questions SET closes_at = ? WHERE id = ?').run(
    new Date(Date.now() - 1000).toISOString(),
    id,
  )
  const vote = await api(`/questions/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes' }),
  })
  assert.equal(vote.status, 409)
  assert.equal(vote.body.error.code, 'QUESTION_CLOSED')
  const detail = await api(`/questions/${id}`)
  assert.equal(detail.body.question.status, 'closed')
})

test('logout clears session', async () => {
  const api = makeClient()
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '测试用户', password: 'password123' }),
  })
  const before = await api('/auth/me')
  assert.ok(before.body.user)
  await api('/auth/logout', { method: 'POST' })
  const afterLogout = await api('/auth/me')
  assert.equal(afterLogout.body.user, null)
})

test('admin moderation, audit trail and permissions', async () => {
  db.prepare("UPDATE users SET role = 'admin' WHERE username = '测试用户'").run()
  markVerified('测试用户')
  const admin = makeClient()
  await admin('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '测试用户', password: 'password123' }),
  })

  const stats = await admin('/admin/stats')
  assert.equal(stats.status, 200)
  assert.ok(stats.body.stats.users >= 3)

  const list = await admin('/questions?limit=10')
  const question = list.body.items.find((item) => item.status === 'open')
  assert.ok(question)
  const desiredFeatured = !question.featured
  const featured = await admin(`/admin/questions/${question.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ featured: desiredFeatured }),
  })
  assert.equal(featured.status, 200)
  assert.equal(featured.body.question.featured, desiredFeatured)

  const closed = await admin(`/admin/questions/${question.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ closed: true }),
  })
  assert.equal(closed.body.question.status, 'closed')

  const extra = await admin('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '准备被管理员删除的问题', category: '其他' }),
  })
  assert.equal(extra.status, 201)
  const removed = await admin(`/admin/questions/${extra.body.question.id}`, {
    method: 'DELETE',
  })
  assert.equal(removed.status, 200)

  const users = await admin('/admin/users?q=匿名君')
  const target = users.body.items[0]
  const banned = await admin(`/admin/users/${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'banned' }),
  })
  assert.equal(banned.body.user.status, 'banned')

  const started = Date.now()
  const audit = await admin('/admin/audit?category=admin&limit=50')
  assert.equal(audit.status, 200)
  assert.ok(Date.now() - started < 1000)
  const actions = audit.body.items.map((item) => item.action)
  assert.ok(actions.includes('admin.question.featured') || actions.includes('admin.question.unfeatured'))
  assert.ok(actions.includes('admin.question.closed'))
  assert.ok(actions.includes('admin.question.deleted'))
  assert.ok(actions.includes('admin.user.banned'))
  assert.ok(audit.body.total >= 4)

  const featuredLog = audit.body.items.find(
    (item) =>
      item.action === 'admin.question.featured' ||
      item.action === 'admin.question.unfeatured',
  )
  assert.equal(featuredLog.actor.username, '测试用户')
  assert.equal(featuredLog.targetType, 'question')
  assert.ok(featuredLog.meta.title)

  const contentAudit = await admin('/admin/audit?category=content&q=准备被管理员删除&limit=20')
  assert.equal(contentAudit.status, 200)
  assert.ok(contentAudit.body.items.some((item) => item.action === 'admin.question.deleted'))

  const actorAudit = await admin('/admin/audit?q=测试用户&limit=5')
  assert.equal(actorAudit.status, 200)
  assert.ok(actorAudit.body.items.length > 0)

  const badPage = await admin('/admin/audit?page=abc&limit=abc')
  assert.equal(badPage.status, 200)
  assert.equal(badPage.body.page, 1)
  assert.equal(badPage.body.limit, 20)

  const beforeCount = Number(
    db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,
  )
  const patchLog = await admin(`/admin/audit/${featuredLog.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'tampered' }),
  })
  const deleteLog = await admin(`/admin/audit/${featuredLog.id}`, { method: 'DELETE' })
  const afterCount = Number(
    db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,
  )
  assert.equal(patchLog.status, 404)
  assert.equal(deleteLog.status, 404)
  assert.equal(afterCount, beforeCount)

  const blocked = makeClient()
  const login = await blocked('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '匿名君', password: 'password123' }),
  })
  assert.equal(login.status, 403)
  assert.equal(login.body.error.code, 'ACCOUNT_DISABLED')

  const normal = makeClient()
  await normal('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: '普通用户', email: 'normal@example.com', password: 'password123' }),
  })
  const forbidden = await normal('/admin/stats')
  assert.equal(forbidden.status, 403)
  const forbiddenAudit = await normal('/admin/audit')
  assert.equal(forbiddenAudit.status, 403)
})

test('reports merge duplicates and increment pending count', async () => {
  const admin = makeClient()
  await admin('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '举报管理员',
      email: 'report-admin@example.com',
      password: 'password123',
    }),
  })
  db.prepare("UPDATE users SET role = 'admin' WHERE username = '举报管理员'").run()

  const author = makeClient()
  await author('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '被举报作者',
      email: 'reported-author@example.com',
      password: 'password123',
    }),
  })
  markVerified('被举报作者')
  const created = await author('/questions', {
    method: 'POST',
    body: JSON.stringify({
      title: '这是一个会被举报的问题',
      description: '用于验证举报入口。',
      category: '其他',
    }),
  })
  assert.equal(created.status, 201)
  const questionId = created.body.question.id

  const reporter = makeClient()
  await reporter('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '举报者',
      email: 'reporter@example.com',
      password: 'password123',
    }),
  })

  const before = await admin('/admin/stats')
  const beforePending = before.body.stats.pendingReports

  const invalid = await reporter(`/questions/${questionId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'other', detail: '短' }),
  })
  assert.equal(invalid.status, 400)
  assert.equal(invalid.body.error.field, 'detail')

  const first = await reporter(`/questions/${questionId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'spam', detail: '评论区反复发广告链接' }),
  })
  assert.equal(first.status, 201)
  assert.equal(first.body.duplicate, false)
  assert.equal(first.body.report.status, 'pending')

  const duplicate = await reporter(`/questions/${questionId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'abuse', detail: '换一个理由再报一次' }),
  })
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.duplicate, true)
  assert.equal(duplicate.body.report.id, first.body.report.id)
  assert.equal(
    Number(db.prepare('SELECT COUNT(*) AS n FROM reports WHERE question_id = ?').get(questionId).n),
    1,
  )

  const after = await admin('/admin/stats')
  assert.equal(after.body.stats.pendingReports, beforePending + 1)

  const mine = await reporter('/me/reports')
  assert.equal(mine.status, 200)
  assert.equal(mine.body.items.length, 1)
  assert.equal(mine.body.items[0].question.title, '这是一个会被举报的问题')
  assert.equal(mine.body.items[0].status, 'pending')

  const detail = await reporter(`/questions/${questionId}`)
  assert.equal(detail.body.myReport.id, first.body.report.id)
  const authorView = await author(`/questions/${questionId}`)
  assert.equal(authorView.body.myReport, null)

  const audit = await admin('/admin/audit?q=举报者&limit=20')
  assert.ok(audit.body.items.some((item) => item.action === 'report.created'))
})

test('admin report queue resolves and notifies the reporter', async () => {
  const admin = makeClient()
  await admin('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '队列管理员',
      email: 'queue-admin@example.com',
      password: 'password123',
    }),
  })
  db.prepare("UPDATE users SET role = 'admin' WHERE username = '队列管理员'").run()

  const author = makeClient()
  await author('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '队列作者',
      email: 'queue-author@example.com',
      password: 'password123',
    }),
  })
  markVerified('队列作者')
  const question = await author('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '待审核的问题一', category: '其他' }),
  })
  const reporter = makeClient()
  await reporter('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '队列举报人',
      email: 'queue-reporter@example.com',
      password: 'password123',
    }),
  })
  const report = await reporter(`/questions/${question.body.question.id}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason: 'spam', detail: '这是广告' }),
  })
  assert.equal(report.status, 201)

  const queue = await admin('/admin/reports?status=pending&sort=new')
  assert.equal(queue.status, 200)
  const item = queue.body.items.find((row) => row.id === report.body.report.id)
  assert.ok(item)
  assert.equal(item.reporter.username, '队列举报人')
  assert.equal(item.question.title, '待审核的问题一')
  assert.ok(queue.body.counts.pending >= 1)

  const resolved = await admin(`/admin/reports/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'resolve' }),
  })
  assert.equal(resolved.status, 200)
  assert.equal(resolved.body.report.status, 'resolved')

  const again = await admin(`/admin/reports/${item.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'resolve' }),
  })
  assert.equal(again.status, 409)
  assert.equal(again.body.error.code, 'REPORT_ALREADY_HANDLED')

  const notices = await reporter('/me/notifications')
  assert.equal(notices.status, 200)
  assert.ok(notices.body.unread >= 1)
  assert.ok(notices.body.items.some((notice) => notice.type === 'report.resolved'))
  const read = await reporter('/me/notifications/read', { method: 'POST' })
  assert.equal(read.status, 200)
  assert.ok(read.body.read >= 1)
  const readAgain = await reporter('/me/notifications')
  assert.equal(readAgain.body.unread, 0)

  const mine = await reporter('/me/reports')
  assert.equal(mine.body.items[0].status, 'resolved')
  const audit = await admin('/admin/audit?q=队列管理员&limit=20')
  assert.ok(audit.body.items.some((entry) => entry.action === 'admin.report.resolved'))
  const forbidden = await reporter('/admin/reports')
  assert.equal(forbidden.status, 403)
})

test('report queue rejects, deletes and bans author', async () => {
  const admin = makeClient()
  await admin('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '处置管理员',
      email: 'action-admin@example.com',
      password: 'password123',
    }),
  })
  db.prepare("UPDATE users SET role = 'admin' WHERE username = '处置管理员'").run()

  async function setup(label) {
    const author = makeClient()
    await author('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `${label}作者`,
        email: `${label}-author@example.com`,
        password: 'password123',
      }),
    })
    markVerified(`${label}作者`)
    const question = await author('/questions', {
      method: 'POST',
      body: JSON.stringify({ title: `待处置的问题${label}`, category: '其他' }),
    })
    const reporter = makeClient()
    await reporter('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: `${label}举报人`,
        email: `${label}-reporter@example.com`,
        password: 'password123',
      }),
    })
    const report = await reporter(`/questions/${question.body.question.id}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason: 'abuse', detail: '需要管理员处理' }),
    })
    return { author, reporter, questionId: question.body.question.id, report }
  }

  const rejectedCase = await setup('驳回')
  const rejected = await admin(`/admin/reports/${rejectedCase.report.body.report.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'reject' }),
  })
  assert.equal(rejected.body.report.status, 'rejected')
  const rejectedNotice = await rejectedCase.reporter('/me/notifications')
  assert.ok(rejectedNotice.body.items.some((notice) => notice.type === 'report.rejected'))

  const deletedCase = await setup('删除')
  const deleted = await admin(`/admin/reports/${deletedCase.report.body.report.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'delete_question' }),
  })
  assert.equal(deleted.body.report.status, 'resolved')
  const deletedQuestion = await deletedCase.author(`/questions/${deletedCase.questionId}`)
  assert.equal(deletedQuestion.status, 404)
  const search = await admin('/questions?q=待处置的问题删除')
  assert.equal(search.body.items.length, 0)
  const deletedMine = await deletedCase.reporter('/me/reports')
  assert.equal(deletedMine.body.items[0].status, 'resolved')
  assert.equal(deletedMine.body.items[0].question, undefined)
  const deletedNotice = await deletedCase.reporter('/me/notifications')
  assert.ok(
    deletedNotice.body.items.some((notice) => notice.type === 'report.question_deleted'),
  )

  const bannedCase = await setup('停用')
  const banned = await admin(`/admin/reports/${bannedCase.report.body.report.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'ban_author' }),
  })
  assert.equal(banned.body.report.status, 'resolved')
  assert.equal(await bannedCase.author('/auth/me').then((r) => r.body.user), null)
  const bannedLogin = await makeClient()('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '停用作者', password: 'password123' }),
  })
  assert.equal(bannedLogin.status, 403)
  const bannedNotice = await bannedCase.reporter('/me/notifications')
  assert.ok(bannedNotice.body.items.some((notice) => notice.type === 'report.author_banned'))

  const audit = await admin('/admin/audit?q=处置管理员&limit=50')
  const actions = audit.body.items.map((entry) => entry.action)
  assert.ok(actions.includes('admin.report.rejected'))
  assert.ok(actions.includes('admin.report.question_deleted'))
  assert.ok(actions.includes('admin.report.author_banned'))
})

test('content guard normalizes text and blocks words or too many links', async () => {
  const api = makeClient()
  const blockedName = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '刷单王',
      email: 'blocked-name@example.com',
      password: 'password123',
    }),
  })
  assert.equal(blockedName.status, 400)
  assert.equal(blockedName.body.error.code, 'CONTENT_BLOCKED')
  assert.equal(blockedName.body.error.field, 'username')

  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '内容用户',
      email: 'content@example.com',
      password: 'password123',
    }),
  })
  markVerified('内容用户')

  const blockedTitle = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '我要刷\u200b单', category: '其他' }),
  })
  assert.equal(blockedTitle.status, 400)
  assert.equal(blockedTitle.body.error.code, 'CONTENT_BLOCKED')
  assert.equal(blockedTitle.body.error.field, 'title')

  const manyLinks = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({
      title: '这是一个链接测试问题',
      description: 'https://a.example https://b.example https://c.example',
      category: '其他',
    }),
  })
  assert.equal(manyLinks.status, 400)
  assert.equal(manyLinks.body.error.code, 'TOO_MANY_LINKS')
  assert.equal(manyLinks.body.error.field, 'description')

  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({
      title: 'ＡＢＣＤ',
      description: '全角测试\u200b内容',
      category: '其他',
    }),
  })
  assert.equal(created.status, 201)
  assert.equal(created.body.question.title, 'ABCD')
  assert.equal(created.body.question.description, '全角测试内容')
})

test('posting has a daily limit with retry time', async () => {
  const previous = process.env.POST_DAILY_LIMIT
  process.env.POST_DAILY_LIMIT = '1'
  try {
    const api = makeClient()
    await api('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: '日限用户',
        email: 'daily-limit@example.com',
        password: 'password123',
      }),
    })
    markVerified('日限用户')
    const first = await api('/questions', {
      method: 'POST',
      body: JSON.stringify({ title: '今天的第一条问题', category: '其他' }),
    })
    assert.equal(first.status, 201)
    const second = await api('/questions', {
      method: 'POST',
      body: JSON.stringify({ title: '今天的第二条问题', category: '其他' }),
    })
    assert.equal(second.status, 429)
    assert.equal(second.body.error.code, 'POST_RATE_LIMITED')
    assert.ok(second.body.error.retryAfter > 0)
    assert.ok(second.headers.get('retry-after'))
  } finally {
    if (previous === undefined) delete process.env.POST_DAILY_LIMIT
    else process.env.POST_DAILY_LIMIT = previous
  }
})

test('voting has a per-minute limit with retry time', async () => {
  const previous = process.env.VOTE_RATE_LIMIT
  process.env.VOTE_RATE_LIMIT = '2'
  try {
    const author = makeClient()
    await author('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: '频控作者',
        email: 'rate-author@example.com',
        password: 'password123',
      }),
    })
    markVerified('频控作者')
    const question = await author('/questions', {
      method: 'POST',
      body: JSON.stringify({ title: '用于测试投票频控的问题', category: '其他' }),
    })
    const voter = makeClient()
    await voter('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        username: '频控投票人',
        email: 'rate-voter@example.com',
        password: 'password123',
      }),
    })
    const vote = (choice) =>
      voter(`/questions/${question.body.question.id}/vote`, {
        method: 'POST',
        body: JSON.stringify({ choice, reason: '' }),
      })
    assert.equal((await vote('yes')).status, 200)
    assert.equal((await vote('no')).status, 200)
    const limited = await vote('yes')
    assert.equal(limited.status, 429)
    assert.equal(limited.body.error.code, 'VOTE_RATE_LIMITED')
    assert.ok(limited.body.error.retryAfter > 0)
    assert.ok(limited.headers.get('retry-after'))
  } finally {
    if (previous === undefined) delete process.env.VOTE_RATE_LIMIT
    else process.env.VOTE_RATE_LIMIT = previous
  }
})

test('duplicate reasons are rejected across questions', async () => {
  const author = makeClient()
  await author('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '重复理由作者',
      email: 'reason-author@example.com',
      password: 'password123',
    }),
  })
  markVerified('重复理由作者')
  const q1 = await author('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '重复理由测试一', category: '其他' }),
  })
  const q2 = await author('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '重复理由测试二', category: '其他' }),
  })
  const voter = makeClient()
  await voter('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '重复理由投票人',
      email: 'reason-voter@example.com',
      password: 'password123',
    }),
  })
  const reason = '这是一个足够长而且会被重复使用的理由'
  const first = await voter(`/questions/${q1.body.question.id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason }),
  })
  assert.equal(first.status, 200)
  const duplicate = await voter(`/questions/${q2.body.question.id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason }),
  })
  assert.equal(duplicate.status, 400)
  assert.equal(duplicate.body.error.code, 'DUPLICATE_REASON')
  assert.equal(duplicate.body.error.field, 'reason')
  const different = await voter(`/questions/${q2.body.question.id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '换一个完全不同的表达方式' }),
  })
  assert.equal(different.status, 200)
})

test('vote, reason and closing notifications persist read state', async () => {
  const author = makeClient()
  await author('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '通知作者',
      email: 'notice-author@example.com',
      password: 'password123',
    }),
  })
  markVerified('通知作者')
  const question = await author('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '会收到通知的问题', category: '其他' }),
  })
  const voter = makeClient()
  await voter('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '通知投票人',
      email: 'notice-voter@example.com',
      password: 'password123',
    }),
  })
  await voter(`/questions/${question.body.question.id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '这是一个会触发理由通知的投票' }),
  })

  const notices = await author('/me/notifications')
  assert.equal(notices.status, 200)
  const types = notices.body.items.map((item) => item.type)
  assert.ok(types.includes('question.vote'))
  assert.ok(types.includes('question.reason'))
  assert.ok(notices.body.unread >= 2)

  const read = await author('/me/notifications/read', { method: 'POST' })
  assert.equal(read.status, 200)
  const afterRead = await author('/me/notifications')
  assert.equal(afterRead.body.unread, 0)

  db.prepare('UPDATE questions SET closes_at = ?, close_notified_at = NULL WHERE id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    question.body.question.id,
  )
  notifyClosingQuestions(db)
  notifyClosingQuestions(db)
  const closed = await author('/me/notifications')
  assert.equal(
    closed.body.items.filter((item) => item.type === 'question.closed').length,
    1,
  )
  assert.ok(closed.body.unread >= 1)
})

test('my questions and my votes endpoints', async () => {
  const api = makeClient()
  await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '投票者', password: 'password123' }),
  })
  const mine = await api('/me/questions')
  assert.ok(mine.body.items.length >= 1)
  const votes = await api('/me/votes')
  assert.ok(votes.body.items.length >= 1)
})

test('password change rotates current session and revokes other devices', async () => {
  const owner = makeClient()
  const other = makeClient()
  await owner('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '安全用户',
      email: 'security@example.com',
      password: 'oldpassword',
    }),
  })
  await other('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '安全用户', password: 'oldpassword' }),
  })

  const before = await owner('/me/sessions')
  assert.equal(before.status, 200)
  assert.equal(before.body.items.length, 2)
  assert.equal(before.body.items.filter((s) => s.current).length, 1)
  assert.ok(before.body.items.every((s) => s.device))

  const wrong = await owner('/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'wrong-password', newPassword: 'newpassword' }),
  })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.body.error.field, 'currentPassword')

  const same = await owner('/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'oldpassword', newPassword: 'oldpassword' }),
  })
  assert.equal(same.status, 400)
  assert.equal(same.body.error.field, 'newPassword')

  const changed = await owner('/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'oldpassword', newPassword: 'newpassword' }),
  })
  assert.equal(changed.status, 200)
  assert.ok(changed.body.revoked >= 2)

  const stillMe = await owner('/auth/me')
  assert.equal(stillMe.body.user.username, '安全用户')
  const otherGone = await other('/auth/me')
  assert.equal(otherGone.body.user, null)

  const after = await owner('/me/sessions')
  assert.equal(after.body.items.length, 1)
  assert.equal(after.body.items[0].current, true)

  const oldLogin = makeClient()
  const denied = await oldLogin('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '安全用户', password: 'oldpassword' }),
  })
  assert.equal(denied.status, 401)

  const newLogin = makeClient()
  const allowed = await newLogin('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '安全用户', password: 'newpassword' }),
  })
  assert.equal(allowed.status, 200)
})

test('session revocation is scoped to the signed-in user', async () => {
  const first = makeClient()
  const second = makeClient()
  const stranger = makeClient()
  await first('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '会话用户',
      email: 'sessions@example.com',
      password: 'password123',
    }),
  })
  await second('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '会话用户', password: 'password123' }),
  })
  await stranger('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '旁观者',
      email: 'stranger@example.com',
      password: 'password123',
    }),
  })

  const list = await first('/me/sessions')
  const current = list.body.items.find((s) => s.current)
  const other = list.body.items.find((s) => !s.current)
  assert.ok(current && other)

  const currentRevoke = await first(`/me/sessions/${current.id}`, { method: 'DELETE' })
  assert.equal(currentRevoke.status, 400)

  const crossUser = await stranger(`/me/sessions/${other.id}`, { method: 'DELETE' })
  assert.equal(crossUser.status, 404)

  const revoked = await first(`/me/sessions/${other.id}`, { method: 'DELETE' })
  assert.equal(revoked.status, 200)
  const secondGone = await second('/auth/me')
  assert.equal(secondGone.body.user, null)

  await second('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '会话用户', password: 'password123' }),
  })
  const all = await first('/me/sessions/revoke-others', { method: 'POST' })
  assert.equal(all.status, 200)
  assert.equal(all.body.revoked, 1)
  const secondGoneAgain = await second('/auth/me')
  assert.equal(secondGoneAgain.body.user, null)
  const firstStill = await first('/auth/me')
  assert.equal(firstStill.body.user.username, '会话用户')
})

test('account deletion anonymizes content and frees the identity', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '注销用户',
      email: 'delete@example.com',
      password: 'deletepass',
    }),
  })
  markVerified('注销用户')
  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({
      title: '注销前留下的问题还会显示吗',
      description: '这条内容应该在注销后保留。',
      category: '其他',
    }),
  })
  const id = created.body.question.id
  await api(`/questions/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '注销前的理由' }),
  })

  const before = await api(`/questions/${id}`)
  assert.equal(before.body.question.author.username, '注销用户')
  assert.equal(before.body.reasons[0].author.username, '注销用户')

  const badConfirm = await api('/me', {
    method: 'DELETE',
    body: JSON.stringify({ password: 'deletepass', confirm: '删除' }),
  })
  assert.equal(badConfirm.status, 400)
  assert.equal(badConfirm.body.error.field, 'confirm')

  const badPassword = await api('/me', {
    method: 'DELETE',
    body: JSON.stringify({ password: 'wrong', confirm: '注销' }),
  })
  assert.equal(badPassword.status, 400)
  assert.equal(badPassword.body.error.field, 'password')

  const deleted = await api('/me', {
    method: 'DELETE',
    body: JSON.stringify({ password: 'deletepass', confirm: '注销' }),
  })
  assert.equal(deleted.status, 200)

  const me = await api('/auth/me')
  assert.equal(me.body.user, null)
  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '注销用户', password: 'deletepass' }),
  })
  assert.equal(login.status, 401)

  const after = await api(`/questions/${id}`)
  assert.equal(after.body.question.author.username, '已注销用户')
  assert.equal(after.body.question.author.deleted, true)
  assert.equal(after.body.reasons[0].author.username, '已注销用户')
  assert.equal(after.body.reasons[0].author.deleted, true)

  const row = db
    .prepare('SELECT id, username, email, status FROM users WHERE username LIKE ?')
    .get('已注销用户-%')
  assert.equal(row.status, 'deleted')
  assert.notEqual(row.username, '注销用户')
  assert.notEqual(row.email, 'delete@example.com')
  const tokens = db
    .prepare('SELECT COUNT(*) AS n FROM auth_tokens WHERE user_id = ?')
    .get(row.id)
  assert.equal(tokens.n, 0)

  const admin = makeClient()
  await admin('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '测试用户', password: 'password123' }),
  })
  const stats = await admin('/admin/stats')
  assert.ok(stats.body.stats.deletedUsers >= 1)
  const users = await admin('/admin/users?q=已注销用户')
  const target = users.body.items.find((u) => u.status === 'deleted')
  assert.ok(target)
  const restore = await admin(`/admin/users/${target.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'active' }),
  })
  assert.equal(restore.status, 400)

  const ownDelete = await admin('/me', {
    method: 'DELETE',
    body: JSON.stringify({ password: 'password123', confirm: '注销' }),
  })
  assert.equal(ownDelete.status, 403)
  assert.equal(ownDelete.body.error.code, 'ADMIN_PROTECTED')

  const reuse = makeClient()
  const again = await reuse('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '注销用户',
      email: 'delete@example.com',
      password: 'password123',
    }),
  })
  assert.equal(again.status, 201)
})

test('unverified users can vote but cannot post, unless disabled', async () => {
  const api = makeClient()
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '未验证用户',
      email: 'unverified@example.com',
      password: 'password123',
    }),
  })
  assert.equal(reg.status, 201)
  assert.equal(reg.body.user.emailVerified, false)

  const question = db.prepare('SELECT id FROM questions ORDER BY created_at LIMIT 1').get()
  const vote = await api(`/questions/${question.id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '未验证也能投票' }),
  })
  assert.equal(vote.status, 200)

  const denied = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '验证前不能发的问题', category: '其他' }),
  })
  assert.equal(denied.status, 403)
  assert.equal(denied.body.error.code, 'EMAIL_NOT_VERIFIED')

  const previous = process.env.REQUIRE_VERIFIED_TO_POST
  process.env.REQUIRE_VERIFIED_TO_POST = '0'
  try {
    const meta = await api('/meta')
    assert.equal(meta.body.requireEmailVerification, false)
    const allowed = await api('/questions', {
      method: 'POST',
      body: JSON.stringify({ title: '关闭限制后可以发的问题', category: '其他' }),
    })
    assert.equal(allowed.status, 201)
  } finally {
    if (previous === undefined) delete process.env.REQUIRE_VERIFIED_TO_POST
    else process.env.REQUIRE_VERIFIED_TO_POST = previous
  }

  const metaAgain = await api('/meta')
  assert.equal(metaAgain.body.requireEmailVerification, true)
})

test('dev mailbox verification link verifies once and unlocks posting', async () => {
  const api = makeClient()
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '邮件用户',
      email: 'mail@example.com',
      password: 'password123',
    }),
  })
  assert.equal(reg.body.user.emailVerified, false)

  const item = await mailFor(api, 'mail@example.com')
  assert.ok(item)
  const token = new URL(item.link).searchParams.get('token')
  assert.ok(token)

  const verified = await api(`/auth/verify?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  })
  assert.equal(verified.status, 303)
  assert.match(verified.location ?? '', /status=success/)
  const me = await api('/auth/me')
  assert.equal(me.body.user.emailVerified, true)
  assert.ok(me.body.user.emailVerifiedAt)

  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '验证之后终于可以发问题', category: '其他' }),
  })
  assert.equal(created.status, 201)

  const reused = await api(`/auth/verify?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  })
  assert.equal(reused.status, 303)
  assert.match(reused.location ?? '', /status=used/)
})

test('expired verification tokens are rejected', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '过期邮件',
      email: 'expired@example.com',
      password: 'password123',
    }),
  })
  const item = await mailFor(api, 'expired@example.com')
  assert.ok(item)
  const token = new URL(item.link).searchParams.get('token')

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('expired@example.com')
  db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE user_id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    user.id,
  )

  const verified = await api(`/auth/verify?token=${encodeURIComponent(token)}`, {
    redirect: 'manual',
  })
  assert.equal(verified.status, 303)
  assert.match(verified.location ?? '', /status=expired/)

  const me = await api('/auth/me')
  assert.equal(me.body.user.emailVerified, false)
  const denied = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '过期链接不能解锁发帖', category: '其他' }),
  })
  assert.equal(denied.status, 403)
})

test('resend rotates tokens, rate-limits, and stops after verification', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '重发用户',
      email: 'resend@example.com',
      password: 'password123',
    }),
  })
  const first = await mailFor(api, 'resend@example.com')
  assert.ok(first)
  const firstToken = new URL(first.link).searchParams.get('token')

  const sent = await api('/auth/resend-verification', { method: 'POST' })
  assert.equal(sent.status, 200)
  const again = await api('/auth/resend-verification', { method: 'POST' })
  assert.equal(again.status, 429)
  assert.equal(again.body.error.code, 'TOO_MANY_REQUESTS')

  const old = await api(`/auth/verify?token=${encodeURIComponent(firstToken)}`, {
    redirect: 'manual',
  })
  assert.match(old.location ?? '', /status=used/)

  const second = await mailFor(api, 'resend@example.com')
  assert.ok(second)
  assert.notEqual(second.link, first.link)
  const secondToken = new URL(second.link).searchParams.get('token')
  const verified = await api(`/auth/verify?token=${encodeURIComponent(secondToken)}`, {
    redirect: 'manual',
  })
  assert.match(verified.location ?? '', /status=success/)

  const already = await api('/auth/resend-verification', { method: 'POST' })
  assert.equal(already.status, 409)
  assert.equal(already.body.error.code, 'EMAIL_ALREADY_VERIFIED')
})

test('development mailbox can be disabled', async () => {
  const api = makeClient()
  const previous = process.env.DEV_MAIL
  process.env.DEV_MAIL = '0'
  try {
    const meta = await api('/meta')
    assert.equal(meta.body.devMail, false)
    const mailbox = await api('/dev/mail')
    assert.equal(mailbox.status, 404)
  } finally {
    if (previous === undefined) delete process.env.DEV_MAIL
    else process.env.DEV_MAIL = previous
  }
  const metaOn = await api('/meta')
  assert.equal(metaOn.body.devMail, true)
})

test('forgot password is generic and reset works once', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '找回用户',
      email: 'recover@example.com',
      password: 'oldpass123',
    }),
  })
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('recover@example.com')

  const unknown = await api('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email: 'nobody@example.com' }),
  })
  assert.equal(unknown.status, 200)
  assert.deepEqual(unknown.body, { ok: true })
  assert.equal(await mailFor(api, 'nobody@example.com', 'password_reset'), null)

  const forgot = await api('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email: 'recover@example.com' }),
  })
  assert.equal(forgot.status, 200)
  const item = await mailFor(api, 'recover@example.com', 'password_reset')
  assert.ok(item)
  assert.equal(item.kind, 'password_reset')
  const token = new URL(item.link).searchParams.get('token')
  assert.ok(token)

  const beforeCount = (await api('/dev/mail')).body.items.filter(
    (mail) => mail.to === 'recover@example.com' && mail.kind === 'password_reset',
  ).length
  await api('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email: 'recover@example.com' }),
  })
  const afterCount = (await api('/dev/mail')).body.items.filter(
    (mail) => mail.to === 'recover@example.com' && mail.kind === 'password_reset',
  ).length
  assert.equal(afterCount, beforeCount)

  const reset = await api('/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password: 'newpass123' }),
  })
  assert.equal(reset.status, 200)
  const me = await api('/auth/me')
  assert.equal(me.body.user, null)

  const oldClient = makeClient()
  const oldLogin = await oldClient('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '找回用户', password: 'oldpass123' }),
  })
  assert.equal(oldLogin.status, 401)

  const newClient = makeClient()
  const newLogin = await newClient('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '找回用户', password: 'newpass123' }),
  })
  assert.equal(newLogin.status, 200)
  assert.equal(newLogin.body.user.emailVerified, true)

  const reuse = await api('/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password: 'another123' }),
  })
  assert.equal(reuse.status, 400)
  assert.equal(reuse.body.error.code, 'INVALID_RESET_TOKEN')

  const actions = db
    .prepare('SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY created_at')
    .all(user.id)
    .map((row) => row.action)
  assert.ok(actions.includes('auth.password.reset_requested'))
  assert.ok(actions.includes('auth.password.reset'))
})

test('expired reset tokens are rejected without changing the password', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '过期重置',
      email: 'resetexp@example.com',
      password: 'oldpass123',
    }),
  })
  await api('/auth/forgot', {
    method: 'POST',
    body: JSON.stringify({ email: 'resetexp@example.com' }),
  })
  const item = await mailFor(api, 'resetexp@example.com', 'password_reset')
  assert.ok(item)
  const token = new URL(item.link).searchParams.get('token')
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('resetexp@example.com')
  db.prepare(
    "UPDATE auth_tokens SET expires_at = ? WHERE user_id = ? AND purpose = 'password_reset'",
  ).run(new Date(Date.now() - 60_000).toISOString(), user.id)

  const reset = await api('/auth/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password: 'newpass123' }),
  })
  assert.equal(reset.status, 400)
  assert.equal(reset.body.error.code, 'INVALID_RESET_TOKEN')

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '过期重置', password: 'oldpass123' }),
  })
  assert.equal(login.status, 200)
})

test('login locks after five failures and unlocks after the window', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '锁定用户',
      email: 'lock@example.com',
      password: 'correct123',
    }),
  })
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get('lock@example.com')

  for (let i = 0; i < 4; i += 1) {
    const failed = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier: '锁定用户', password: 'wrong-pass' }),
    })
    assert.equal(failed.status, 401)
  }
  const fifth = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '锁定用户', password: 'wrong-pass' }),
  })
  assert.equal(fifth.status, 429)
  assert.equal(fifth.body.error.code, 'ACCOUNT_LOCKED')

  const locked = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '锁定用户', password: 'correct123' }),
  })
  assert.equal(locked.status, 429)
  assert.equal(locked.body.error.code, 'ACCOUNT_LOCKED')

  const row = db
    .prepare('SELECT failed_login_count, locked_until FROM users WHERE id = ?')
    .get(user.id)
  assert.equal(row.failed_login_count, 5)
  assert.ok(row.locked_until)

  db.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(
    new Date(Date.now() - 60_000).toISOString(),
    user.id,
  )
  const unlocked = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '锁定用户', password: 'correct123' }),
  })
  assert.equal(unlocked.status, 200)
  const after = db
    .prepare('SELECT failed_login_count, locked_until FROM users WHERE id = ?')
    .get(user.id)
  assert.equal(after.failed_login_count, 0)
  assert.equal(after.locked_until, null)

  const actions = db
    .prepare('SELECT action FROM audit_logs WHERE actor_id = ? ORDER BY created_at')
    .all(user.id)
    .map((entry) => entry.action)
  assert.ok(actions.includes('auth.login.failed'))
  assert.ok(actions.includes('auth.login.locked'))
  assert.ok(actions.includes('auth.login.success'))
})

test('CSRF bootstrap sets a readable cookie and guards writes', async () => {
  const api = makeClient()
  const boot = await api('/csrf')
  assert.equal(boot.status, 200)
  assert.equal(typeof boot.body.token, 'string')
  const csrfCookie = boot.setCookies.find((item) => item.startsWith('dd_csrf='))
  assert.ok(csrfCookie)
  assert.match(csrfCookie, /Path=\//)
  assert.match(csrfCookie, /SameSite=Lax/)
  assert.ok(!/HttpOnly/i.test(csrfCookie))

  const missing = await api('/auth/register', {
    method: 'POST',
    csrf: false,
    body: JSON.stringify({
      username: '无令牌用户',
      email: 'no-csrf@example.com',
      password: 'password123',
    }),
  })
  assert.equal(missing.status, 403)
  assert.equal(missing.body.error.code, 'BAD_CSRF')

  const wrong = await api('/auth/register', {
    method: 'POST',
    csrf: 'a'.repeat(60),
    body: JSON.stringify({
      username: '错令牌用户',
      email: 'wrong-csrf@example.com',
      password: 'password123',
    }),
  })
  assert.equal(wrong.status, 403)
  assert.equal(wrong.body.error.code, 'BAD_CSRF')

  const registered = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: 'CSRF用户',
      email: 'csrf@example.com',
      password: 'password123',
    }),
  })
  assert.equal(registered.status, 201)
  assert.notEqual(registered.body.csrfToken, boot.body.token)
  assert.equal(api.cookie('dd_csrf'), registered.body.csrfToken)

  markVerified('CSRF用户')
  const blocked = await api('/questions', {
    method: 'POST',
    csrf: false,
    body: JSON.stringify({ title: '缺少令牌的写请求应该失败', category: '生活' }),
  })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.body.error.code, 'BAD_CSRF')

  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '带令牌的写请求应该成功', category: '生活' }),
  })
  assert.equal(created.status, 201)
})

test('cross-site origin cannot vote even with a valid CSRF token', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '跨站用户',
      email: 'origin@example.com',
      password: 'password123',
    }),
  })
  markVerified('跨站用户')
  const created = await api('/questions', {
    method: 'POST',
    body: JSON.stringify({ title: '跨站请求能不能投票？', category: '其他' }),
  })
  assert.equal(created.status, 201)
  const id = created.body.question.id

  const evil = await api(`/questions/${id}/vote`, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ choice: 'yes', reason: '伪造来源' }),
  })
  assert.equal(evil.status, 403)
  assert.equal(evil.body.error.code, 'BAD_ORIGIN')

  const opaque = await api(`/questions/${id}/vote`, {
    method: 'POST',
    headers: { origin: 'null' },
    body: JSON.stringify({ choice: 'yes', reason: '空来源' }),
  })
  assert.equal(opaque.status, 403)
  assert.equal(opaque.body.error.code, 'BAD_ORIGIN')

  const before = await api(`/questions/${id}`)
  assert.equal(before.body.question.myVote, null)

  const valid = await api(`/questions/${id}/vote`, {
    method: 'POST',
    body: JSON.stringify({ choice: 'yes', reason: '同源请求' }),
  })
  assert.equal(valid.status, 200)
  assert.equal(valid.body.question.myVote.choice, 'yes')
})

test('login rotates both the session and the CSRF token', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '轮换登录用户',
      email: 'rotate-login@example.com',
      password: 'password123',
    }),
  })
  const oldSession = api.cookie('dd_session')
  const oldCsrf = api.cookie('dd_csrf')
  assert.ok(oldSession)
  assert.ok(oldCsrf)

  const login = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ identifier: '轮换登录用户', password: 'password123' }),
  })
  assert.equal(login.status, 200)
  assert.notEqual(login.body.csrfToken, oldCsrf)
  assert.equal(api.cookie('dd_csrf'), login.body.csrfToken)
  assert.notEqual(api.cookie('dd_session'), oldSession)

  const stale = makeClient()
  stale.setCookie(`dd_session=${oldSession}`)
  const staleMe = await stale('/auth/me')
  assert.equal(staleMe.body.user, null)

  const current = await api('/auth/me')
  assert.equal(current.body.user.username, '轮换登录用户')
})

test('trusted proxy yields secure cookies and forwarded client ip', async () => {
  const setup = makeClient()
  await setup('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '代理用户',
      email: 'proxy@example.com',
      password: 'password123',
    }),
  })

  const previous = process.env.TRUST_PROXY
  process.env.TRUST_PROXY = '1'
  try {
    const proxied = makeClient()
    await proxied.ensureCsrf()
    const login = await proxied('/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-for': '203.0.113.9',
      },
      body: JSON.stringify({ identifier: '代理用户', password: 'password123' }),
    })
    assert.equal(login.status, 200)
    const sessionCookie = login.setCookies.find((item) => item.startsWith('dd_session='))
    const csrfCookie = login.setCookies.find((item) => item.startsWith('dd_csrf='))
    assert.ok(sessionCookie)
    assert.ok(csrfCookie)
    assert.match(sessionCookie, /Secure/)
    assert.match(csrfCookie, /Secure/)
    assert.ok(!/HttpOnly/i.test(csrfCookie))

    const sessions = await proxied('/me/sessions', {
      headers: { 'x-forwarded-for': '203.0.113.9' },
    })
    assert.equal(sessions.status, 200)
    assert.equal(sessions.body.items[0].ip, '203.0.113.9')
  } finally {
    if (previous === undefined) delete process.env.TRUST_PROXY
    else process.env.TRUST_PROXY = previous
  }
})

test('security headers include report-only CSP and hardening headers', async () => {
  const root = base.replace(/\/api$/, '')
  const res = await fetch(`${root}/api/meta`)
  assert.equal(res.status, 200)
  const csp = res.headers.get('content-security-policy-report-only')
  assert.ok(csp)
  assert.match(csp, /default-src 'self'/)
  assert.match(csp, /script-src 'self'/)
  assert.match(csp, /style-src 'self' 'unsafe-inline'/)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(res.headers.get('permissions-policy'))
  assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin')
  assert.equal(res.headers.get('cross-origin-resource-policy'), 'same-origin')

  const health = await fetch(`${root}/api/health`)
  assert.equal(health.status, 200)
  const healthBody = await health.json()
  assert.equal(healthBody.status, 'ok')
  assert.equal(healthBody.db, 'ok')
})

test('observability exposes request id, metrics and HTML error page', async () => {
  const root = base.replace(/\/api$/, '')
  const requestId = 'test-request-123456'
  const meta = await fetch(`${root}/api/meta`, {
    headers: { 'X-Request-ID': requestId },
  })
  assert.equal(meta.status, 200)
  assert.equal(meta.headers.get('x-request-id'), requestId)

  const metrics = await fetch(`${root}/metrics`)
  assert.equal(metrics.status, 200)
  const text = await metrics.text()
  assert.match(text, /dajia_http_requests_total/)
  assert.match(text, /dajia_db_questions/)
  assert.match(text, /dajia_db_votes/)

  const missing = await fetch(`${root}/missing-asset.js`)
  assert.equal(missing.status, 404)
  assert.match(missing.headers.get('content-type') || '', /text\/html/)
  assert.ok(missing.headers.get('x-request-id'))
  assert.match(await missing.text(), /页面不存在/)
})

test('healthz exposes release and schema versions', async () => {
  const root = base.replace(/\/api$/, '')
  const health = await fetch(`${root}/healthz`)
  assert.equal(health.status, 200)
  assert.match(health.headers.get('content-type') || '', /application\/json/)
  assert.equal(health.headers.get('cache-control'), 'no-store')
  const body = await health.json()
  assert.equal(body.status, 'ok')
  assert.equal(body.db, 'ok')
  assert.equal(body.version, pkg.version)
  assert.equal(body.schemaVersion, SCHEMA_VERSION)
  assert.equal(body.schemaName, SCHEMA_NAME)
  assert.ok(body.schemaAppliedAt)
  assert.ok(body.startedAt)

  const head = await fetch(`${root}/healthz`, { method: 'HEAD' })
  assert.equal(head.status, 200)
  assert.equal(await head.text(), '')

  const apiHealth = await fetch(`${root}/api/health`)
  assert.equal(apiHealth.status, 200)
  const apiBody = await apiHealth.json()
  assert.equal(apiBody.version, pkg.version)
  assert.equal(apiBody.schemaVersion, SCHEMA_VERSION)
})

test('password change and logout rotate CSRF tokens', async () => {
  const api = makeClient()
  await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: '边界轮换用户',
      email: 'rotate-boundary@example.com',
      password: 'password123',
    }),
  })
  const initial = api.cookie('dd_csrf')
  const changed = await api('/me/password', {
    method: 'POST',
    body: JSON.stringify({ currentPassword: 'password123', newPassword: 'password456' }),
  })
  assert.equal(changed.status, 200)
  assert.notEqual(changed.body.csrfToken, initial)
  assert.equal(api.cookie('dd_csrf'), changed.body.csrfToken)

  const logout = await api('/auth/logout', { method: 'POST' })
  assert.equal(logout.status, 200)
  assert.notEqual(logout.body.csrfToken, changed.body.csrfToken)
  assert.equal(api.cookie('dd_csrf'), logout.body.csrfToken)
  const me = await api('/auth/me')
  assert.equal(me.body.user, null)
})
