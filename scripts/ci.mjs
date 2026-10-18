#!/usr/bin/env node
/**
 * Day 14：本地模拟 CI，与 .github/workflows/ci.yml 的检查顺序保持一致。
 *
 *   node scripts/ci.mjs
 *   node scripts/ci.mjs --e2e
 *
 * --e2e 会使用临时数据库启动一次真实服务，再跑 Playwright 端到端；
 * 不会污染 server/data/app.db。
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = {
  e2e: false,
  skipTypecheck: false,
  skipBuild: false,
  skipTests: false,
}

for (const arg of process.argv.slice(2)) {
  if (arg === '--e2e') options.e2e = true
  else if (arg === '--skip-typecheck') options.skipTypecheck = true
  else if (arg === '--skip-build') options.skipBuild = true
  else if (arg === '--skip-tests') options.skipTests = true
  else if (arg === '--help' || arg === '-h') {
    console.log('用法：node scripts/ci.mjs [--e2e] [--skip-typecheck] [--skip-build] [--skip-tests]')
    process.exit(0)
  } else {
    console.error(`未知参数：${arg}`)
    process.exit(2)
  }
}

const results = []
const startedAt = Date.now()

function runStep(label, command, args, env = {}) {
  console.log(`\n==> ${label}`)
  console.log(`$ ${command} ${args.join(' ')}`)
  const started = Date.now()
  const pnpmExecPath = process.env.npm_execpath
  const usePnpmJs = command === 'pnpm' && pnpmExecPath && existsSync(pnpmExecPath)
  const useCmd = process.platform === 'win32' && command === 'pnpm' && !usePnpmJs
  const result = spawnSync(
    useCmd ? process.env.ComSpec || 'cmd.exe' : usePnpmJs ? process.execPath : command,
    useCmd
      ? ['/d', '/s', '/c', 'pnpm', ...args]
      : usePnpmJs
        ? [pnpmExecPath, ...args]
        : args,
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env, CI: '1', ...env },
    },
  )
  const durationMs = Date.now() - started
  if (result.error) {
    results.push({ label, status: 'failed', durationMs })
    throw result.error
  }
  if (result.status !== 0) {
    results.push({ label, status: 'failed', durationMs })
    throw new Error(`${label} 失败（退出码 ${result.status}）`)
  }
  results.push({ label, status: 'passed', durationMs })
}

async function freePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const { port } = server.address()
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return response.json()
    } catch {
      // 服务还没起来
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  throw new Error(`服务在 ${timeoutMs}ms 内未通过 /healthz`)
}

async function runE2e() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/index.html 不存在；请先构建，或去掉 --skip-build')
  }
  const tempDir = mkdtempSync(join(tmpdir(), 'dajia-ci-'))
  const dbPath = join(tempDir, 'app.db')
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    HOST: '127.0.0.1',
    PORT: String(port),
    APP_URL: base,
    DB_PATH: dbPath,
    DEV_MAIL: '1',
    REQUIRE_VERIFIED_TO_POST: '1',
    NOTIFY_WORKER: '0',
  }
  let child = null
  try {
    runStep('写入演示数据', 'pnpm', ['seed', '--force'], { DB_PATH: dbPath })
    console.log(`\n==> 启动临时服务 ${base}`)
    child = spawn(process.execPath, ['server/index.mjs'], {
      cwd: ROOT,
      env,
      stdio: 'inherit',
    })
    const health = await waitForHealth(`${base}/healthz`)
    console.log(`[ci] /healthz ok：version=${health.version} schema=v${health.schemaVersion}`)

    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3')
    const e2eEnv = { E2E_BASE: base }
    if (process.env.E2E_CHANNEL !== undefined) e2eEnv.E2E_CHANNEL = process.env.E2E_CHANNEL
    runStep('Playwright 端到端', python, ['tests/e2e.py'], e2eEnv)
  } finally {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM')
      await new Promise((resolvePromise) => {
        const timer = setTimeout(() => {
          try {
            child.kill()
          } catch {
            // 已退出
          }
          resolvePromise()
        }, 3000)
        child.once('exit', () => {
          clearTimeout(timer)
          resolvePromise()
        })
      })
    }
    rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  console.log(`[ci] ${new Date().toISOString()} · node ${process.version} · ${process.platform}`)

  if (!options.skipTypecheck) runStep('类型检查', 'pnpm', ['typecheck'])
  if (!options.skipBuild) runStep('构建前端', 'pnpm', ['build'])
  if (!options.skipTests) runStep('单元/API/备份/发布测试', 'pnpm', ['test'])
  if (options.e2e) await runE2e()

  const totalMs = Date.now() - startedAt
  console.log('\n[ci] 汇总')
  for (const result of results) {
    console.log(`  ${result.status === 'passed' ? 'PASS' : 'FAIL'}  ${result.label}  ${(result.durationMs / 1000).toFixed(1)}s`)
  }
  console.log(`  total ${(totalMs / 1000).toFixed(1)}s`)
}

main().catch((error) => {
  console.error(`\n[ci] 失败：${error.message}`)
  process.exitCode = 1
})
