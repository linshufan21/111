# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.22.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY web ./web
RUN pnpm build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    DB_PATH=/data/app.db \
    BLOCKLIST_PATH=/app/config/blocklist.txt

# 发布脚本通过 --build-arg 注入；为空时 server/version.mjs 回退到 package.json。
ARG APP_VERSION
ARG GIT_SHA
ENV APP_VERSION=${APP_VERSION} \
    GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="大家来决定" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.revision="${GIT_SHA}"

WORKDIR /app
RUN addgroup -S app \
 && adduser -S -G app app \
 && mkdir -p /data \
 && chown -R app:app /data /app

COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app server ./server
COPY --chown=app:app scripts ./scripts
COPY --chown=app:app config ./config
COPY --chown=app:app package.json ./

USER app
EXPOSE 8787
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

STOPSIGNAL SIGTERM
CMD ["node", "server/index.mjs"]
