import { getSchemaInfo } from './db.mjs'
import { mailStatus } from './mail.mjs'
import { APP_COMMIT, APP_STARTED_AT, APP_VERSION } from './version.mjs'

/**
 * 健康检查载荷：存活、数据库、发布版本与迁移版本。
 * 不返回错误详情、路径或 SQL，避免把内部信息暴露给公网探针。
 */
export function healthPayload(db) {
  const base = {
    version: APP_VERSION,
    commit: APP_COMMIT || null,
    mail: mailStatus(),
    uptime: Math.round(process.uptime()),
    startedAt: APP_STARTED_AT,
  }

  let schema = null
  try {
    schema = getSchemaInfo(db)
    db.prepare('SELECT 1 AS ok').get()
  } catch {
    return {
      status: 'error',
      db: 'unavailable',
      ...base,
      schemaVersion: schema?.version ?? null,
      schemaName: schema?.name ?? null,
      schemaAppliedAt: schema?.appliedAt ?? null,
    }
  }

  return {
    status: 'ok',
    db: 'ok',
    ...base,
    schemaVersion: schema?.version ?? null,
    schemaName: schema?.name ?? null,
    schemaAppliedAt: schema?.appliedAt ?? null,
  }
}
