# 开发路线图 · 一天一个可验收增量

> 基线：当前仓库已有核心闭环、管理员台、40 项测试、E2E 与截图。
> 原则：每天一个可独立上线/回滚的增量；先安全与治理，再部署与增长；外部依赖放最后。

## 总览

| 阶段 | 天数 | 目标 |
|---|---|---|
| M1 账号与安全 | Day 1–5 | 能安全地开放注册 |
| M2 社区治理 | Day 6–9 | 能处理举报、滥用与通知 |
| M3 可部署上线 | Day 10–15 | 一台机器可部署、可备份、可观测 |
| M4 体验与增长 | Day 16–20 | 可被分享、可访问、可运营 |
| M5 外部集成 | Day 21–24 | 真实邮件/OAuth/域名/合规（需凭证） |

**可邀请测试**：Day 15 结束。
**可公开运营**：Day 24 结束（且完成法务审核）。

> 当前进度：**Day 14 已完成**（2026-10-18）。下一天：Day 15 上线演练。

## 每日固定交付标准（DoD）

1. 数据库迁移幂等，旧库可直接升级；
2. `pnpm typecheck`、`pnpm build` 通过；
3. `node --test` 全绿，涉及页面则补 E2E；
4. UI 改动附截图到 `screenshots/`；
5. 更新 `docs/API.md` 与 `README.md` 的相关段落；
6. 给出回滚方式（回滚迁移/关闭开关）；
7. 新功能默认带开关或环境变量，避免影响既有流程。

---

## M1 · 账号与安全（Day 1–5）

### Day 1 · 账号自助：改密 / 会话 / 注销
> ✅ 2026-10-18 完成。
> 交付：`/settings` 页面；`POST /api/me/password`（改密后轮换当前会话、其他设备失效）；`GET /api/me/sessions`、`DELETE /api/me/sessions/:id`、`POST /api/me/sessions/revoke-others`；`DELETE /api/me`（密码 + 输入「注销」二次确认，内容匿名化，账号 `status='deleted'`）。
> 迁移：`sessions` 增加 `id/user_agent/ip/last_seen_at`，`users` 增加 `deleted_at`；旧库启动时自动回填。
> 验证：API 12/12、`tsc` 0、`vite build` 通过、E2E 覆盖改密与注销；截图 `settings*.png`。
> 回滚：删除 `/settings` 路由与菜单入口，API 新增路由不影响旧客户端；数据库新增列可保留，旧代码忽略。
- **改动**
  - `POST /api/me/password`（校验旧密码，改后轮换当前会话）
  - `GET /api/me/sessions`、`DELETE /api/me/sessions/:id`、`POST /api/me/sessions/revoke-others`
  - `DELETE /api/me`：二次确认 + 密码校验；内容匿名化（作者显示「已注销用户」），账号 `status='deleted'`
  - `/settings` 页面：账号、安全、危险区
- **验收**：改密后其他设备会话失效；注销后无法登录，历史问题仍可浏览。
- **依赖**：无。

### Day 2 · 邮箱验证
> ✅ 2026-10-18 完成。
> 交付：`users.email_verified_at` + `auth_tokens`；注册发信；`GET /api/auth/verify`（303 → `/verify-email`）；`POST /api/auth/resend-verification`；`GET /api/meta`；`GET /api/dev/mail`；未验证发帖返回 403；`/settings` 邮箱区块、全局验证横幅、`/verify-email` 结果页、`/dev/mail` 开发邮件箱。
> 迁移：老库首次加列时把既有账号回填为已验证；seed 用户默认已验证。
> 验证：API 17/17、`tsc` 0、`vite build` 通过、E2E 覆盖注册→开发邮件箱→验证→发帖；截图 `verify-email-*.png`、`dev-mail.png`、`settings-email*.png`、`home-verify-banner.png`。
> 回滚：设置 `REQUIRE_VERIFIED_TO_POST=0` 立即放行；`DEV_MAIL=0` 关闭开发邮件箱；移除新路由/页面即可，表和列可保留。
- **改动**
  - `auth_tokens` 表（purpose、token_hash、expires_at、used_at）
  - 注册发验证邮件；开发环境把链接写入日志/`/dev/mail` 页面
  - `GET /api/auth/verify?token`、`POST /api/auth/resend-verification`
  - 未验证限制：可浏览/投票，不能发问题（`REQUIRE_VERIFIED_TO_POST` 可配置）
  - `SMTP_URL` 预留在 `.env.example`；Day 2 使用 console transport，真实发信留到 Day 21
- **验收**：注册 → 日志取链接 → 验证 → 可发帖；过期/复用 token 被拒绝。
- **依赖**：无；真实发信留到 Day 21。

### Day 3 · 忘记密码与登录保护
> ✅ 2026-10-18 完成。
> 交付：`users.failed_login_count/locked_until`；`audit_logs`；`POST /api/auth/forgot`（统一回应、60 秒冷却、30 分钟 token）；`POST /api/auth/reset`（一次性、吊销全部会话、解锁、标记邮箱已验证）；登录 5 次失败锁 15 分钟 + IP 限流；`/forgot-password`、`/reset-password` 页面与开发邮件箱分类。
> 迁移：`users` 增加锁定字段，新增 `audit_logs` 表；旧库自动升级，既有会话不受影响。
> 验证：API 20/20、`tsc` 0、`vite build` 通过、E2E 覆盖注册→忘记密码→开发邮件箱→重置→新密码登录；截图 `forgot-password*.png`、`reset-password.png`、`dev-mail-reset.png`。
> 回滚：移除 forgot/reset 路由与页面；锁定字段保留但旧代码忽略；`audit_logs` 可保留。紧急情况下可清空 `users.locked_until`。
- **改动**
  - `POST /api/auth/forgot`、`POST /api/auth/reset`（一次性 token、30 分钟）
  - 登录失败锁定：同一账号 5 次失败锁 15 分钟，IP 限流
  - 登录成功/失败、改密、重置写入审计
- **验收**：重置链接只能使用一次；锁定期间正确密码也返回 429。
- **依赖**：Day 2 的 token 表。

### Day 4 · CSRF 与会话加固
> ✅ 2026-10-18 完成。
> 交付：签名双提交 CSRF（`dd_csrf` + `X-CSRF-Token`）覆盖全部写接口；`GET /api/csrf` 引导；登录/注册换发 session、认证边界轮换 CSRF；`TRUST_PROXY=1` 识别 `X-Forwarded-Proto` / `X-Forwarded-For`；HTTPS 与 production 强制 Secure Cookie；CSP report-only、Permissions-Policy、COOP/CORP 等安全头。
> 迁移：无数据库变更；既有会话继续有效，下次登录时轮换。
> 验证：API 26/26（新增 CSRF、跨站 Origin、登录轮换、代理 Secure、CSP、认证边界轮换）；`tsc` 0；`vite build` 通过；E2E 与截图回归通过。
> 回滚：移除 CSRF 守卫与前端引导即可；`dd_csrf` 会被旧代码忽略；CSP 为 report-only，可单独删除；无 schema 迁移。
- **改动**
  - 双提交 CSRF Cookie + `X-CSRF-Token`，覆盖所有写接口
  - 生产 `Secure` Cookie；`TRUST_PROXY=1` 时识别 `X-Forwarded-Proto`
  - 改密/重置后吊销全部会话；会话固定防护（登录后换 token）
  - 安全响应头补齐（CSP 先 report-only）
- **验收**：缺少 CSRF 头的写请求 403；跨站表单无法投票。
- **依赖**：Day 1、Day 3。

### Day 5 · 管理员审计日志
> ✅ 2026-10-18 完成。
> 交付：`GET /api/admin/audit`（关键词、动作类别、目标类型、分页）；管理台「审计日志」Tab（筛选、分页、详情弹窗）；精选/取消精选、截止/重开、删除问题、停用/恢复用户全部写入 `audit_logs`；`audit_logs` 增加 action 与 target 索引。
> 迁移：无表结构变更；`CREATE INDEX IF NOT EXISTS` 让旧库启动时自动补索引。
> 验证：API 26/26（管理动作审计、筛选、1 秒内查询、PATCH/DELETE 审计返回 404 且不改变记录、非管理员 403）；E2E 覆盖管理动作→审计列表→详情；截图 `admin-audit.png`、`admin-audit-detail.png`。
> 回滚：删除审计查询路由与前端 Tab 即可；新增索引可保留；已写入日志无需清理。
- **改动**
  - 复用 Day 3 的 `audit_logs` 表（actor、action、target、meta、ip、created_at）
  - 补齐封禁/解封、删除问题、精选、截止、审核处理等管理动作
  - 管理台「审计日志」页：筛选、分页、详情
- **验收**：每个管理动作可在 1 秒内查到；日志不可通过 API 修改/删除。
- **依赖**：无（可与 D1–D4 并行）。

---

## M2 · 社区治理（Day 6–9）

### Day 6 · 举报入口
> ✅ 2026-10-18 完成。
> 交付：`reports` 表（唯一约束 `question_id + reporter_id`、status、handled_by/at）；`POST /api/questions/:id/report`；重复提交返回原记录；`GET /api/me/reports`；问题详情 `myReport`；卡片/详情举报入口与原因选择弹窗；「我的举报」Tab 与待处理状态；管理台 `stats.pendingReports` 与总览提示；`report.created` 审计。
> 迁移：新增 `reports` 表与 3 个索引；`CREATE TABLE IF NOT EXISTS` 让旧库启动时自动创建，无数据迁移。
> 验证：API 27/27（重复合并、非法原因、待处理数 +1、我的举报、详情 myReport、审计）；E2E 覆盖举报弹窗→提交→我的举报；截图 `report.png`、`report-submitted.png`、`my-reports.png`。
> 回滚：删除举报路由、前端入口与 Tab，保留 `reports` 表即可；旧代码忽略新表。
- **改动**
  - `reports` 表：reporter、question、reason（enum）、detail、status、handled_by/at
  - 问题详情/卡片「举报」；同一用户对同一问题只能报一次
  - 「我的举报」页与状态
- **验收**：重复举报被合并；举报后管理台待处理数 +1。
- **依赖**：无。

### Day 7 · 审核队列
> ✅ 2026-10-18 完成。
> 交付：`GET /api/admin/reports`（状态/时间/同题数量排序、分页）；`PATCH /api/admin/reports/:id`（标记处理、驳回、删除问题、停用作者）；删除问题时同题待处理举报一并处理；`notifications` 临时站内通知表与 `GET/POST /api/me/notifications`；「我的」页处理结果横幅；`reports` 表重建为 `question_id ON DELETE SET NULL` 并保留标题/作者快照。
> 迁移：旧 `reports` 表启动时自动重建并回填标题/作者，不丢举报数据；新增 `notifications` 表与索引。
> 验证：API 29/29（处理/驳回/删除/停用、重复处理 409、通知已读、被删问题消失、审计）；E2E 覆盖待处理→标记处理→已处理；截图 `admin-reports.png`、`my-reports-resolved.png`。
> 回滚：移除举报队列与通知 UI/API；`reports` 快照与 `notifications` 可保留，旧代码忽略。
- **改动**
  - 管理台「举报」Tab：待处理/已处理/已驳回，按时间/数量排序
  - 处理动作：删除问题、停用作者、驳回举报、标记已处理
  - 处理结果通知举报人（Day 9 前先用 Toast/站内临时表）
- **验收**：处理动作有审计记录；被删除问题从信息流消失。
- **依赖**：Day 5（审计）、Day 6。

### Day 8 · 内容安全与频率限制
> ✅ 2026-10-18 完成。
> 交付：`config/blocklist.txt` 与 `content.mjs`；昵称/标题/说明/理由/举报说明统一 NFKC、全角转半角、去零宽、空白归一化；敏感词字段级错误；单字段最多 2 个链接；发帖日限 5 条、投票分钟限 20 次、跨题重复理由拦截；429 返回 `Retry-After` 与 `retryAfter`。
> 迁移：无表结构变更；新增配置目录与内容安全检查。
> 验证：API 33/33（敏感词/零宽绕过、链接数、发帖日限、投票分钟限、重复理由）；E2E 回归通过。
> 回滚：删除 `content.mjs` 调用与频控检查；`blocklist.txt` 与配置可保留，旧代码忽略。
- **改动**
  - 敏感词配置（`config/blocklist.txt`），标题/说明/理由/昵称统一检测
  - 发帖频控（每人每天 N 条）、投票频控（每分钟 N 次）、理由重复检测
  - 链接数量限制、全角/零宽字符归一化
- **验收**：命中词返回字段级错误；频控返回 429 且带重试时间。
- **依赖**：无。

### Day 9 · 通知中心
> ✅ 2026-10-18 完成。
> 交付：顶栏铃铛未读数；`/notifications` 列表与全部已读；`notifications` 触发扩展到 `question.vote`、`question.reason`、`question.closed` 与举报处理结果；每分钟截止 worker 使用 `close_notified_at` 去重；「我的」页保留举报结果横幅。
> 迁移：`questions` 增加 `close_notified_at`；seed 对历史已截止问题预标记，避免重复提醒；通知表沿用 Day 7。
> 验证：API 34/34（投票/理由通知、截止只提醒一次、已读持久化）；E2E 覆盖作者登录后铃铛未读→通知中心→全部已读；截图 `notifications.png`。
> 回滚：移除通知页/铃铛与 worker；`notifications` 与 `close_notified_at` 可保留，旧代码忽略。
- **改动**
  - `notifications` 表：type、payload、read_at
  - 触发：问题被投票、收到理由、问题截止、举报处理结果
  - 顶栏铃铛未读数、`/notifications` 列表、全部已读
- **验收**：A 投票后 B 收到通知；已读状态持久化。
- **依赖**：Day 7（举报结果通知）。

---

## M3 · 可部署上线（Day 10–15）

### Day 10 · 容器化
> ✅ 2026-10-18 完成。
> 交付：多阶段 `Dockerfile`（node:24-alpine，非 root，仅拷贝 dist/server/config）；`docker-compose.yml`（8787、`app-data:/data`、healthcheck）；`/api/health`；`startup.mjs` 自检 DB 完整性/目录可写/生产 CSRF_SECRET；`COOKIE_SECURE` 覆盖与 `.env.example`；`docs/DEPLOY.md`。
> 验证：API 34/34（含 health）；模拟镜像运行时（只拷 dist/server/config、production、DB_PATH、无 node_modules）启动成功，健康检查、demo 登录、seed 后重启数据保留；Docker 引擎在当前环境不可用，未实际执行 `docker compose up`。
> 回滚：移除 Dockerfile/compose 与 health 路由；启动自检可单独删除，不影响本地 `pnpm start`。
- **改动**
  - 多阶段 `Dockerfile`（node:24-alpine，非 root，仅拷贝 dist/server）
  - `docker-compose.yml`：app + volume `/data` + healthcheck
  - `.env.example`、启动自检（DB 可写、密钥存在）
- **验收**：`docker compose up` 后 8787 可访问，重启数据不丢。
- **依赖**：无。

### Day 11 · Nginx + HTTPS
> ✅ 2026-10-18 交付实现（运行验收受当前环境限制）。
> 交付：`deploy/nginx.conf`（生产 HSTS）与 `deploy/nginx.local.conf`（本地无 HSTS）；TLS 1.2/1.3、HTTP→HTTPS、ACME webroot、反代、gzip、`/assets/` 代理缓存、64k 请求体；`deploy/gen-cert.sh` 与 Docker `certgen` profile；`docker-compose.https.yml`；`TRUST_PROXY=1`、`COOKIE_SECURE=1`、应用层 `HSTS=0`；Let's Encrypt 文档。
> 验证：配置静态检查；当前机器无 Docker/Nginx/openssl，未实际执行 `https://localhost` 登录与 HTTP 跳转，需在有 Docker 的机器验收。
> 回滚：移除 https compose 与 deploy 配置，回到 Day 10 的 8787 直连；证书目录可保留。
- **改动**
  - `deploy/nginx.conf`：TLS、HTTP→HTTPS、反代、gzip、静态缓存、请求体限制
  - 本地自签证书脚本；生产 Let's Encrypt 说明
  - 安全头（HSTS 仅生产）
- **验收**：本地 `https://localhost` 可登录；HTTP 自动跳转。
- **依赖**：Day 10。

### Day 12 · 备份与恢复
> ✅ 2026-10-18 完成。
> 交付：`scripts/backup.mjs`（`VACUUM INTO`、quick_check、计数比对、14 天保留、`0600` 权限）；`scripts/restore.mjs`（`--force`、恢复前安全副本、原子替换、WAL/SHM 清理、恢复后校验）；`scripts/export-csv.mjs`；Docker 镜像与 `/data/backups`；`docs/BACKUP.md` 含 cron / Windows 任务计划 / 容器命令。
> 验证：`pnpm test` 35/35，备份→清空→恢复→CSV 行数与内容一致；CLI 对实际数据库生成并校验快照。
> 回滚：移除 scripts 与文档；数据库文件不受影响，已有备份可保留。
- **改动**
  - `scripts/backup.mjs`：`VACUUM INTO` 快照、按天保留、校验
  - `scripts/restore.mjs` + 文档
  - CSV 导出（问题/投票）
  - 定时任务示例（Windows 任务计划 / cron）
- **验收**：备份 → 清空 → 恢复，数据与计数一致。
- **依赖**：Day 10。

### Day 13 · 日志、指标与错误页
> ✅ 2026-10-18 完成。
> 交付：JSON 请求日志（requestId/方法/路径/状态/耗时/IP）；`X-Request-ID` 响应头与 Nginx `$request_id` 透传；`/metrics` Prometheus 文本（请求数、延迟 p50/p95/p99、投票/问题/用户/待处理举报、DB 页数体积）；HTML 404/500 错误页；API 错误附 `requestId`；SIGTERM/SIGINT 优雅关闭与 10 秒兜底；`HOST` 监听配置，容器内 `0.0.0.0`。
> 验证：测试 36/36；`/metrics`、request id、HTML 404 覆盖；JSON 日志已运行观察；优雅关闭代码已实现，Windows 信号语义未实测。
> 回滚：移除 metrics/log/error-page 模块与相关调用；JSON 日志和指标不影响数据库。
- **改动**
  - JSON 结构化日志 + request id + 耗时
  - `/metrics`（请求数、延迟分位、投票/发帖计数、DB 大小）
  - 统一错误页（500/404），优雅关闭
- **验收**：一次请求可用 request id 串起日志；`/metrics` 可被 Prometheus 抓取。
- **依赖**：Day 10。

### Day 14 · CI 与发布脚本
> ✅ 2026-10-18 完成。
> 交付：`.github/workflows/ci.yml`（install → typecheck → build → test → dist artifact，E2E 可选 job）；`.github/workflows/release.yml`（`v*` tag → 测试 → 发布包 → GitHub Release）；`scripts/ci.mjs` 本地模拟 CI；`scripts/release.mjs`（语义化版本/递增、typecheck/build/test、Docker tag、CHANGELOG 发布说明、tar.gz、manifest、SHA-256）；`/healthz` 与 `/api/health` 返回版本、commit、schema 迁移版本；`schema_meta` 表；Docker/Nginx healthcheck 切换到 `/healthz`。
> 验证：`pnpm run ci --e2e` 全绿；发布包生成并可通过 `SHA256SUMS` 校验；`/healthz` 返回 `schemaVersion=14`；当前环境无 Docker，未实际执行 `--docker` 与 compose 验收。
> 回滚：移除 workflows、发布脚本与 `/healthz` 路由；`schema_meta` 表可保留，旧代码忽略。回滚前若数据库已升级，请先备份。
- **改动**
  - GitHub Actions：install → typecheck → build → API tests → E2E（可选）→ artifact
  - `scripts/release.mjs`：版本号、构建、镜像 tag、变更日志
  - `/healthz` 返回版本与迁移版本
- **验收**：本地模拟 CI 全绿；打 tag 可生成发布包。
- **依赖**：Day 10–13。

### Day 15 · 上线演练
- **改动**
  - 从零部署演练：空机器 → compose → 初始化管理员 → 冒烟
  - 恢复演练、回滚演练
  - `docs/RUNBOOK.md`：故障处理、备份恢复、证书续期、限流调整
- **验收**：按文档 30 分钟内完成一次全新部署与恢复。
- **依赖**：Day 10–14。

---

## M4 · 体验与增长（Day 16–20）

### Day 16 · SEO 与分享
- **改动**
  - 服务端为 `/q/:id` 注入 title/description/OG meta（社交爬虫可读）
  - 默认分享图 + 分类分享图；`/sitemap.xml`、`/robots.txt`
  - 分享按钮：复制链接、系统分享
- **验收**：`curl` 详情页能看到对应 meta；分享卡片有标题与图。
- **依赖**：无。

### Day 17 · 深色模式
- **改动**
  - `data-theme` 双主题 token；跟随系统 + 手动切换 + 持久化
  - 管理台、弹窗、表格适配；对比度检查
- **验收**：三档主题切换无闪烁；AA 对比度通过。
- **依赖**：无。

### Day 18 · 多语言
- **改动**
  - 轻量 i18n（字典 + `t()` + 日期/数字格式化）
  - 中/英覆盖登录、首页、详情、我的、管理台
  - 语言切换与持久化
- **验收**：切换语言后无硬编码中文残留（核心页）。
- **依赖**：无。

### Day 19 · 无障碍与性能
- **改动**
  - axe 扫描、键盘全流程、焦点顺序、屏幕阅读器标签
  - 路由级代码分割、字体加载、图片（如有）优化
  - 性能预算：首屏 JS < 120KB gzip
- **验收**：axe 0 serious；键盘可完成投票；构建体积达标。
- **依赖**：无。

### Day 20 · 运营看板
- **改动**
  - 事件表/轻量埋点：发帖、投票、写理由、举报、登录
  - 管理台「数据」页：DAU、投票率、理由率、留存（7 日）
  - CSV 导出与时间范围筛选
- **验收**：指标与数据库计数一致；导出可打开。
- **依赖**：Day 5（审计）、Day 15。

---

## M5 · 外部集成（需凭证，Day 21–24）

### Day 21 · 真实邮件
> 🟡 部分提前完成（2026-10-18）：已接入 Brevo / Resend HTTPS API，生产可发验证/重置邮件；剩余退信处理、发送限额监控、自有域名 SPF/DKIM。
- 接 SMTP/API（SendGrid、阿里云邮件推送等），模板、退信处理、发送限额。
- **需要**：SMTP 凭证、发信域名 SPF/DKIM。

### Day 22 · OAuth 登录
- GitHub / Google 登录，账号绑定与解绑。
- **需要**：OAuth App Client ID/Secret、回调域名。

### Day 23 · 域名、证书与云监控
- 域名解析、Let's Encrypt 自动续期、云主机部署、日志/指标接入。
- **需要**：域名、服务器、云账号。

### Day 24 · 合规页面
- 隐私政策、用户协议、社区公约、Cookie 同意、数据删除说明。
- **需要**：法务审核；我只能出草稿与页面实现。

---

## 压缩版（只有 10 天）

按以下顺序做，可得到「可邀请测试」的版本：

Day 1 → 2 → 3 → 4 → 5 → 10 → 11 → 12 → 13 → 15

跳过举报、通知、SEO、深色、多语言、看板；这些不影响核心闭环与上线安全。

## 每日协作方式

1. 你说「做 Day N」，我按当天范围实现并跑验收；
2. 我给出：改动清单、迁移、测试结果、截图、回滚方式；
3. 若当天涉及外部凭证，我先用本地替身完成并联调，凭证到位后只改环境变量；
4. 任何一天都可以停下，已完成的增量保持可运行。
