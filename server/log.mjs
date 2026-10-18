function enabled() {
  return process.env.NODE_ENV !== 'test' || process.env.LOG_REQUESTS === '1'
}

function write(level, event, fields = {}) {
  if (!enabled()) return
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    event,
    ...fields,
  })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export function logRequest(fields) {
  write('info', 'request', fields)
}

export function logInfo(event, fields = {}) {
  write('info', event, fields)
}

export function logError(event, err, fields = {}) {
  write('error', event, {
    ...fields,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  })
}
