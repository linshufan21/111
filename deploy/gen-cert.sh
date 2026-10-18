#!/usr/bin/env sh
# 生成 localhost 自签证书，供本地 HTTPS 验收使用。
# 用法：sh deploy/gen-cert.sh [输出目录]
set -eu

DIR="${1:-deploy/certs}"
mkdir -p "$DIR"

if ! command -v openssl >/dev/null 2>&1; then
  echo "需要 openssl。请在 Git Bash/WSL 中运行，或使用文档中的 Docker certgen 服务。" >&2
  exit 1
fi

openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout "$DIR/privkey.pem" \
  -out "$DIR/fullchain.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 "$DIR/privkey.pem"
echo "证书已生成：$DIR/fullchain.pem / $DIR/privkey.pem"
