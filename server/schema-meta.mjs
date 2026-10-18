/**
 * Day 14：数据库 schema（迁移）版本。
 *
 * 版本号跟随仓库的迁移批次递增，与 package.json 的发布版本相互独立。
 * 旧库没有 schema_meta 时，启动会直接引导到当前版本；这不会重建数据表，
 * 因为 schema.sql 与 ensureColumn 本身是幂等的。
 */
export const SCHEMA_VERSION = 14
export const SCHEMA_NAME = 'day14-release-healthz'

/**
 * 创建/更新 schema_meta，并拒绝运行在「未来版本」的数据库上。
 * 返回当前记录，供健康检查与发布清单使用。
 */
export function ensureSchemaMeta(db) {
  const now = new Date().toISOString()
  const current = db
    .prepare(
      `SELECT version, name, applied_at AS appliedAt, updated_at AS updatedAt
         FROM schema_meta WHERE id = 1`,
    )
    .get()

  if (!current) {
    db.prepare(
      `INSERT INTO schema_meta (id, version, name, applied_at, updated_at)
       VALUES (1, ?, ?, ?, ?)`,
    ).run(SCHEMA_VERSION, SCHEMA_NAME, now, now)
    return {
      version: SCHEMA_VERSION,
      name: SCHEMA_NAME,
      appliedAt: now,
      updatedAt: now,
    }
  }

  if (current.version > SCHEMA_VERSION) {
    throw new Error(
      `数据库 schema v${current.version} 高于当前代码 v${SCHEMA_VERSION}；` +
        '请使用对应版本的应用，或从备份恢复后再降级。',
    )
  }

  if (current.version < SCHEMA_VERSION) {
    db.prepare('UPDATE schema_meta SET version = ?, name = ?, updated_at = ? WHERE id = 1').run(
      SCHEMA_VERSION,
      SCHEMA_NAME,
      now,
    )
    return {
      version: SCHEMA_VERSION,
      name: SCHEMA_NAME,
      appliedAt: current.appliedAt,
      updatedAt: now,
    }
  }

  return current
}

export function getSchemaInfo(db) {
  return (
    db
      .prepare(
        `SELECT version, name, applied_at AS appliedAt, updated_at AS updatedAt
           FROM schema_meta WHERE id = 1`,
      )
      .get() ?? null
  )
}
