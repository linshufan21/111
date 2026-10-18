import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { requestIp, requestScheme } from './config.mjs'
import { createDb } from './db.mjs'
import { sendErrorPage } from './error-page.mjs'
import { healthPayload } from './health.mjs'
import { logError, logInfo, logRequest } from './log.mjs'
import { recordRequest, renderMetrics } from './metrics.mjs'
import { startNotificationWorker } from './notify.mjs'
import { handleApi } from './routes.mjs'
import { validateStartup } from './startup.mjs'
import { ApiError } from './validate.mjs'
import { APP_VERSION } from './version.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(here, '..', 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

function cspReportOnly() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    "connect-src 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
  ]
  const report = String(process.env.CSP_REPORT_URI || '').trim()
  if (report) directives.push(`report-uri ${report}`)
  return directives.join('; ')
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy-Report-Only': cspReportOnly(),
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
  }
}

function serveStatic(req, res, pathname) {
  const requestId = req.requestId
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendErrorPage(res, {
      status: 405,
      title: '请求方式不支持',
      message: '这个地址只接受浏览器读取，不接受当前请求方式。',
      requestId,
    })
    return
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() })
    res.end('前端尚未构建。开发模式请访问 http://127.0.0.1:5173 ，或先运行 pnpm build。')
    return
  }
  let path
  try {
    path = decodeURIComponent(pathname)
  } catch {
    sendErrorPage(res, {
      status: 400,
      title: '地址格式不正确',
      message: '这个链接包含无法识别的字符。',
      requestId,
    })
    return
  }
  if (path === '/') path = '/index.html'
  let file = normalize(join(DIST, path))
  if (file !== DIST && !file.startsWith(`${DIST}${sep}`)) {
    sendErrorPage(res, {
      status: 403,
      title: '无权访问',
      message: '这个路径不在静态资源目录中。',
      requestId,
    })
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) {
    // SPA fallback：没有扩展名的路径交给前端路由
    if (!extname(path)) {
      file = join(DIST, 'index.html')
    } else {
      sendErrorPage(res, {
        status: 404,
        title: '页面不存在',
        message: '你访问的页面或资源不存在，可能已经被移动或删除。',
        requestId,
      })
      return
    }
  }
  const ext = extname(file).toLowerCase()
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ...securityHeaders(),
    'Cache-Control': file.includes(`${join(DIST, 'assets')}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  }
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(file).pipe(res)
}

function requestIdFor(req) {
  const incoming = String(req.headers['x-request-id'] || '').trim()
  if (/^[A-Za-z0-9._-]{8,120}$/.test(incoming)) return incoming
  return randomUUID()
}

export function createApp({ dbPath = process.env.DB_PATH || undefined } = {}) {
  const db = createDb(dbPath)
  validateStartup(db, dbPath || resolve(here, 'data', 'app.db'))
  const worker = startNotificationWorker(db)
  let closed = false
  const stop = () => {
    if (closed) return
    closed = true
    if (worker) clearInterval(worker)
    try {
      db.close()
    } catch {
      // 已经关闭
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`)
    const requestId = requestIdFor(req)
    req.requestId = requestId
    res.setHeader('X-Request-ID', requestId)
    const startedAt = process.hrtime.bigint()
    for (const [name, value] of Object.entries(securityHeaders())) {
      res.setHeader(name, value)
    }
    if (
      process.env.HSTS !== '0' &&
      process.env.NODE_ENV === 'production' &&
      requestScheme(req) === 'https'
    ) {
      res.setHeader('Strict-Transport-Security', 'max-age=15552000')
    }
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6
      recordRequest({ method: req.method, status: res.statusCode, durationMs })
      logRequest({
        requestId,
        method: req.method || '',
        path: url.pathname.slice(0, 200),
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(2)),
        ip: requestIp(req),
      })
    })

    try {
      if (url.pathname === '/healthz') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendErrorPage(res, {
            status: 405,
            title: '请求方式不支持',
            message: '健康检查只接受 GET/HEAD。',
            requestId,
          })
          return
        }
        const health = healthPayload(db)
        res.writeHead(health.status === 'ok' ? 200 : 503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? '' : JSON.stringify(health))
        return
      }
      if (url.pathname === '/metrics') {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendErrorPage(res, {
            status: 405,
            title: '请求方式不支持',
            message: '指标接口只接受 GET/HEAD。',
            requestId,
          })
          return
        }
        res.writeHead(200, {
          'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(req.method === 'HEAD' ? '' : renderMetrics(db))
        return
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(db, req, res, url)
        return
      }
      serveStatic(req, res, url.pathname)
    } catch (err) {
      if (res.headersSent) return
      if (err instanceof ApiError) {
        const payload = { error: { code: err.code, message: err.message } }
        if (err.field) payload.error.field = err.field
        if (err.retryAfter) payload.error.retryAfter = err.retryAfter
        if (requestId) payload.error.requestId = requestId
        res.writeHead(err.status, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...(err.retryAfter ? { 'Retry-After': String(err.retryAfter) } : {}),
          ...securityHeaders(),
        })
        res.end(JSON.stringify(payload))
        return
      }
      logError('request.failed', err, {
        requestId,
        method: req.method || '',
        path: url.pathname,
      })
      if (url.pathname.startsWith('/api/')) {
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          ...securityHeaders(),
        })
        res.end(
          JSON.stringify({
            error: {
              code: 'INTERNAL',
              message: '服务器开小差了，请稍后再试',
              requestId,
            },
          }),
        )
      } else {
        sendErrorPage(res, {
          status: 500,
          title: '服务器开小差了',
          message: '这次请求没有完成，请稍后再试。',
          requestId,
        })
      }
    }
  })
  return { server, db, stop }
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '127.0.0.1'
  const app = createApp()
  const { server, stop } = app
  let shuttingDown = false

  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    logInfo('server.shutdown', { signal })
    const force = setTimeout(() => {
      logInfo('server.shutdown.force', { signal })
      try {
        server.closeAllConnections?.()
      } catch {
        // 旧版 Node 没有该方法
      }
      stop()
      process.exit(1)
    }, 10_000)
    force.unref()
    server.close(() => {
      clearTimeout(force)
      stop()
      logInfo('server.stopped', { signal })
      process.exit(0)
    })
  }

  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))

  server.on('error', (err) => {
    logError('server.error', err)
    stop()
    process.exit(1)
  })
  server.listen(port, host, () => {
    logInfo('server.started', {
      host,
      port,
      url: `http://${host}:${port}`,
      version: APP_VERSION,
    })
  })
}
