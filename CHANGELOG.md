# 变更日志

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。
数据库 schema 版本独立记录在 `schema_meta`，由应用启动时自动迁移。

## [Unreleased]

## [0.1.0] - 2026-10-18

首个可部署的社区原型版本，覆盖账号安全、社区治理、部署运维三个里程碑。

### 上线准备

- 生产邮件通道：Brevo / Resend HTTPS API，无需 SMTP 依赖；`/healthz` 显示 `mail` 配置状态。
- `scripts/create-admin.mjs`：生产管理员初始化，不再使用默认密码；首次启动即可创建已验证管理员。
- `scripts/preflight.mjs`：上线前检查 HTTPS、CSRF 密钥、邮件 key、schema、管理员与默认密码残留。
- 免费上线方案：Caddy 自动 HTTPS、systemd 服务、`deploy/install.sh` 一键安装、`docs/LAUNCH.md`。
- Docker/Nginx 之外的原生 Node + Caddy 部署路径，适合 Oracle Cloud Always Free / GCP e2-micro。
- `/privacy` 隐私政策与 `/terms` 用户协议草案，页脚与登录页入口；注销匿名化、Cookie、跨境与未成年人条款。

### 新增

- 账号自助：修改密码、登录设备列表、单设备退出、退出其他设备、账号注销。
- 邮箱验证：24 小时一次性 token、重发验证、开发邮件箱。
- 找回密码：30 分钟一次性 token、统一回应避免账号枚举、重置后全设备下线。
- 登录保护：连续失败锁定、IP 与账号双限流、登录/改密/重置审计。
- 发布与投票：是/否投票、可选理由、改票、匿名、截止时间、热门/最新/争议/即将截止排序。
- 举报与审核：举报入口、我的举报、管理台审核队列、处理结果通知。
- 通知中心：投票、理由、截止、举报结果触发；未读铃铛与全部已读。
- 管理员台：概览、内容管理、用户管理、举报队列、审计日志筛选与分页。
- 内容安全：敏感词归一化匹配、全角/零宽绕过防护、链接数限制、发帖/投票频控、重复理由拦截。

### 安全

- 签名双提交 CSRF 覆盖全部写接口；登录/注册/改密/重置轮换 token。
- HttpOnly、SameSite=Lax 会话 Cookie；HTTPS 下 Secure；CSP report-only 与安全响应头。
- scrypt 密码哈希、会话 token 哈希存储、生产 `CSRF_SECRET` 强度自检。

### 运维

- 多阶段 Docker 镜像、非 root 运行、SQLite 数据卷、启动自检、健康检查。
- Nginx + HTTPS 配置、HTTP 跳转、TLS 1.2/1.3、HSTS（生产）、静态资源缓存。
- 备份/恢复/CSV 导出：`VACUUM INTO`、完整性校验、原子恢复、14 天保留。
- 可观测性：JSON 请求日志、`X-Request-ID`、Prometheus `/metrics`、HTML 404/500、优雅关闭。
- 健康检查：`/healthz` 与 `/api/health` 返回版本、提交与 schema 迁移版本。
- CI 与发布：GitHub Actions、`scripts/ci.mjs` 本地模拟、`scripts/release.mjs` 发布包、清单与 SHA-256。
