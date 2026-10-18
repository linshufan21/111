#!/usr/bin/env node
/**
 * Day 14：可复现的发布脚本。
 *
 *   node scripts/release.mjs --bump patch
 *   node scripts/release.mjs --version 0.2.0 --docker
 *   node scripts/release.mjs --skip-tests --skip-build   # 复用已通过的 CI 结果
 *
 * 产出：
 *   release/<version>/manifest.json
 *   release/<version>/RELEASE_NOTES.md
 *   release/SHA256SUMS
 *   release/dajia-decides-<version>.tar.gz
 *
 * 不依赖 tar/gzip 外部命令，Windows 与 Linux 结果一致。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { SCHEMA_NAME, SCHEMA_VERSION } from '../server/schema-meta.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const RELEASE_ROOT = join(ROOT, 'release')
const INCLUDES = [
  'dist',
  'server',
  'scripts',
  'config',
  'deploy',
  'docs',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.https.yml',
  'README.md',
  'CHANGELOG.md',
  '.env.example',
  '.dockerignore',
]
const SKIP_SEGMENTS = new Set([
  'node_modules',
  'data',
  'backups',
  'exports',
  'release',
  'screenshots',
  'tests',
  '__pycache__',
  '.git',
  'certs',
])
const SKIP_NAMES = new Set(['.env', '.DS_Store', 'Thumbs.db'])

export function parseVersion(input) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(input || '').trim())
  if (!match) throw new Error(`版本号不合法：${input}（应为 1.2.3 或 1.2.3-rc.1）`)
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  }
}

export function formatVersion(version) {
  const v = typeof version === 'string' ? parseVersion(version) : version
  return `${v.major}.${v.minor}.${v.patch}${v.prerelease ? `-${v.prerelease}` : ''}`
}

export function bumpVersion(current, kind) {
  const v = parseVersion(current)
  if (kind === 'major') return `${v.major + 1}.0.0`
  if (kind === 'minor') return `${v.major}.${v.minor + 1}.0`
  if (kind === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`
  throw new Error(`未知的版本递增类型：${kind}（可选 patch/minor/major）`)
}

export function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

/** 从 CHANGELOG.md 中提取指定版本的小节正文（不含标题）。 */
export function extractChangelogSection(markdown, version) {
  const lines = String(markdown).split(/\r?\n/)
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const start = lines.findIndex((line) =>
    new RegExp(`^##\\s+\\[?v?${escaped}\\]?(?:\\s|$)`).test(line.trim()),
  )
  if (start === -1) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim()
}

/** 从路线图提取已完成的天，作为没有 CHANGELOG 时的发布说明兜底。 */
export function extractRoadmapDays(markdown) {
  const days = []
  let current = null
  for (const line of String(markdown).split(/\r?\n/)) {
    const heading = /^###\s+Day\s+(\d+)\s*·\s*(.+)$/.exec(line.trim())
    if (heading) {
      if (current) days.push(current)
      current = {
        day: Number(heading[1]),
        title: heading[2].trim(),
        completed: false,
        date: '',
        delivered: '',
      }
      continue
    }
    if (!current) continue
    if (line.includes('✅')) {
      current.completed = true
      const date = /(\d{4}-\d{2}-\d{2})/.exec(line)
      if (date) current.date = date[1]
    }
    const delivered = /^>\s*交付：(.+)$/.exec(line.trim())
    if (delivered) current.delivered = delivered[1].trim()
  }
  if (current) days.push(current)
  return days.filter((day) => day.completed)
}

export function buildReleaseNotes({
  version,
  date,
  summary = '',
  changelog = '',
  days = [],
  validation = {},
  schemaVersion = SCHEMA_VERSION,
  schemaName = SCHEMA_NAME,
  imageTags = [],
}) {
  const lines = [`# 大家来决定 v${version}`, '', `发布日期：${date}`, '']
  if (summary.trim()) lines.push(summary.trim(), '')

  if (changelog.trim()) {
    lines.push('## 变更日志', '', changelog.trim(), '')
  } else if (days.length) {
    lines.push('## 本次交付', '')
    for (const day of days) {
      lines.push(`### Day ${day.day} · ${day.title}`, '')
      if (day.delivered) lines.push(day.delivered, '')
    }
  } else {
    lines.push('## 变更日志', '', '本次发布未提供变更日志。', '')
  }

  lines.push(
    '## 升级说明',
    '',
    `- 数据库 schema 版本：**v${schemaVersion}**（${schemaName}）。启动时自动创建或升级，无需手动执行 SQL。`,
    '- 升级前建议先运行 `pnpm backup`；回滚应用版本时，如数据库已升级，请用备份恢复数据库。',
    '- 发布包自带 `dist/`、服务端、脚本、配置与文档，不包含 `node_modules`、数据、测试与截图。',
    '',
  )

  if (validation && Object.keys(validation).length) {
    const labels = { typecheck: '类型检查', build: '构建', tests: '测试' }
    lines.push('## 验证结果', '')
    for (const [key, value] of Object.entries(validation)) {
      lines.push(`- ${labels[key] || key}：${value === 'passed' ? '通过' : '跳过'}`)
    }
    lines.push('')
  }

  if (imageTags.length) {
    lines.push(
      '## 容器镜像',
      '',
      '```text',
      `docker build ${imageTags.map((tag) => `-t ${tag}`).join(' ')} .`,
      '```',
      '',
    )
  }

  lines.push(
    '## 校验',
    '',
    '下载后请核对与 tar.gz 同级的 `SHA256SUMS`：',
    '',
    '```bash',
    `sha256sum -c SHA256SUMS`,
    '```',
    '',
  )
  return lines.join('\n')
}

/** 收集发布文件；返回 { path, data }，路径统一使用 /。 */
export function collectReleaseEntries(root = ROOT, includes = INCLUDES) {
  const entries = []

  const walk = (absolute, relPath) => {
    const info = lstatSync(absolute)
    if (info.isSymbolicLink()) return
    if (info.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) {
        if (SKIP_NAMES.has(name)) continue
        const childRel = relPath ? `${relPath}/${name}` : name
        if (SKIP_SEGMENTS.has(name)) continue
        walk(join(absolute, name), childRel)
      }
      return
    }
    if (!info.isFile()) return
    entries.push({ path: relPath, data: readFileSync(absolute) })
  }

  for (const item of includes) {
    const absolute = join(root, item)
    if (!existsSync(absolute)) continue
    walk(absolute, item)
  }
  return entries
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8')
}

function splitTarName(full) {
  if (byteLength(full) <= 100) return { name: full, prefix: '' }
  const index = full.lastIndexOf('/')
  if (index <= 0) throw new Error(`发布文件路径过长，无法写入 tar：${full}`)
  const prefix = full.slice(0, index)
  const name = full.slice(index + 1)
  if (byteLength(name) > 100 || byteLength(prefix) > 155) {
    throw new Error(`发布文件路径过长，无法写入 tar：${full}`)
  }
  return { name, prefix }
}

function writeOctal(buffer, value, offset, length) {
  const text = Number(value).toString(8).padStart(length - 1, '0')
  buffer.write(text, offset, length - 1, 'ascii')
  buffer[offset + length - 1] = 0
}

/** 生成 ustar + gzip；固定 mtime/uid/gid，便于复现。 */
export function createTarGz(entries, { prefix = '', mtime = 0 } = {}) {
  const blocks = []
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data)
    const full = prefix ? `${prefix}/${entry.path}` : entry.path
    const { name, prefix: longPrefix } = splitTarName(full)
    const header = Buffer.alloc(512, 0)
    header.write(name, 0, 100, 'utf8')
    writeOctal(header, 0o644, 100, 8)
    writeOctal(header, 0, 108, 8)
    writeOctal(header, 0, 116, 8)
    writeOctal(header, data.length, 124, 12)
    writeOctal(header, mtime, 136, 12)
    header.fill(0x20, 148, 156)
    header.write('0', 156, 1, 'ascii')
    header.write('ustar', 257, 6, 'ascii')
    header[262] = 0
    header.write('00', 263, 2, 'ascii')
    if (longPrefix) header.write(longPrefix, 345, 155, 'utf8')

    let checksum = 0
    for (const byte of header) checksum += byte
    header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')

    blocks.push(header, data)
    const padding = (512 - (data.length % 512)) % 512
    if (padding) blocks.push(Buffer.alloc(padding, 0))
  }
  blocks.push(Buffer.alloc(1024, 0))
  return gzipSync(Buffer.concat(blocks), { level: 9 })
}

function readTarString(buffer, offset, length) {
  const slice = buffer.subarray(offset, offset + length)
  const zero = slice.indexOf(0)
  return slice.subarray(0, zero === -1 ? slice.length : zero).toString('utf8')
}

/** 仅供测试/排查：列出 tar.gz 内的路径与内容。 */
export function listTarGz(buffer) {
  const tar = gunzipSync(buffer)
  const entries = []
  let offset = 0
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every((byte) => byte === 0)) break
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const sizeText = readTarString(header, 124, 12).trim()
    const size = sizeText ? parseInt(sizeText, 8) : 0
    const path = prefix ? `${prefix}/${name}` : name
    const start = offset + 512
    entries.push({ path, data: tar.subarray(start, start + size) })
    offset = start + Math.ceil(size / 512) * 512
  }
  return entries
}

function run(label, command, args, { env = {}, allowFailure = false } = {}) {
  console.log(`\n[release] ${label}`)
  console.log(`$ ${command} ${args.join(' ')}`)
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
      env: { ...process.env, ...env },
    },
  )
  if (result.error) throw result.error
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${label} 失败（退出码 ${result.status}）`)
  }
  return result.status
}

function gitInfo() {
  const head = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  if (head.status !== 0) {
    return {
      repo: false,
      commit: String(process.env.GITHUB_SHA || '').slice(0, 12),
      dirty: false,
    }
  }
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  return {
    repo: true,
    commit: head.stdout.trim(),
    dirty: Boolean(status.stdout.trim()),
  }
}

function releaseDate() {
  return new Date().toISOString().slice(0, 10)
}

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : ''
}

function writePackageVersion(version) {
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  pkg.version = version
  writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
}

function parseArgs(argv) {
  const options = {
    version: '',
    bump: '',
    notes: '',
    image: 'dajia-decides',
    skipTests: false,
    skipBuild: false,
    skipTypecheck: false,
    docker: false,
    tag: false,
    dryRun: false,
    allowDirty: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} 缺少参数`)
      i += 1
      return value
    }
    if (arg === '--version') options.version = next()
    else if (arg === '--bump') options.bump = next()
    else if (arg === '--notes') options.notes = next()
    else if (arg === '--image') options.image = next()
    else if (arg === '--skip-tests') options.skipTests = true
    else if (arg === '--skip-build') options.skipBuild = true
    else if (arg === '--skip-typecheck') options.skipTypecheck = true
    else if (arg === '--docker') options.docker = true
    else if (arg === '--tag') options.tag = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--allow-dirty') options.allowDirty = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`未知参数：${arg}`)
  }
  return options
}

function help() {
  console.log(`用法：node scripts/release.mjs [选项]

  --version <x.y.z>   指定发布版本
  --bump <kind>       递增版本：patch | minor | major
  --notes <text>      附加到发布说明的摘要
  --image <name>      镜像名（默认 dajia-decides）
  --skip-typecheck    跳过类型检查
  --skip-build        复用已有 dist/
  --skip-tests        跳过测试
  --docker            构建并打镜像 tag（需要 Docker）
  --tag               创建 git tag v<version>（需要 git 仓库）
  --dry-run           只打印计划，不写文件
  --allow-dirty       允许在 git 工作区有改动时发布
  -h, --help          显示帮助`)
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    help()
    return
  }
  if (options.version && options.bump) throw new Error('--version 与 --bump 不能同时使用')

  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const current = formatVersion(pkg.version)
  const version = options.version
    ? formatVersion(options.version)
    : options.bump
      ? bumpVersion(current, options.bump)
      : current
  parseVersion(version)
  const date = releaseDate()
  const git = gitInfo()

  if (git.dirty && !options.allowDirty) {
    throw new Error(
      'git 工作区有未提交改动；请先提交，或加 --allow-dirty 明确允许发布未提交内容。',
    )
  }
  if (git.dirty) {
    console.warn('[release] 警告：工作区有未提交改动，发布包可能与 tag 不完全对应。')
  }

  console.log(`[release] ${current} -> ${version}`)
  console.log(`[release] schema v${SCHEMA_VERSION} (${SCHEMA_NAME})`)
  console.log(`[release] commit: ${git.commit || 'unknown'}${git.dirty ? ' (dirty)' : ''}`)
  if (options.dryRun) console.log('[release] dry-run：不会写入任何文件')

  const validation = {
    typecheck: 'skipped',
    build: 'skipped',
    tests: 'skipped',
  }

  if (!options.skipTypecheck) {
    run('类型检查', 'pnpm', ['typecheck'])
    validation.typecheck = 'passed'
  }
  if (!options.skipBuild) {
    run('构建前端', 'pnpm', ['build'])
    validation.build = 'passed'
  }
  if (!options.skipTests) {
    run('运行测试', 'pnpm', ['test'])
    validation.tests = 'passed'
  }

  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('dist/index.html 不存在；请先运行 pnpm build，或去掉 --skip-build')
  }

  if (!options.dryRun) writePackageVersion(version)

  const imageTags = [`${options.image}:${version}`, `${options.image}:latest`]
  if (options.docker) {
    if (options.dryRun) {
      console.log(`[release] 将构建镜像：${imageTags.join(', ')}`)
    } else {
      run('构建 Docker 镜像', 'docker', [
        'build',
        '--build-arg',
        `APP_VERSION=${version}`,
        '--build-arg',
        `GIT_SHA=${git.commit || ''}`,
        ...imageTags.flatMap((tag) => ['-t', tag]),
        '.',
      ])
    }
  }

  const entries = collectReleaseEntries()
  if (!entries.length) throw new Error('没有收集到任何发布文件')
  const digest = sha256(Buffer.concat(entries.map((entry) => entry.data)))

  const changelog = extractChangelogSection(readIfExists(join(ROOT, 'CHANGELOG.md')), version)
  const roadmapDays = extractRoadmapDays(readIfExists(join(ROOT, 'docs', 'ROADMAP.md')))
  const notes = buildReleaseNotes({
    version,
    date,
    summary: options.notes,
    changelog,
    days: roadmapDays,
    validation,
    schemaVersion: SCHEMA_VERSION,
    schemaName: SCHEMA_NAME,
    imageTags,
  })

  const artifactName = `dajia-decides-${version}.tar.gz`
  const artifactPath = join(RELEASE_ROOT, artifactName)
  const versionDir = join(RELEASE_ROOT, version)
  const archive = createTarGz(entries, { prefix: `dajia-decides-${version}` })
  const artifact = {
    file: artifactName,
    bytes: archive.length,
    sha256: sha256(archive),
  }

  const manifest = {
    name: pkg.name,
    version,
    releaseDate: date,
    builtAt: new Date().toISOString(),
    commit: git.commit || null,
    dirty: git.dirty || version !== current,
    schemaVersion: SCHEMA_VERSION,
    schemaName: SCHEMA_NAME,
    contentDigest: digest,
    validation,
    docker: {
      image: options.image,
      tags: imageTags,
      built: options.docker && !options.dryRun,
    },
    artifact,
    files: entries.map((entry) => ({
      path: entry.path,
      bytes: entry.data.length,
      sha256: sha256(entry.data),
    })),
  }

  if (!options.dryRun) {
    mkdirSync(versionDir, { recursive: true })
    writeFileSync(artifactPath, archive)
    writeFileSync(join(versionDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
    writeFileSync(join(versionDir, 'RELEASE_NOTES.md'), `${notes}\n`)

    // SHA256SUMS 放在 release/ 根目录，和 tar.gz 同级；
    // GitHub Release 下载后的扁平文件也能直接 `sha256sum -c SHA256SUMS`。
    writeFileSync(
      join(RELEASE_ROOT, 'SHA256SUMS'),
      `${artifact.sha256}  ${artifactName}\n`,
    )
    // 兼容旧版本生成在版本目录内的 SHA256SUMS。
    const legacyChecksums = join(versionDir, 'SHA256SUMS')
    if (existsSync(legacyChecksums)) unlinkSync(legacyChecksums)
  }

  if (options.tag) {
    if (!git.repo) throw new Error('--tag 需要 git 仓库')
    if (options.dryRun) {
      console.log(`[release] 将创建 tag v${version}`)
    } else {
      run('创建 git tag', 'git', ['tag', '-a', `v${version}`, '-m', `Release v${version}`])
    }
  }

  console.log('\n[release] 完成')
  console.log(`  版本：${version}`)
  console.log(`  文件：${entries.length} 个，${(entries.reduce((sum, entry) => sum + entry.data.length, 0) / 1024).toFixed(1)} KB`)
  console.log(`  schema：v${SCHEMA_VERSION}`)
  if (options.dryRun) {
    console.log('  dry-run：未写入发布包')
  } else {
    console.log(`  发布包：${relative(ROOT, artifactPath)} (${artifact.sha256.slice(0, 12)}…)`)
    console.log(`  清单：${relative(ROOT, join(versionDir, 'manifest.json'))}`)
    console.log(`  校验：${relative(ROOT, join(RELEASE_ROOT, 'SHA256SUMS'))}`)
  }
  console.log(`  镜像 tag：${imageTags.join(', ')}`)
}

const isMain =
  process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isMain) {
  main().catch((error) => {
    console.error(`[release] 失败：${error.message}`)
    process.exitCode = 1
  })
}

export { ROOT, INCLUDES }
