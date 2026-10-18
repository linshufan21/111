import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildReleaseNotes,
  bumpVersion,
  createTarGz,
  extractChangelogSection,
  extractRoadmapDays,
  formatVersion,
  listTarGz,
  parseVersion,
} from '../scripts/release.mjs'

test('release version parsing and bumps', () => {
  assert.deepEqual(parseVersion('1.2.3'), {
    major: 1,
    minor: 2,
    patch: 3,
    prerelease: '',
  })
  assert.equal(formatVersion(parseVersion('1.2.3-rc.1')), '1.2.3-rc.1')
  assert.equal(bumpVersion('0.1.0', 'patch'), '0.1.1')
  assert.equal(bumpVersion('0.1.0', 'minor'), '0.2.0')
  assert.equal(bumpVersion('0.1.0', 'major'), '1.0.0')
  assert.equal(bumpVersion('1.2.3-rc.1', 'patch'), '1.2.4')
  assert.throws(() => parseVersion('v1.2'), /版本号不合法/)
  assert.throws(() => bumpVersion('1.2.3', 'build'), /未知的版本递增类型/)
})

test('release notes read changelog and roadmap completed days', () => {
  const changelog = [
    '# 变更日志',
    '',
    '## [Unreleased]',
    '',
    '## [0.2.0] - 2026-10-20',
    '',
    '### 新增',
    '',
    '- 新功能 A',
    '',
    '## [0.1.0] - 2026-10-18',
    '',
    '- 旧功能',
  ].join('\n')
  const section = extractChangelogSection(changelog, '0.2.0')
  assert.match(section, /新功能 A/)
  assert.doesNotMatch(section, /旧功能/)
  assert.equal(extractChangelogSection(changelog, '9.9.9'), '')

  const roadmap = [
    '### Day 1 · 账号自助',
    '> ✅ 2026-10-18 完成。',
    '> 交付：改密与会话管理。',
    '### Day 2 · 邮箱验证',
    '> 交付：尚未完成。',
    '### Day 3 · 登录保护',
    '> ✅ 2026-10-19 完成。',
  ].join('\n')
  const days = extractRoadmapDays(roadmap)
  assert.equal(days.length, 2)
  assert.equal(days[0].day, 1)
  assert.equal(days[0].date, '2026-10-18')
  assert.match(days[0].delivered, /改密/)
  assert.equal(days[1].day, 3)

  const notes = buildReleaseNotes({
    version: '0.2.0',
    date: '2026-10-20',
    changelog: section,
    days,
    validation: { typecheck: 'passed', build: 'passed', tests: 'passed' },
    schemaVersion: 14,
    schemaName: 'day14-release-healthz',
    imageTags: ['dajia-decides:0.2.0'],
  })
  assert.match(notes, /# 大家来决定 v0\.2\.0/)
  assert.match(notes, /新功能 A/)
  assert.match(notes, /schema 版本：\*\*v14\*\*/)
  assert.match(notes, /dajia-decides:0\.2\.0/)
  assert.doesNotMatch(notes, /尚未完成/)
})

test('release tarball round-trips paths and contents', () => {
  const longPath = `docs/${'a'.repeat(80)}/${'b'.repeat(40)}.md`
  const entries = [
    { path: 'package.json', data: Buffer.from('{"version":"0.1.0"}\n') },
    { path: 'server/index.mjs', data: Buffer.from('console.log("你好")\n') },
    { path: longPath, data: Buffer.from('# long\n') },
  ]
  const archive = createTarGz(entries, { prefix: 'dajia-decides-0.1.0', mtime: 0 })
  assert.ok(archive.length > 0)

  const listed = listTarGz(archive)
  assert.deepEqual(
    listed.map((entry) => entry.path),
    entries.map((entry) => `dajia-decides-0.1.0/${entry.path}`),
  )
  for (let i = 0; i < entries.length; i += 1) {
    assert.equal(listed[i].data.toString('utf8'), entries[i].data.toString('utf8'))
  }
})
