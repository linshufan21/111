#!/usr/bin/env bash
# 大家来决定 · 单机生产安装（Ubuntu 22.04/24.04，Debian 12+）
#
#   sudo DOMAIN=dajia.duckdns.org ACME_EMAIL=you@example.com \
#     bash deploy/install.sh --tarball /tmp/dajia-decides-0.1.0.tar.gz \
#     --admin-user admin --admin-email you@example.com
#
# 需要：root、一个解析到本机的域名、出站 80/443、可选 ADMIN_PASSWORD。
# 会安装 Node 24 与 Caddy，应用只监听 127.0.0.1:8787。
set -euo pipefail

DOMAIN="${DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
TARBALL=""
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
APP_DIR="/opt/dajia"
DATA_DIR="/var/lib/dajia"
ENV_DIR="/etc/dajia"
ENV_FILE="$ENV_DIR/dajia.env"

usage() {
  echo "用法：sudo DOMAIN=... ACME_EMAIL=... bash deploy/install.sh --tarball /path/app.tar.gz [--admin-user admin --admin-email you@example.com]"
  echo "可选：ADMIN_PASSWORD=... 直接创建管理员；ENABLE_UFW=1 配置 ufw。"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) TARBALL="${2:-}"; shift 2 ;;
    --admin-user) ADMIN_USER="${2:-}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1"; usage; exit 2 ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "请用 root 运行（sudo）。"
  exit 1
fi
if [[ -z "$DOMAIN" || -z "$ACME_EMAIL" || -z "$TARBALL" ]]; then
  usage
  exit 2
fi
if [[ ! -f "$TARBALL" ]]; then
  echo "找不到发布包：$TARBALL"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl ca-certificates gnupg tar

# Node 24：发布包没有 node_modules，运行时只需要 Node。
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 24 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi

# Caddy：自动申请/续期 Let's Encrypt 证书。
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

if ! id -u dajia >/dev/null 2>&1; then
  useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin dajia
fi

mkdir -p "$APP_DIR" "$DATA_DIR/backups" "$DATA_DIR/exports" "$ENV_DIR"
tar -xzf "$TARBALL" -C "$APP_DIR" --strip-components=1
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"
chown -R dajia:dajia "$DATA_DIR"
chmod 700 "$DATA_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  CSRF_SECRET="$(node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))")"
  MAIL_DOMAIN="${MAIL_DOMAIN:-$DOMAIN}"
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
APP_URL=https://$DOMAIN
DB_PATH=$DATA_DIR/app.db
BACKUP_DIR=$DATA_DIR/backups
EXPORT_DIR=$DATA_DIR/exports
BLOCKLIST_PATH=$APP_DIR/config/blocklist.txt
CSRF_SECRET=$CSRF_SECRET
COOKIE_SECURE=1
TRUST_PROXY=1
HSTS=0
DEV_MAIL=0
REQUIRE_VERIFIED_TO_POST=1
NOTIFY_WORKER=1
MAIL_FROM="大家来决定 <noreply@$MAIL_DOMAIN>"
MAIL_PROVIDER=brevo
BREVO_API_KEY=
# RESEND_API_KEY=
EOF
  chmod 600 "$ENV_FILE"
  chown root:root "$ENV_FILE"
  echo "[install] 已生成 $ENV_FILE；请填入 BREVO_API_KEY 并把 MAIL_FROM 改成 Brevo 已验证的发件邮箱。"
else
  echo "[install] 保留已有 $ENV_FILE"
fi

install -m 0644 "$APP_DIR/deploy/dajia.service" /etc/systemd/system/dajia.service
systemctl daemon-reload
systemctl enable dajia
systemctl restart dajia

install -m 0644 "$APP_DIR/deploy/Caddyfile" /etc/caddy/Caddyfile
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/dajia.conf <<EOF
[Service]
Environment=DAJIA_DOMAIN=$DOMAIN
Environment=ACME_EMAIL=$ACME_EMAIL
EOF
systemctl daemon-reload
caddy validate --config /etc/caddy/Caddyfile
systemctl enable caddy
systemctl restart caddy

if [[ -n "${ADMIN_PASSWORD:-}" && -n "$ADMIN_EMAIL" ]]; then
  sudo -u dajia env \
    DB_PATH="$DATA_DIR/app.db" \
    ADMIN_USERNAME="$ADMIN_USER" \
    ADMIN_EMAIL="$ADMIN_EMAIL" \
    ADMIN_PASSWORD="$ADMIN_PASSWORD" \
    node "$APP_DIR/scripts/create-admin.mjs"
else
  echo "[install] 未创建管理员。稍后执行："
  echo "  sudo -u dajia env DB_PATH=$DATA_DIR/app.db ADMIN_USERNAME=$ADMIN_USER ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='至少12位' node $APP_DIR/scripts/create-admin.mjs"
fi

if [[ "${ENABLE_UFW:-0}" == "1" ]] && command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi

echo "[install] 等待本机健康检查…"
for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/healthz >/dev/null; then
    break
  fi
  sleep 1
done

echo "[install] 本机："
curl -fsS http://127.0.0.1:8787/healthz || true
echo
echo "[install] 公网（证书签发可能需要几十秒）："
curl -fsS "https://$DOMAIN/healthz" || true
echo
echo "[install] 完成。检查：systemctl status dajia caddy；journalctl -u dajia -f"
