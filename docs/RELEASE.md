# CI 与发布

Day 14 把「本地能跑」变成「每次提交可复现、每次发布可校验」。核心是两条流水线：

```text
push / PR ──> typecheck ──> build ──> test ──> dist artifact
tag v*   ──> typecheck ──> build ──> test ──> 发布包 ──> GitHub Release
```

## 本地模拟 CI

```bash
pnpm run ci             # typecheck → build → test
pnpm run ci --e2e       # 额外用临时数据库启动服务并跑 Playwright
```

- `pnpm run ci` 与 CI 的检查顺序一致，失败即停并输出每一步耗时。
- `--e2e` 使用系统临时目录中的 SQLite，不会写入 `server/data/app.db`。
- E2E 默认使用本机 Edge；设置 `E2E_CHANNEL=none` 使用 Playwright 自带 Chromium：

```bash
# 首次需要安装 Chromium
python -m playwright install chromium

E2E_CHANNEL=none pnpm run ci --e2e
```

单独运行：

```bash
pnpm typecheck
pnpm build
pnpm test
python tests/e2e.py
```

当前测试覆盖：API/安全/治理/通知/审计/备份恢复/可观测性，以及发布脚本的版本号、变更日志、tar.gz 往返。测试总数以命令输出为准。

> `pnpm ci` 是 pnpm 自带命令（清空并安装依赖），运行本项目脚本请用 `pnpm run ci`。

## GitHub Actions

### `.github/workflows/ci.yml`

| 触发 | 内容 |
|---|---|
| push / pull_request | Node 24、pnpm 11.22.0、`pnpm install --frozen-lockfile`、typecheck、build、test；上传 `dist` artifact |

### `.github/workflows/e2e.yml`

| 触发 | 内容 |
|---|---|
| workflow_dispatch（手动） | 安装 Playwright Chromium，seed 临时数据库，启动服务，跑 `tests/e2e.py`，失败时上传 `server.log` |

权限只有 `contents: read`；不注入任何密钥。E2E 独立成手动工作流，不阻塞日常 PR。此前把 E2E 放进 CI 时使用了 job 级 `runner.temp`，GitHub 会拒绝整个工作流；现已改为 `/tmp` 并拆分。

### `.github/workflows/release.yml`

推送 `v*` tag 时：

1. checkout 同一 tag；
2. 安装依赖；
3. 调用 `node scripts/release.mjs --version <tag 去掉 v> --docker`；
4. 上传发布包、`manifest.json`、`SHA256SUMS` 为 workflow artifact；
5. 创建 GitHub Release 并附上发布包与校验文件。

发布 job 需要 `contents: write`，只使用仓库自带的 `GITHUB_TOKEN`。没有配置镜像仓库，因此只构建本地镜像 tag，不推送。

> 如果本目录是 monorepo 的子目录，请把 `.github/workflows/` 移到仓库根，并在 job 中设置 `defaults.run.working-directory: decision-app`，或给所有 `run` 加 `cd decision-app`。

## 发布脚本

```bash
# 当前 package.json 版本，完整检查后打包
node scripts/release.mjs

# 递增版本并发布
node scripts/release.mjs --bump patch
node scripts/release.mjs --bump minor
node scripts/release.mjs --bump major

# 指定版本、构建镜像 tag
node scripts/release.mjs --version 0.2.0 --docker

# CI 已跑过测试时复用结果
node scripts/release.mjs --version 0.2.0 --skip-tests --skip-build

# 只预览，不写文件
node scripts/release.mjs --version 0.2.0 --dry-run
```

常用参数：

| 参数 | 说明 |
|---|---|
| `--version x.y.z` | 指定版本；与 `--bump` 互斥 |
| `--bump patch\|minor\|major` | 从当前版本递增 |
| `--notes "..."` | 附加发布摘要 |
| `--image name` | 镜像名，默认 `dajia-decides` |
| `--skip-typecheck` / `--skip-build` / `--skip-tests` | 复用已通过的结果 |
| `--docker` | 构建并打 `<image>:<version>` 与 `:latest` tag；需要 Docker |
| `--tag` | 创建 `v<version>` annotated tag；需要 git 仓库 |
| `--dry-run` | 打印计划，不写 package.json/发布包 |
| `--allow-dirty` | 允许在 git 工作区有改动时发布 |

脚本行为：

1. 校验语义化版本，读取 git commit 与 dirty 状态；
2. 依次运行 typecheck、build、test（可跳过）；
3. 更新 `package.json` 版本；
4. 可选构建 Docker 镜像；
5. 收集 `dist/`、`server/`、`scripts/`、`config/`、`deploy/`、`docs/`、部署文件与 `package.json`；
6. 生成 tar.gz、`manifest.json`、`RELEASE_NOTES.md`、`SHA256SUMS`。

发布包不包含：`node_modules`、`server/data`、`backups`、`exports`、`tests`、`screenshots`、`.env`、`deploy/certs`、`release`。

### 产物结构

```text
release/
├── dajia-decides-0.1.0.tar.gz
├── SHA256SUMS
└── 0.1.0/
    ├── manifest.json
    └── RELEASE_NOTES.md
```

- `manifest.json`：版本、commit、构建时间、schema 版本、校验状态、Docker tag、每个文件的 SHA-256。
- `SHA256SUMS`：发布包校验和，与 tar.gz 同级。
- tar 内顶层目录为 `dajia-decides-<version>/`，解压即得到可运行目录。

校验（在包含 tar.gz 与 SHA256SUMS 的目录执行）：

```bash
sha256sum -c SHA256SUMS
```

Windows 可用：

```powershell
Get-FileHash .\dajia-decides-0.1.0.tar.gz -Algorithm SHA256
Get-Content .\SHA256SUMS
```

### 变更日志

- 优先读取 `CHANGELOG.md` 中 `## [<version>]` 小节；
- 没有对应小节时，从 `docs/ROADMAP.md` 提取所有 `✅ 完成` 的 Day；
- `--notes` 会附加在发布说明开头。

发布新版本前，建议先在 `CHANGELOG.md` 的 `## [Unreleased]` 下整理变更，再改名为版本小节。

## 版本与 schema

- `package.json` 的 `version` 是发布版本；`/healthz` 返回该版本。
- `server/schema-meta.mjs` 的 `SCHEMA_VERSION` 是数据库迁移版本；启动时自动创建/升级 `schema_meta`。
- 如果数据库版本高于代码版本，应用拒绝启动，避免旧代码写入新结构。
- 回滚应用前，如果 schema 已升级，请用升级前的备份恢复数据库；详见 [BACKUP.md](BACKUP.md)。

## 健康检查

```bash
curl http://127.0.0.1:8787/healthz
```

```json
{
  "status": "ok",
  "db": "ok",
  "version": "0.1.0",
  "commit": "abc123def456",
  "schemaVersion": 14,
  "schemaName": "day14-release-healthz",
  "schemaAppliedAt": "2026-10-18T...",
  "uptime": 12,
  "startedAt": "2026-10-18T..."
}
```

- `/healthz` 是给容器/负载均衡的轻量探针，`/api/health` 保持兼容，字段相同。
- 数据库不可用时返回 `503` 且 `status="error"`、`db="unavailable"`。
- `Cache-Control: no-store`；支持 `HEAD`。
- 不返回错误详情，避免公网探针泄露内部信息。

## 发布检查清单

- [ ] `pnpm run ci --e2e` 通过；
- [ ] `CHANGELOG.md` 已整理；
- [ ] `pnpm backup` 已生成升级前备份；
- [ ] `GIT_SHA` 已注入（容器/部署环境）；
- [ ] 推送 `v<version>` tag，确认 GitHub Release 与 artifact 上传成功；
- [ ] 用 `SHA256SUMS` 校验发布包；
- [ ] 在目标机器解压发布包或拉取镜像，访问 `/healthz` 确认版本与 schema；
- [ ] 冒烟：登录、发帖、投票、管理台；
- [ ] 观察 `/metrics` 与 JSON 日志。

## 已知限制

- 当前没有镜像仓库登录/推送步骤；如需 GHCR/Docker Hub，在 release workflow 中增加 login 与 push，并配置 secrets。
- E2E 只在手动触发时运行，避免每次 PR 安装浏览器拖慢反馈。
- 发布包是源码 + 构建产物的 tar.gz，不是系统安装包；目标机需要 Node 24，或使用 Docker 镜像。
- 当前环境没有 Docker，`--docker` 与 `docker compose` 的实际运行仍需在有 Docker 的机器验收。
- 没有签名（cosign/GPG）；目前用 SHA-256 校验完整性，尚未建立供应链签名。
- GitHub Actions 版本使用主版本标签（如 `actions/checkout@v4`），生产建议按 commit SHA 固定。
