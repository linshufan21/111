# 安全模型

本文记录当前请求、会话与社区治理的防护边界。目标是让单机部署也有明确的默认安全值，同时为后续 HTTPS 反向代理上线留出配置项。

## 防护矩阵

| 风险 | 措施 | 当前状态 |
|---|---|---|
| CSRF / 跨站写请求 | 签名双提交 Cookie + `X-CSRF-Token`；所有写方法集中校验 | 已启用 |
| 登录 CSRF | 登录接口同样要求 CSRF | 已启用 |
| 点击劫持 | `X-Frame-Options: SAMEORIGIN` + CSP `frame-ancestors 'self'` | 已启用 |
| 会话固定 | 登录/注册先销毁旧 Cookie 会话，再签发新 token | 已启用 |
| 会话被盗 | HttpOnly、SameSite=Lax、HTTPS 下 Secure、服务端只存 token 哈希 | 已启用 |
| 密码暴力破解 | 5 次失败锁 15 分钟；IP / IP+账号双限流 | Day 3 已启用 |
| XSS | React 默认转义；CSP 先 report-only 观察 | 部分启用 |
| 内容注入 | 全部文本走 JSON API，不拼接 HTML | 已启用 |
| 审计篡改 | `audit_logs` 只写不提供改删 API；管理台只读展示 | 已启用 |
| 恶意内容 / 滥用 | 敏感词、NFKC/零宽归一化、链接上限、发帖/投票频控、举报审核与处理审计 | 已启用 |
| 举报历史 | 删除问题时保留标题/作者快照，举报记录不随内容消失 | 已启用 |
| 通知越权 | 通知按 `user_id` 查询；匿名投票不向作者暴露投票人 | 已启用 |
| 容器提权 / 密钥缺失 | 多阶段构建、非 root、只拷贝运行文件；生产启动自检 CSRF_SECRET、DB 完整性与目录可写 | 已启用 |
| 传输安全 | Nginx TLS 1.2/1.3、HTTP→HTTPS、生产 HSTS；本地自签不发 HSTS | 已配置（待运行验收） |
| 数据丢失 | `VACUUM INTO` 快照、完整性/计数校验、保留策略；恢复前安全副本 | 已启用 |
| 日志/指标泄漏 | 日志不含请求体与凭据；`/metrics` 由 Nginx 限制本机/私网 | 已启用 |
| 缓存泄漏 | API `Cache-Control: no-store`；验证链接 `Referrer-Policy: no-referrer` | 已启用 |

## CSRF 流程

1. 浏览器打开页面后，前端在第一次写请求前请求 `GET /api/csrf`。
2. 服务端签发 `dd_csrf=<nonce>.<hmac>`，写入可被 JS 读取的 Cookie。
3. 前端把同一个值放进 `X-CSRF-Token`。
4. 服务端校验 Cookie、Header、HMAC 签名与两者一致性，任一项失败返回 `403 BAD_CSRF`。
5. 登录、注册、登出、改密、重置会轮换 token；多标签页遇到旧 token 会自动重新引导一次。
6. Origin 还会与请求站点或 `APP_URL` 精确比对；`Origin: null`、无法解析或跨站来源返回 `403 BAD_ORIGIN`。

签名密钥来自 `CSRF_SECRET`。未配置时每个进程随机生成；重启会让旧 CSRF Cookie 失效，前端会重新引导，已登录会话不受影响。生产多实例必须配置同一个稳定密钥。

## Cookie

| Cookie | HttpOnly | SameSite | Secure | 有效期 |
|---|---|---|---|---|
| `dd_session` | 是 | Lax | HTTPS / production | 30 天 |
| `dd_csrf` | 否 | Lax | HTTPS / production | 30 天 |

`dd_csrf` 不加 HttpOnly 是双提交方案的要求；它只用于证明请求来自能读取本站 Cookie 的页面，不承担认证作用。

## 反向代理

只有显式设置 `TRUST_PROXY=1` 时才信任：

- `X-Forwarded-Proto`：决定 `Secure` 与 Origin 的请求 scheme；
- `X-Forwarded-For`：决定限流、审计和登录设备列表里的客户端 IP。

直接暴露公网时保持 `TRUST_PROXY=0`。代理必须保留原始 `Host`，或把 `APP_URL` 配置为对外地址。生产环境即使漏配代理，`NODE_ENV=production` 仍会强制 Secure Cookie；此时纯 HTTP 无法保持登录，这是有意的失败方式。

## CSP

当前发送 `Content-Security-Policy-Report-Only`，不阻断页面：

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self' 'unsafe-inline'`（现有 React 内联样式）
- `connect-src 'self'`
- `img-src 'self' data:`
- `font-src 'self'`
- `form-action 'self'`
- `frame-ancestors 'self'`
- `object-src 'none'`

可选 `CSP_REPORT_URI` 收集报告。上线步骤：

1. 在生产环境观察一段时间报告；
2. 修复或白名单必要来源；
3. 单独提交把 `Report-Only` 改为强制 `Content-Security-Policy`；
4. 保留 `X-Frame-Options` 作为旧浏览器兜底。

## 残余风险

- CSP 尚未强制，不能替代输出转义和代码审计。
- 若主站与不可信子域共享父域，子域可能写 Cookie；HMAC 签名已阻断伪造 token，但仍建议独立域名。
- 邮件验证链接是 GET 副作用，邮件扫描器可能提前消费；后续可改为确认页。
- 没有 MFA、设备指纹、异常登录通知；这些不在 Day 4 范围。
- `dd_session` 名称保持不变，避免升级时把已登录用户全部下线。

## CI 与发布

- CI 默认只有 `contents: read` 权限，不注入密钥；发布 job 才需要 `contents: write`。
- 发布包由 `scripts/release.mjs` 生成，包含逐文件 SHA-256 与 `SHA256SUMS`，可用于校验传输完整性。
- `manifest.json` 记录版本、commit、schema 版本与测试状态；发布说明由 `CHANGELOG.md` 生成。
- 数据库 schema 版本高于代码版本时应用拒绝启动，避免旧代码写新结构。
- 当前没有 GPG/cosign 签名，SHA-256 只能防传输损坏，不能证明发布者身份。
- GitHub Actions 使用主版本标签；高安全场景应按 commit SHA 固定 action。
- 发布包与镜像不包含 `.env`、数据库、备份、证书、测试与截图。

## 邮件与密钥

- `BREVO_API_KEY` / `RESEND_API_KEY` 只放在 `/etc/dajia/dajia.env`（0600，root:root）或部署平台 secret 中，不写进仓库、日志或发布包。
- 生产环境未配置邮件 key 时 `/healthz` 显示 `"mail":"disabled"`，注册验证和找回密码无法送达。
- Brevo/Resend 会看到收件邮箱与邮件正文；这是发送邮件的必要第三方处理，已在隐私政策中披露。
- 密码重置邮件不等待外部 API 返回，避免通过响应时间判断邮箱是否存在。

## 部署检查清单

- [ ] 全站 HTTPS，HTTP 跳转 HTTPS（Caddy 或 Nginx）。
- [ ] 反向代理后设置 `TRUST_PROXY=1`，并确认代理传递 `X-Forwarded-Proto` / `X-Forwarded-For`。
- [ ] 生产设置稳定的 `CSRF_SECRET`（至少 32 字节随机值）。
- [ ] 确认 `NODE_ENV=production`，开发邮件箱关闭。
- [ ] 用 `scripts/create-admin.mjs` 创建管理员，确认默认 `admin1234` 不存在。
- [ ] 配置 Brevo/Resend key，确认 `/healthz` 的 `mail` 不为 `disabled`，并完成一次真实收信。
- [ ] 观察 CSP report，再决定是否切换强制模式。
- [ ] 检查 `/api/csrf` 的 `Set-Cookie` 带 `Secure` 且不带 `HttpOnly`。
- [ ] 用跨站表单验证写接口返回 403。
- [ ] 隐私政策/用户协议已补充真实联系方式并请法务复核。
