const counters = new Map()
const durations = []
const MAX_DURATIONS = 2048
const startedAt = Date.now()
let requestCount = 0

function counterKey(method, status) {
  return `${method || 'UNKNOWN'}|${Number(status) || 0}`
}

export function recordRequest({ method, status, durationMs }) {
  requestCount += 1
  const key = counterKey(method, status)
  counters.set(key, (counters.get(key) ?? 0) + 1)
  durations.push(Number(durationMs) || 0)
  if (durations.length > MAX_DURATIONS) durations.shift()
}

function quantile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))
  return sorted[index]
}

function dbMetric(db, sql) {
  try {
    return Number(db.prepare(sql).get()?.n ?? 0)
  } catch {
    return 0
  }
}

export function renderMetrics(db) {
  const lines = []
  const push = (line = '') => lines.push(line)

  push('# HELP dajia_http_requests_total HTTP requests by method and status.')
  push('# TYPE dajia_http_requests_total counter')
  for (const [key, value] of counters) {
    const [method, status] = key.split('|')
    push(`dajia_http_requests_total{method="${method}",status="${status}"} ${value}`)
  }

  push('# HELP dajia_http_request_duration_ms Request latency in milliseconds.')
  push('# TYPE dajia_http_request_duration_ms summary')
  for (const p of [0.5, 0.95, 0.99]) {
    push(`dajia_http_request_duration_ms{quantile="${p}"} ${quantile(durations, p).toFixed(2)}`)
  }
  const sum = durations.reduce((total, value) => total + value, 0)
  push(`dajia_http_request_duration_ms_sum ${sum.toFixed(2)}`)
  push(`dajia_http_request_duration_ms_count ${durations.length}`)

  push('# HELP dajia_http_requests_all_total Total requests in this process.')
  push('# TYPE dajia_http_requests_all_total counter')
  push(`dajia_http_requests_all_total ${requestCount}`)
  push('# HELP dajia_uptime_seconds Process uptime.')
  push('# TYPE dajia_uptime_seconds gauge')
  push(`dajia_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`)

  push('# HELP dajia_db_questions Total questions.')
  push('# TYPE dajia_db_questions gauge')
  push(`dajia_db_questions ${dbMetric(db, 'SELECT COUNT(*) AS n FROM questions')}`)
  push('# HELP dajia_db_votes Total votes.')
  push('# TYPE dajia_db_votes gauge')
  push(`dajia_db_votes ${dbMetric(db, 'SELECT COUNT(*) AS n FROM votes')}`)
  push('# HELP dajia_db_users Total users.')
  push('# TYPE dajia_db_users gauge')
  push(`dajia_db_users ${dbMetric(db, "SELECT COUNT(*) AS n FROM users WHERE status <> 'deleted'")}`)
  push('# HELP dajia_db_pending_reports Pending reports.')
  push('# TYPE dajia_db_pending_reports gauge')
  push(
    `dajia_db_pending_reports ${dbMetric(
      db,
      "SELECT COUNT(*) AS n FROM reports WHERE status = 'pending'",
    )}`,
  )

  let dbBytes = 0
  try {
    const pageCount = Number(db.prepare('PRAGMA page_count').get()?.page_count ?? 0)
    const pageSize = Number(db.prepare('PRAGMA page_size').get()?.page_size ?? 0)
    dbBytes = pageCount * pageSize
  } catch {
    dbBytes = 0
  }
  push('# HELP dajia_db_bytes Main SQLite database size in bytes.')
  push('# TYPE dajia_db_bytes gauge')
  push(`dajia_db_bytes ${dbBytes}`)

  return `${lines.join('\n')}\n`
}
