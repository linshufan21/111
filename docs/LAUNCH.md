# 免费上线方案与检查清单

目标：不盈利项目用 **0 元/月** 跑起来，同时不牺牲数据安全。下面这套组合是目前最现实的免费方案：

```text
用户 ──HTTPS──> Caddy（自动证书） ──> Node 应用 127.0.0.1:8787
                                      └── SQLite /var/lib/dajia/app.db
DNS：DuckDNS 免费子域名（或 is-a.dev）
邮件：Brevo 免费 300 封/天（或 Resend 100 封/天）
备份：Oracle 对象存储 20GB / Backblaze B2 10GB（可选）
CI：GitHub Actions 免费额度
```

## 一、服务器：优先 Oracle Cloud Always Free

| 方案 | 费用 | 适合度 | 说明 |
|---|---|---|---|
| **Oracle Cloud Always Free** | 0 元 | ★★★★★ | ARM Ampere A1 最高 4 OCPU / 24GB 内存 / 200GB 盘；可长期免费，但注册要银行卡验证，热门区域可能无 ARM 容量 |
| **Google Cloud e2-micro** | 0 元（限美国部分区域） | ★★★★ | 1 台 e2-micro + 30GB 标准盘，需绑定结算账号；内存 1GB，够跑 Node + SQLite |
| **家里旧电脑 + Cloudflare Tunnel** | 0 元 | ★★★ | 不用公网 IP，但电脑必须长期开机，家庭网络/断电是风险 |
| Render / Railway / Koyeb 免费档 | 0 元 | ★ | 免费实例会休眠，磁盘是临时的；SQLite 重启即丢，**不适合本项目** |
| Vercel / Netlify / Cloudflare Pages | 0 元 | ★ | 只能放前端，Node 服务与 SQLite 跑不了 |

**推荐**：Oracle Cloud 选 Ubuntu 24.04、Ampere A1、2 OCPU / 4GB / 50GB。安全组/防火墙只开 22、80、443；应用只监听 `127.0.0.1:8787`，由 Caddy 对外。

> 免费额度与地区政策会变，注册前以云厂商页面为准。不要为了免费把数据库放在临时盘上。

## 二、域名：先用免费子域名

| 方案 | 示例 | 费用 | 说明 |
|---|---|---|---|
| **DuckDNS** | `linshufan21.duckdns.org` | 0 元 | 最快；登录后创建子域名并填服务器 IP，Caddy 可自动签证书 |
| **sslip.io** | `<服务器IP>.sslip.io` | 0 元 | 不用注册，DNS 直接解析到 IP；适合当天上线验证，域名不好看 |
| **is-a.dev** | `linshufan21.is-a.dev` | 0 元 | 需向 GitHub 仓库提 PR 审核；比 DuckDNS 好看，适合长期展示 |
| **js.org** | `dajia.js.org` | 0 元 | 面向 JS 项目，需 GitHub PR；审核看项目质量 |
| **eu.org** | `dajia.eu.org` | 0 元 | 人工审核较慢，可能几周 |
| 自定义 .com / .cn | `dajia.com` | 约 60–100 元/年 | 真正可控；Cloudflare Registrar 按成本价，但**不是免费** |

**建议**：今天先用 DuckDNS 把站点跑通；稳定后再申请 `is-a.dev` 或买一个便宜域名。免费子域名的风险是服务方停服/回收，不适合作为唯一品牌资产。

> 如果主要用户在中国大陆：海外免费机器延迟高，DuckDNS 也可能不稳定；大陆服务器需要 ICP 备案，免费海外方案不能替代备案。先面向小范围邀请测试，不要直接公开推广。

## 三、邮件：Brevo 免费额度（解决注册验证/找回密码）

当前代码已支持两种 HTTPS 邮件 API，不需要 SMTP 端口，也不需要额外 npm 依赖：

- **Brevo**：免费 300 封/天，注册后验证一个发件邮箱即可给任意用户发信。
- **Resend**：免费 100 封/天；没有自己域名时只能发到账号邮箱，适合测试，不适合公开注册。

### Brevo 配置步骤

1. 注册 [Brevo](https://www.brevo.com/)，完成账号验证。
2. 在 **Senders & IP → Senders** 添加并验证一个你能收信的发件邮箱（例如你的 Gmail/QQ 邮箱）。
3. 在 **SMTP & API → API Keys** 创建 API key。
4. 编辑服务器上的 `/etc/dajia/dajia.env`：

```ini
MAIL_PROVIDER=brevo
BREVO_API_KEY=xkeysib-...
MAIL_FROM="大家来决定 <你已验证的发件邮箱>"
APP_URL=https://你的域名
```

5. 重启并验证：

```bash
sudo systemctl restart dajia
curl -fsS http://127.0.0.1:8787/healthz
# "mail":"brevo" 表示已识别；注册一个测试账号，确认能收到验证邮件
```

- 免费额度只适合小规模邀请测试；公开推广前要监控退信/投诉，超过额度需升级或换服务。
- 发件邮箱最好使用自有域名并配置 SPF/DKIM；没有域名时用已验证的个人邮箱也能发，但送达率和可信度较低。
- 不要用个人 Gmail 密码走 SMTP；本方案只使用 API key。
- `MAIL_PROVIDER=console` 只在开发环境有效；生产未配置 key 时 `/healthz` 会显示 `"mail":"disabled"`，注册仍会成功但收不到验证信。

## 四、部署步骤（Oracle/GCP 通用）

### 1. 本地生成发布包

```bash
node scripts/release.mjs --version 0.1.0
ls release/dajia-decides-0.1.0.tar.gz
```

发布包不包含数据库、`.env`、证书和 `node_modules`；服务器只需要 Node 24。

### 2. 上传到服务器

```bash
scp release/dajia-decides-0.1.0.tar.gz deploy/install.sh ubuntu@服务器IP:/tmp/
```

### 3. DNS 指向服务器

DuckDNS 创建 `linshufan21.duckdns.org`，IP 填服务器公网 IPv4；等待解析生效：

```bash
dig +short linshufan21.duckdns.org
```

### 4. 一键安装

```bash
ssh ubuntu@服务器IP
sudo DOMAIN=linshufan21.duckdns.org \
  ACME_EMAIL=你的邮箱@example.com \
  ADMIN_PASSWORD='至少12位且不常见' \
  ADMIN_EMAIL=你的邮箱@example.com \
  bash /tmp/install.sh --tarball /tmp/dajia-decides-0.1.0.tar.gz
```

安装脚本会：

- 安装 Node 24 与 Caddy；
- 创建 `dajia` 系统用户；
- 解压到 `/opt/dajia`，数据放 `/var/lib/dajia`；
- 生成 `/etc/dajia/dajia.env`（含随机 `CSRF_SECRET`）；
- 安装 systemd 服务与 Caddy 配置；
- 可选创建管理员，不写默认密码；
- 检查本机与公网 `/healthz`。

### 5. 填邮件 key 并重启

```bash
sudo nano /etc/dajia/dajia.env
sudo systemctl restart dajia
```

### 6. 验收

```bash
curl -fsS https://你的域名/healthz
sudo systemctl status dajia caddy
sudo journalctl -u dajia -n 50 --no-pager
```

浏览器打开 `https://你的域名`，完成：

- 注册 → 收验证邮件 → 发帖；
- 退出 → 登录；
- 忘记密码 → 收重置邮件；
- 管理员登录 → 举报队列/审计；
- 手机 4G 访问一次（确认不是本机缓存）。

## 五、上线前必须解决的清单

| 项目 | 状态 | 说明 |
|---|---|---|
| HTTPS 与 Secure Cookie | ✅ 本方案 | Caddy 自动证书；`COOKIE_SECURE=1` + `TRUST_PROXY=1` |
| 生产管理员 | ✅ 新增脚本 | `scripts/create-admin.mjs`，不再使用 `admin1234` |
| 注册/找回邮件 | ✅ 代码支持 | 需你申请 Brevo/Resend key 并填入 |
| 数据库迁移 | ✅ | `schema_meta` v14；启动自动升级 |
| 备份 | ⚠️ 需配置 | 先用 `scripts/backup.mjs`，再加异地对象存储 |
| 隐私政策/用户协议 | ⚠️ 草案已上线 | `/privacy`、`/terms` 已可访问；公开运营前需补充真实联系方式并请法务复核，Cookie 同意仍未做 |
| 内容审核 | ✅ 基本可用 | 管理台举报队列；公开推广前需要值班规则 |
| 监控 | ⚠️ 建议 | UptimeRobot 免费监控 `/healthz` |
| 限流/防滥用 | ✅ 基本 | 登录/发帖/投票限流；公开后观察是否加 Turnstile |
| 域名 | ⚠️ 免费子域 | DuckDNS 可今天用；长期建议自有域名 |
| 中国大陆合规 | ❌ 未解决 | 大陆服务器需 ICP；海外免费方案不适用备案 |

## 六、备份到免费对象存储

应用每天生成 SQLite 快照后，用 rclone 同步到异地：

```bash
sudo apt-get install -y rclone
sudo -u dajia rclone config   # 选 Backblaze B2 / Oracle Object Storage
```

每天凌晨（示例）：

```bash
sudo -u dajia bash -c 'set -a; . /etc/dajia/dajia.env; set +a; node /opt/dajia/scripts/backup.mjs'
sudo -u dajia rclone copy /var/lib/dajia/backups remote:dajia-backups --min-age 1h
```

- 备份包含邮箱、密码哈希、投票内容，属于个人信息；对象存储桶必须私有，开启版本/保留策略。
- 至少每月做一次“下载备份 → 新目录恢复 → 启动 → 冒烟”，不要只验证文件存在。
- 免费额度用完后会停止同步，设置额度告警。

## 七、免费方案的现实边界

- Oracle/GCP 免费实例可能被回收、限速或区域无库存；不要把它当唯一副本。
- DuckDNS/is-a.dev 是免费服务，可能停服；长期品牌建议自有域名。
- Brevo/Resend 免费额度有日/月上限，且对垃圾邮件敏感；公开注册前要加验证码或邀请码。
- 免费对象存储有流量/请求限制；备份要压缩、保留有限天数。
- 没有 CDN 时海外访问速度一般；中国大陆访问海外免费机器可能很慢。
- 免费不等于无合规义务：隐私政策、数据删除、举报处理、未成年人保护仍需你负责。

## 八、现在就能执行的顺序

1. 申请 Brevo，验证发件邮箱，拿 API key；
2. 注册 DuckDNS 子域名，填服务器 IP；
3. 开 Oracle/GCP 免费实例，开 22/80/443；
4. 本地 `node scripts/release.mjs`，上传 tar.gz 与 `deploy/install.sh`；
5. 运行安装脚本，填 `BREVO_API_KEY`；
6. 创建管理员，完成注册→验证→发帖→找回密码冒烟；
7. 配置 UptimeRobot 与异地备份；
8. 再考虑隐私政策、自有域名和公开推广。
