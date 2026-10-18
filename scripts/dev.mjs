// 同时启动 API 与 Vite；Ctrl+C 一并退出。
import { spawn } from 'node:child_process'

const isWin = process.platform === 'win32'
const children = []

function run(label, command, args, shell = false) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell,
    env: { ...process.env, FORCE_COLOR: '1' },
  })
  child.on('exit', (code) => {
    console.log(`[${label}] exited with ${code}`)
    shutdown()
  })
  children.push(child)
}

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  for (const c of children) {
    if (!c.killed) c.kill()
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

// node 可执行文件路径可能含空格，不能走 shell
run('api', process.execPath, ['--watch', 'server/index.mjs'])
run('web', 'pnpm', ['exec', 'vite', '--config', 'web/vite.config.ts'], isWin)
