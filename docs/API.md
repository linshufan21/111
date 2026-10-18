# API 契约

Base URL: `/api`。除 `GET /auth/verify` 的 303 跳转外，请求/响应均为 JSON（UTF-8）。认证使用 HttpOnly Cookie `dd_session`；所有非 GET/HEAD 请求还必须携带 `dd_csrf` Cookie 与 `X-CSRF-Token` 请求头。

错误统一格式：

```json
{ "error": { "code": "INVALID_INPUT", "message": "标题最多 80 个字符", "field": "title" } }
```

所有响应带 `X-Request-ID`；错误对象可能包含 `requestId`。限流错误额外带 `retryAfter`（秒），并设置 `Retry-After` 响应头：

```json
{ "error": { "code": "VOTE_RATE_LIMITED", "message": "投票太频繁，请 42 秒后再试", "retryAfter": 42 } }
```

| code | HTTP | 含义 |
|---|---|---|
| `INVALID_INPUT` | 400 | 字段校验失败（带 `field`） |
| `CONTENT_BLOCKED` | 400 | 命中敏感词（带 `field`） |
| `TOO_MANY_LINKS` | 400 | 单字段链接数超过上限（带 `field`） |
| `DUPLICATE_REASON` | 400 | 跨题重复使用同一理由（带 `field=reason`） |
| `POST_RATE_LIMITED` | 429 | 达到当日发帖上限 |
| `VOTE_RATE_LIMITED` | 429 | 投票/改票过于频繁 |
| `UNAUTHORIZED` | 401 | 未登录或会话过期 |
| `BAD_CREDENTIALS` | 401 | 账号或密码错误 |
| `NOT_FOUND` | 404 | 问题/接口不存在 |
| `QUESTION_CLOSED` | 409 | 已截止，禁止投票 |
| `REPORT_CONFLICT` | 409 | 举报写入冲突，请重试 |
| `REPORT_ALREADY_HANDLED` | 409 | 举报已经处理过 |
| `CONFLICT` | 409 | 昵称/邮箱重复（带 `field`） |
| `FORBIDDEN` | 403 | 需要管理员权限 |
| `ACCOUNT_DISABLED` | 403 | 账号被管理员停用 |
| `ACCOUNT_DELETED` | 403 | 账号已注销（正常流程下密码已失效，登录会先返回 401） |
| `ADMIN_PROTECTED` | 403 | 管理员账号不能自助注销 |
| `EMAIL_NOT_VERIFIED` | 403 | 未验证邮箱，不能发起问题 |
| `BAD_ORIGIN` | 403 | 跨站写请求被拒绝 |
| `BAD_CSRF` | 403 | 缺少、伪造或过期的 CSRF token |
| `EMAIL_ALREADY_VERIFIED` | 409 | 邮箱已经验证，无需重发 |
| `INVALID_RESET_TOKEN` | 400 | 重置链接无效、过期或已使用 |
| `TOO_MANY_ATTEMPTS` | 429 | 登录限流 |
| `ACCOUNT_LOCKED` | 429 | 账号连续登录失败被锁定 15 分钟 |
| `TOO_MANY_REQUESTS` | 429 | 验证邮件发送过于频繁 |
| `MAIL_SEND_FAILED` | 502 | 验证邮件发送失败（生产环境未配置 SMTP） |

## CSRF 与 Cookie

浏览器端写请求流程：

1. `GET /api/csrf` → `200 { "token": "..." }`，同时下发 `Set-Cookie: dd_csrf=...`；
2. 后续 `POST/PATCH/PUT/DELETE` 带 `X-CSRF-Token: <token>`；
3. 服务端要求 Cookie 与 Header 都存在、HMAC 签名有效且完全一致，否则 `403 BAD_CSRF`；
4. `Origin` 必须与当前站点或 `APP_URL` 一致；`Origin: null` 同样拒绝，否则 `403 BAD_ORIGIN`。

Cookie 属性：

| Cookie | HttpOnly | SameSite | 用途 |
|---|---|---|---|
| `dd_session` | 是 | Lax | 30 天登录会话，服务端只存 token 哈希 |
| `dd_csrf` | 否 | Lax | 双提交 CSRF token，前端需要读取 |

- HTTPS（含受信任代理）下两枚 Cookie 均带 `Secure`；`NODE_ENV=production` 时强制 Secure。
- `COOKIE_SECURE=1/0` 可显式覆盖自动判断；`0` 只适用于本地 HTTP 容器。
- `TRUST_PROXY=1` 才读取 `X-Forwarded-Proto` / `X-Forwarded-For`。
- 生产 HSTS 由 Nginx `deploy/nginx.conf` 发送；应用层 `HSTS=0` 可避免重复，本地自签配置不发送 HSTS。
- 登录、注册、登出、改密、重置会轮换 CSRF token，并在响应中返回新的 `csrfToken`。
- `GET /auth/verify` 是邮件链接的特例，保持无 CSRF 的顶层导航。

## Health

### GET /healthz

容器/负载均衡探针，位于 `/api` 前缀之外：

```json
{
  "status": "ok",
  "db": "ok",
  "version": "0.1.0",
  "commit": "abc123def456",
  "mail": "brevo",
  "schemaVersion": 14,
  "schemaName": "day14-release-healthz",
  "schemaAppliedAt": "2026-10-18T08:00:00.000Z",
  "uptime": 14,
  "startedAt": "2026-10-18T08:00:00.000Z"
}
```

- 无需认证、无 CSRF，`Cache-Control: no-store`，支持 `GET` / `HEAD`。
- 数据库不可用时返回 `503 { "status": "error", "db": "unavailable", ... }`，不返回内部错误详情。
- `version` 来自 `APP_VERSION` 或 `package.json`；`schemaVersion` 来自 `schema_meta`。
- `commit` 来自 `GIT_SHA` / `COMMIT_SHA`，未注入时为 `null`。
- `mail` 为 `dev` / `brevo` / `resend` / `disabled`，只表示配置状态，不暴露 key。

### GET /health

兼容别名，字段与 `/healthz` 相同。Docker/Compose 健康检查使用 `/healthz`。

生产启动自检要求 `CSRF_SECRET` 至少 32 字符，并检查 SQLite `quick_check` 与数据库目录可写；失败时进程直接退出。数据库 schema 版本高于当前代码时也会拒绝启动。

### GET /metrics
→ `200 text/plain; version=0.0.4`，Prometheus 指标：请求数、最近延迟 p50/p95/p99、业务计数、SQLite 主库体积。

- 无需认证；Nginx 仅允许本机/私网抓取，公网返回 403。
- 指标保存在进程内存，重启归零。
- 详见 [OBSERVABILITY.md](OBSERVABILITY.md)。

## Auth

### GET /csrf
→ `200 { "token": "nonce.signature" }` + `Set-Cookie: dd_csrf=...`

`Cache-Control: no-store`。前端在第一次写请求前自动调用；已存在有效 Cookie 时复用。

### POST /auth/register
```json
{ "username": "林小满", "email": "a@b.com", "password": "至少8位" }
```
→ `201 { "user": { ..., "emailVerified": false }, "verificationSent": true, "csrfToken": "..." }` + `Set-Cookie: dd_session` + 轮换后的 `dd_csrf`

注册后即登录，但邮箱默认未验证。开发环境验证邮件写入控制台和 `/dev/mail`；生产环境在 Day 21 接入真实 SMTP 前不会投递，此时 `verificationSent=false`，前端展示 `send-failed` 状态。

### POST /auth/login
```json
{ "identifier": "demo 或邮箱", "password": "demo1234" }
```
→ `200 { "user": ..., "csrfToken": "..." }` + 新的 `dd_session` 与 `dd_csrf`

- 登录会销毁请求里旧 Cookie 对应的 session，再签发新 token（会话固定防护）；
- 同一账号连续 5 次密码错误后锁定 15 分钟，期间即使密码正确也返回 `429 ACCOUNT_LOCKED`；
- 同一 IP 每分钟最多 60 次登录请求，同一 IP + 标识每分钟最多 10 次；
- 登录成功会清零失败计数并写审计。

### POST /auth/forgot
```json
{ "email": "a@b.com" }
```
→ `200 { "ok": true }`

无论邮箱是否存在都返回相同结果，避免账号枚举。邮箱存在且账号正常时，签发 30 分钟有效的重置 token 并发送邮件；60 秒内重复请求不会重复发送。

### POST /auth/reset
```json
{ "token": "邮件中的 token", "password": "至少8位，≤72位" }
```
→ `200 { "ok": true, "csrfToken": "..." }` + 清除 `dd_session` + 轮换 `dd_csrf`

- token 一次性、30 分钟有效、只存 SHA-256；
- 成功后会吊销该用户全部会话、清零登录锁定，并把邮箱视为已验证；
- 无效/过期/已使用：`400 INVALID_RESET_TOKEN`。

### POST /auth/logout
→ `200 { "ok": true, "csrfToken": "..." }` + 清除 `dd_session` + 轮换 `dd_csrf`

### GET /auth/me
→ `200 { "user": User | null }`

### GET /auth/verify?token=
验证邮箱。成功、过期、重复使用或无效时分别 `303` 跳转：

```text
/verify-email?status=success
/verify-email?status=expired
/verify-email?status=used
/verify-email?status=invalid
```

- token 为一次性随机值，数据库中只保存 SHA-256；
- 有效期 24 小时；
- 验证成功会标记该用户其他未使用的验证 token 为已用；
- 响应带 `Cache-Control: no-store` 与 `Referrer-Policy: no-referrer`。

### POST /auth/resend-verification（需登录）
→ `200 { "ok": true }`

- 已验证：`409 EMAIL_ALREADY_VERIFIED`
- 注册后的第一封不计入冷却；从第二次发送起，60 秒内重复请求返回 `429 TOO_MANY_REQUESTS`
- 重发会作废旧 token
- 生产环境无 SMTP 时返回 `502 MAIL_SEND_FAILED`

### GET /meta
→ `200 { "requireEmailVerification": true, "devMail": true }`

`devMail` 为真时前端会展示 `/dev/mail` 入口；生产环境恒为 false。

### GET /dev/mail
仅开发环境。→ `200 { "items": DevMailItem[] }`；关闭时 `404 NOT_FOUND`。

Item 包含 `id / kind / from / to / subject / text / link / createdAt / expiresAt`，`kind` 为 `email_verify | password_reset`；最多保留最近 50 封，进程重启后清空。

## Questions

### GET /questions
Query：
- `sort`: `new | hot | controversial | closing`（默认 new）
- `category`: `all | 消费 | 生活 | 工作 | 关系 | 其他`
- `q`: 关键词（标题/补充说明）
- `cursor`: 上一页返回的 `nextCursor`
- `limit`: 1–30（默认 12）

→
```json
{
  "items": [Question],
  "nextCursor": "base64url 或 null"
}
```

### POST /questions（需登录）
```json
{
  "title": "我要不要买 iPhone 18？",
  "description": "补充背景，可空",
  "category": "消费",
  "closesAt": "2026-10-24T12:00:00.000Z 或 null",
  "anonymous": false
}
```
→ `201 { "question": Question }`

`REQUIRE_VERIFIED_TO_POST` 开启（默认）且邮箱未验证时返回 `403 EMAIL_NOT_VERIFIED`。浏览、投票、写理由不受影响。

### GET /questions/:id
→ `{ "question": Question, "reasons": [Reason], "myReport": Report | null }`

登录用户会返回自己对这个问题的最新举报；未登录或未举报为 `null`。

### POST /questions/:id/vote（需登录，upsert）
```json
{ "choice": "yes", "reason": "可选，≤200 字", "anonymous": false }
```
→ `200 { "question": Question }`

### DELETE /questions/:id/vote（需登录）
→ `200 { "question": Question }`

## Reports

### POST /questions/:id/report（需登录）
```json
{ "reason": "spam", "detail": "可选，≤300 字" }
```

`reason` 取值：`spam`（垃圾广告）、`abuse`（辱骂攻击）、`privacy`（泄露隐私）、`misleading`（误导虚假）、`other`（其他）。选择 `other` 时 `detail` 至少 5 个字。

→ 首次 `201 { "report": Report, "duplicate": false }`
→ 重复 `200 { "report": Report, "duplicate": true }`，返回原记录，不新增行。

- 同一用户对同一问题唯一：`UNIQUE(question_id, reporter_id)`；
- 新举报写入 `report.created` 审计，管理台 `stats.pendingReports + 1`；
- 不存在的题目返回 `404`。

## Me（需登录）

- `GET /me/questions` → `{ items: Question[] }`
- `GET /me/votes` → `{ items: Question[] }`
- `GET /me/reports` → `{ items: Report[] }`，每项附带 `question: { id, title, status }`，按提交时间倒序；问题被删除后不返回 `question`，标题仍保留在 `Report` 快照中。
- `GET /me/notifications` → `{ items: Notification[], unread }`，最近 20 条。
- `POST /me/notifications/read` → `{ ok: true, read: n }`，把当前用户全部未读通知标记为已读。

通知类型：

- `question.vote`：有人给作者的问题投票；payload 含 `questionId / title / choice / voter`，匿名投票时 `voter=null`；
- `question.reason`：作者收到一条新理由；payload 同上；
- `question.closed`：问题截止；每分钟 worker 写入一次，`questions.close_notified_at` 去重；
- `report.resolved / rejected / question_deleted / author_banned`：举报处理结果，payload 含 `reportId / questionId / title / status / action`。

`GET /me/notifications` 返回最近 20 条，未读优先；`POST /me/notifications/read` 标记全部已读。`NODE_ENV=test` 或 `NOTIFY_WORKER=0` 时关闭截止 worker。

### POST /me/password
```json
{ "currentPassword": "旧密码", "newPassword": "至少8位，≤72位" }
```
→ `200 { "ok": true, "revoked": 2, "csrfToken": "..." }` + 新的 `dd_session` 与 `dd_csrf`。

改密成功后**所有旧会话立即失效**，当前设备换发新 token；新密码不能与旧密码相同。

### GET /me/sessions
→ `{ "items": SessionInfo[] }`，当前设备排在第一条，`current: true`。

### DELETE /me/sessions/:id
退出指定会话。不能删除当前会话（返回 400），也不能删除别人的会话（返回 404）。

### POST /me/sessions/revoke-others
→ `{ "ok": true, "revoked": 1 }`，保留当前设备，退出其他所有设备。

### DELETE /me（注销账号）
```json
{ "password": "当前密码", "confirm": "注销" }
```
→ `200 { "ok": true, "csrfToken": "..." }` + 清除 `dd_session` + 轮换 `dd_csrf`。

- 校验当前密码，并要求 `confirm` 精确等于 `注销`；
- 昵称、邮箱、密码立即清理，所有会话删除，账号 `status='deleted'`；
- 已发布的问题、投票和理由保留，作者对外显示为「已注销用户」；
- 原昵称与邮箱释放，可重新注册；
- 管理员账号不能自助注销，返回 `ADMIN_PROTECTED`。

## Admin（需要 `users.role = 'admin'`）

### GET /admin/reports?status=pending|resolved|rejected|all&sort=new|old|most&q=&page=1&limit=20
→ `{ items: AdminReport[], total, page, limit, counts: { pending, resolved, rejected } }`

- `status` 默认 `pending`；`sort` 默认最新，`most` 按同题举报数倒序。
- `q` 模糊匹配举报人、问题标题、补充说明与原因。
- `AdminReport` 含举报信息、举报人、问题/作者快照、处理人和同题举报数。

### PATCH /admin/reports/:id
```json
{ "action": "resolve" }
```

`action`：

| 值 | 行为 |
|---|---|
| `resolve` | 标记已处理，保留问题 |
| `reject` | 标记已驳回 |
| `delete_question` | 删除问题；同题全部待处理举报一起标记已处理，并通知所有举报人 |
| `ban_author` | 停用问题作者、删除其会话，并通知举报人 |

- 已处理/已驳回的举报再次操作返回 `409 REPORT_ALREADY_HANDLED`。
- 每个动作写入审计；举报人收到站内通知。
- 删除问题后举报保留标题/作者快照，`question_id` 变为 `null`。

### GET /admin/audit?q=&category=&action=&targetType=&page=1&limit=20
→ `{ items: AuditLog[], total, page, limit }`，按 `created_at DESC` 返回。

- `category`：`all | admin | auth | content | users`；`content` 对应 `admin.question.*`，`users` 对应 `admin.user.*`。
- `q`：模糊匹配动作、操作者昵称、目标 id、`meta` JSON。
- `action` / `targetType`：精确筛选；`limit` 最大 50。
- 只读接口；没有 `PATCH /admin/audit/:id` 或 `DELETE /admin/audit/:id`，请求返回 404。
- 审计由服务端自动写入，当前动作：
  - `admin.question.featured / unfeatured / closed / reopened / deleted`
  - `admin.user.banned / unbanned`
  - `admin.report.resolved / rejected / question_deleted / author_banned`
  - `report.created`
  - `auth.register / login.success / login.failed / login.locked / password.change / password.reset_requested / password.reset`

### GET /admin/stats
→ `{ stats, categories, recent }`：用户/问题/投票/理由总数、今日增量、分类分布、最近问题、`stats.pendingReports` 待处理举报数。`stats.users` 不包含已注销账号，另有 `stats.deletedUsers`。

### GET /admin/questions?q=&status=open|closed|all&page=1
→ `{ items, total, page, limit }`，条目含作者、票数、理由数、状态、精选标记。

### PATCH /admin/questions/:id
```json
{ "featured": true, "closed": true }
```
`featured` 置顶到信息流；`closed=true` 把截止时间设为现在，`false` 重新开放。

### DELETE /admin/questions/:id
删除问题及其投票/理由（外键级联）。

### GET /admin/users?q=
→ `{ items: AdminUser[] }`，含发起数、投票数、角色、状态（`active | banned | deleted`）与 `emailVerified`。

### PATCH /admin/users/:id
```json
{ "status": "banned" }
```
停用会立即删除该用户的会话；不能停用自己或其他管理员。`active` 恢复。已注销账号不可操作（返回 400）。

管理员账号由 seed 创建：`admin / admin1234`。

## DTO

```ts
type User = {
  id: string
  username: string
  email: string
  avatarHue: number
  role: 'user' | 'admin'
  status: 'active' | 'banned' | 'deleted'
  emailVerified: boolean
  emailVerifiedAt: string | null
  createdAt: string | null
}

type DevMailItem = {
  id: string
  kind: 'email_verify' | 'password_reset'
  from: string
  to: string
  subject: string
  text: string
  link: string
  createdAt: string
  expiresAt: string
}

type Author = {
  username: string
  avatarHue: number
  deleted?: boolean       // 已注销作者，username 固定为「已注销用户」
}

type SessionInfo = {
  id: string              // 公开会话 id，不是 token
  current: boolean
  device: string          // 例：Edge · Windows
  ip: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
}

type AuditLog = {
  id: string
  action: string
  actor: { id: string; username: string } | null
  targetType: 'question' | 'user' | null
  targetId: string | null
  meta: Record<string, unknown>
  ip: string
  createdAt: string
}

type Report = {
  id: string
  reason: 'spam' | 'abuse' | 'privacy' | 'misleading' | 'other'
  detail: string
  status: 'pending' | 'resolved' | 'rejected'
  createdAt: string
  handledAt: string | null
  question?: { id: string; title: string; status: 'open' | 'closed' }
}

type AdminReport = Report & {
  questionTitle: string
  reporter: { id: string; username: string }
  handledBy: { username: string } | null
  question: {
    id: string
    title: string
    status: 'open' | 'closed'
    author: { id: string; username: string } | null
    reportCount: number
  } | null
}

type Notification = {
  id: string
  type:
    | 'question.vote'
    | 'question.reason'
    | 'question.closed'
    | 'report.resolved'
    | 'report.rejected'
    | 'report.question_deleted'
    | 'report.author_banned'
  payload: Record<string, unknown>
  readAt: string | null
  createdAt: string
}

type Question = {
  id: string
  title: string
  description: string
  category: '消费' | '生活' | '工作' | '关系' | '其他'
  createdAt: string        // ISO UTC
  closesAt: string | null
  status: 'open' | 'closed'
  anonymous: boolean
  author: { username: string; avatarHue: number } | null
  counts: { yes: number; no: number; total: number; reasons: number }
  myVote: { choice: 'yes' | 'no'; reason: string; anonymous?: boolean } | null
  isMine: boolean
}

type Reason = {
  choice: 'yes' | 'no'
  reason: string
  updatedAt: string
  mine?: boolean
  author: { username: string; avatarHue: number } | null
}
```

## 约束

- 请求体上限 32 KB；所有写操作校验 `Origin`（同源、`APP_URL`；非生产环境额外允许 localhost）与双提交 CSRF。
- 标题 4–80 字；说明 ≤500 字；理由 ≤200 字；密码 8–72 位。
- `dd_session` 为 HttpOnly；`dd_csrf` 需可被前端读取，因此不加 HttpOnly，但带签名校验。
- 一个用户对一个问题的投票唯一，重复提交为改票。
- 截止时间早于当前时间 + 1 分钟会被拒绝。
- 登录限流：同一 IP 每分钟最多 60 次，同一 IP + 标识每分钟最多 10 次。
- 账号连续 5 次密码错误后锁定 15 分钟；登录成功、改密、重置密码会清零。
- 会话 30 天有效；每次请求最多每 5 分钟更新一次 `lastSeenAt`。
- 注销账号不可恢复；内容匿名化但保留。
- 邮箱验证 token 24 小时有效、一次性、只存 hash；重发会作废旧 token。
- 密码重置 token 30 分钟有效、一次性、只存 hash；重置成功吊销全部会话。
- 既有账号迁移时视为已验证；新注册账号默认未验证。
- 开发邮件箱仅在 `NODE_ENV !== 'production' && DEV_MAIL !== '0'` 时启用；进程重启后清空。
- 登录、登录失败/锁定、注册、改密、重置申请/完成、管理动作、举报提交会写入 `audit_logs`；审计日志只读，没有修改/删除 API。
- 举报原因限定 5 种；同一用户对同一问题只保留一条，重复提交返回原记录。
- 删除问题时举报记录保留标题/作者快照，`question_id` 置空；管理台仍可查看已处理历史。
- 审计查询按 `created_at DESC`，`audit_logs` 上有 `created_at`、`actor_id`、`action`、`(target_type,target_id)` 索引。
- 昵称/标题/说明/理由/举报说明先做 NFKC、全角转半角、去零宽字符与空白归一化，再做敏感词与链接数校验。
- 敏感词表位于 `config/blocklist.txt`；默认单字段最多 2 个链接。
- 每人每日发帖上限默认 5 条（UTC 自然日）；每人每分钟投票/改票上限默认 20 次。
- 同一用户跨问题重复使用长度 ≥6 的完全相同理由会被拒绝；空白差异会被归一化后比较。
- 投票给他人问题会通知作者；首次投票发 `question.vote`，新增/修改理由发 `question.reason`；自己投自己的问题不发通知。
- 截止提醒 worker 每分钟运行一次，`questions.close_notified_at` 保证同一问题只提醒一次；seed 的历史截止问题已预标记。
