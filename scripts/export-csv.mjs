import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_DB } from './backup.mjs'

function csvCell(value) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(columns, rows) {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map((column) => csvCell(row[column])).join(','))
  return `${lines.join('\r\n')}\r\n`
}

export function exportCsv({ dbPath = DEFAULT_DB, outDir = resolve(process.cwd(), 'exports') } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const questions = db
      .prepare(
        `SELECT id, user_id, title, description, category, closes_at, anonymous, featured, created_at
           FROM questions ORDER BY created_at ASC`,
      )
      .all()
    const votes = db
      .prepare(
        `SELECT id, question_id, user_id, choice, reason, anonymous, created_at, updated_at
           FROM votes ORDER BY created_at ASC`,
      )
      .all()
    mkdirSync(outDir, { recursive: true })
    const questionsFile = resolve(outDir, 'questions.csv')
    const votesFile = resolve(outDir, 'votes.csv')
    writeFileSync(
      questionsFile,
      toCsv(
        ['id', 'user_id', 'title', 'description', 'category', 'closes_at', 'anonymous', 'featured', 'created_at'],
        questions,
      ),
      'utf8',
    )
    writeFileSync(
      votesFile,
      toCsv(
        ['id', 'question_id', 'user_id', 'choice', 'reason', 'anonymous', 'created_at', 'updated_at'],
        votes,
      ),
      'utf8',
    )
    return { questionsFile, votesFile, questions: questions.length, votes: votes.length }
  } finally {
    db.close()
  }
}

function parseArgs(argv) {
  const options = {
    dbPath: process.env.DB_PATH || DEFAULT_DB,
    outDir: process.env.EXPORT_DIR || resolve(process.cwd(), 'exports'),
  }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') options.dbPath = argv[++i]
    else if (argv[i] === '--out') options.outDir = argv[++i]
  }
  return options
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  try {
    const result = exportCsv(parseArgs(process.argv.slice(2)))
    console.log(`[export] ${result.questionsFile} (${result.questions})`)
    console.log(`[export] ${result.votesFile} (${result.votes})`)
  } catch (err) {
    console.error('[export] 失败：', err.message)
    process.exitCode = 1
  }
}
