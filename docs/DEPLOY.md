# 容器化部署

Day 10 提供单机容器部署：多阶段构建、非 root 运行、SQLite 数据卷、健康检查与启动自检。
Day 11 增加 Nginx + HTTPS；Day 12 增加备份恢复；Day 13 增加日志/指标；Day 14 增加 CI、发布包与 schema 版本健康检查。

> 免费 VPS（Oracle/GCP）更推荐原生 Node + Caddy，步骤见 [LAUNCH.md](LAUNCH.md)；本文保留 Docker 方案。

## 快速启动

```bash
cp .env.example .env
# 生产/公网请设置强随机 CSRF_SECRET
docker compose up --build -d

# 创建管理员（不要把 demo/admin 默认账号带到公网）
docker compose run --rm \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_EMAIL=you@example.com \
  -e ADMIN_PASSWORD='至少12位且不常见' \
  app node scripts/create-admin.mjs
```

- 访问 `http://localhost:8787`。
- 健康检查：`curl http://localhost:8787/healthz`，返回版本、提交与 schema 迁移版本。
- 停止：`docker compose down`；数据保留在命名卷 `app-data`。

## 原生 Node + Caddy（免费 VPS 推荐）

Oracle Cloud Always Free / GCP e2-micro 上更推荐不用 Docker：

```bash
sudo DOMAIN=你的域名 ACME_EMAIL=you@example.com \
  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='至少12位' \
  bash deploy/install.sh --tarball /tmp/dajia-decides-0.1.0.tar.gz
```

- [Caddyfile](../deploy/Caddyfile)：自动 HTTPS、HSTS、反代 `127.0.0.1:8787`；
- [dajia.service](../deploy/dajia.service)：systemd、非 root、只允许写 `/var/lib/dajia`；
- [dajia.env.example](../deploy/dajia.env.example)：生产环境变量模板；
- 完整免费方案、DuckDNS/is-a.dev、Brevo 邮件与检查表见 [LAUNCH.md](LAUNCH.md)。

## 镜像结构

- `build` 阶段：`node:24-alpine` + pnpm，安装依赖并构建 `dist/`。
- `runtime` 阶段：只拷贝 `dist/`、`server/`、`scripts/`、`config/` 和 `package.json`，不包含 node_modules。
- 运行用户：`app`，非 root。
- 数据目录：`/data`，由 compose 命名卷挂载。
- 默认端口：`8787`。
- 镜像支持 `APP_VERSION` / `GIT_SHA` 构建参数，发布脚本会自动注入并打版本 tag。

## 环境变量

| 变量 | 容器默认 | 说明 |
|---|---|---|
| `NODE_ENV` | `production` | 启用生产 Cookie/密钥自检 |
| `HOST` | `0.0.0.0` | 容器内监听所有地址 |
| `APP_VERSION` | `package.json` | 发布版本；compose 可用同名变量覆盖 |
| `GIT_SHA` | 空 | 部署提交 SHA，出现在 `/healthz` 与启动日志 |
| `DB_PATH` | `/data/app.db` | SQLite 数据文件 |
| `BLOCKLIST_PATH` | `/app/config/blocklist.txt` | 敏感词表 |
| `CSRF_SECRET` | 本地占位值 | 必须改为至少 32 字符随机值 |
| `COOKIE_SECURE` | `0` | 仅本地 HTTP；HTTPS 环境设为 `1` 或删除 |
| `TRUST_PROXY` | `0` | Day 11 Nginx 后设为 `1` |
| `NOTIFY_WORKER` | `1` | 截止提醒 worker |
| `DEV_MAIL` | `0` | 生产关闭开发邮件箱 |

## 可观测性

- 应用输出 JSON 请求日志到 stdout，`X-Request-ID` 会贯穿 Nginx/应用。
- `/healthz` 返回发布版本、提交与 schema 迁移版本；`/api/health` 保持兼容。
- `/metrics` 提供 Prometheus 文本指标；Nginx 仅允许本机/私网抓取。
- `docker compose logs -f app` 查看应用日志；`curl http://127.0.0.1:8787/metrics` 直接抓本机指标。
- 详见 [OBSERVABILITY.md](OBSERVABILITY.md)。

## CI 与发布

- 每次 push/PR 由 GitHub Actions 跑 typecheck、build 与测试，并上传 `dist`。
- 推送 `v*` tag 会生成 tar.gz 发布包、`manifest.json` 与 `SHA256SUMS`，并创建 GitHub Release。
- 本地可用 `pnpm run ci` 模拟，`node scripts/release.mjs` 打包；详见 [RELEASE.md](RELEASE.md)。
- 发布包不包含数据与证书；升级前先 `pnpm backup`。

## 启动自检

容器启动时 `server/startup.mjs` 会检查：

1. SQLite `PRAGMA quick_check` 是否正常；
2. 数据库所在目录是否可写；
3. `NODE_ENV=production` 时 `CSRF_SECRET` 是否存在且至少 32 字符；
4. 数据库 schema 版本是否高于当前代码版本（高于则拒绝启动）。

任一项失败，进程直接退出，避免带病上线。

## 数据持久化与备份

- `docker compose down` 不会删除 `app-data` 卷；`docker compose down -v` 会删除，慎用。
- 卷内路径：`/data/app.db`（WAL 模式，可能同时存在 `app.db-wal` / `app.db-shm`）。
- 使用 `docker compose exec app node scripts/backup.mjs` 生成快照；恢复与 CSV 导出见 [BACKUP.md](BACKUP.md)。

## Nginx + HTTPS

### 本地自签

```bash
# 方式 A：本机有 openssl
sh deploy/gen-cert.sh

# 方式 B：只用 Docker（会临时安装 openssl）
docker compose -f docker-compose.yml -f docker-compose.https.yml --profile cert run --rm certgen

docker compose -f docker-compose.yml -f docker-compose.https.yml up --build -d
```

- 访问 `https://localhost`，接受自签警告后登录。
- `http://localhost` 会 301 跳转 HTTPS。
- 本地使用 [nginx.local.conf](../deploy/nginx.local.conf)，不发送 HSTS。
- 应用容器通过 `TRUST_PROXY=1`、`COOKIE_SECURE=1` 识别 Nginx 转发。
- `/healthz` 在 Nginx 上关闭访问日志，避免探针刷日志。

### 生产 Let's Encrypt

1. 将域名解析到服务器，开放 80/443。
2. 用 certbot webroot 申请证书（webroot 对应 compose 的 `certbot-webroot` 卷）：
   ```bash
   certbot certonly --webroot -w /var/www/certbot -d your.domain
   ```
3. 把 `fullchain.pem` / `privkey.pem` 放进 `deploy/certs/`，或把 Let's Encrypt live 目录挂载到 `/etc/nginx/certs`。
4. 使用生产 Nginx 配置启动（[nginx.conf](../deploy/nginx.conf)）：
   ```bash
   NGINX_CONF=./deploy/nginx.conf \
   APP_URL=https://your.domain \
   docker compose -f docker-compose.yml -f docker-compose.https.yml up --build -d
   ```
5. 生产配置会发送 HSTS；应用容器设置 `HSTS=0`，避免重复。

## 备份与恢复

```bash
# 容器内生成快照
docker compose exec app node scripts/backup.mjs

# 停止应用后恢复（脚本会先做安全副本）
docker compose stop app
docker compose run --rm app node scripts/restore.mjs /data/backups/app-....db --force
docker compose start app
```

恢复前必须停止写入；详见 [BACKUP.md](BACKUP.md)。

## 发布与升级

```bash
pnpm backup
docker compose build --pull
docker compose up -d
curl -fsS http://127.0.0.1:8787/healthz
```

`/healthz` 的 `schemaVersion` 应与当前代码的 `SCHEMA_VERSION` 一致。升级前保留旧镜像 tag 与数据库备份；如需回滚且 schema 已升级，先恢复备份。

## 已知限制

- 当前机器未安装 Docker/Nginx/openssl，本文的 compose 与 HTTPS 流程尚未在本机实际验收。
- 单机 SQLite，不支持多实例同时写入。
- 证书续期、日志轮转、外部数据库与高可用仍需在生产环境补齐。
