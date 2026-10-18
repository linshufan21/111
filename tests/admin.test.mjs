import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { test } from 'node:test'
import { verifyPassword } from '../server/auth.mjs'

const CLI = resolve('scripts/create-admin.mjs')
const PASSWORD = 'correct-horse-battery-2026'

function run(dbPath, env = {}, args = []) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      ADMIN_USERNAME: 'siteadmin',
      ADMIN_EMAIL: 'admin@example.com',
      ADMIN_PASSWORD: PASSWORD,
      ...env,
    },
  })
}

test('create-admin creates verified admin without default password', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dajia-admin-test-'))
  const dbPath = join(dir, 'app.db')
  try {
    const first = run(dbPath)
    assert.equal(first.status, 0, first.stderr)

    const db = new DatabaseSync(dbPath)
    try {
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get('siteadmin')
      assert.ok(user)
      assert.equal(user.role, 'admin')
      assert.ok(user.email_verified_at)
      assert.equal(verifyPassword(PASSWORD, user.salt, user.password_hash), true)
      assert.notEqual(user.password_hash, PASSWORD)
      const audit = db.prepare("SELECT action FROM audit_logs WHERE action = 'admin.bootstrap'").get()
      assert.ok(audit)
    } finally {
      db.close()
    }

    const duplicate = run(dbPath)
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /已存在/)

    const forced = run(dbPath, { ADMIN_PASSWORD: 'another-long-password-2026' }, ['--force'])
    assert.equal(forced.status, 0, forced.stderr)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
