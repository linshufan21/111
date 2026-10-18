import { readFileSync } from 'node:fs'

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
)

/** 发布版本：APP_VERSION 优先，否则读取 package.json（Docker 构建参数可覆盖）。 */
export const APP_VERSION = String(process.env.APP_VERSION || pkg.version || '0.0.0')
/** 提交 SHA：由 CI/部署环境注入；未注入时为空，不伪造。 */
export const APP_COMMIT = String(process.env.GIT_SHA || process.env.COMMIT_SHA || '').slice(0, 40)
export const APP_STARTED_AT = new Date().toISOString()
