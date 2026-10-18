import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { blocklistPath, maxLinksPerField } from './config.mjs'
import { ApiError, str } from './validate.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_BLOCKLIST = resolve(here, '..', 'config', 'blocklist.txt')
let cachedPath = ''
let cachedWords = []

/**
 * 入库清洗：去掉零宽/控制字符，统一全角字母数字与全角空格，
 * 但保留中文全角标点（例如问号），避免改变正常文案。
 */
export function sanitizeText(value) {
  return String(value ?? '')
    .replace(/[\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/g, (ch) =>
      String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
    )
    .replace(/\u3000/g, ' ')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 匹配用归一化：NFKC 统一全角标点，再去除零宽字符与空白。 */
export function normalizeText(value) {
  return sanitizeText(value)
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 用于敏感词与重复理由比较：忽略空白差异。 */
export function matchKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, '')
}

function loadBlocklist() {
  const configured = blocklistPath()
  const path = configured ? resolve(process.cwd(), configured) : DEFAULT_BLOCKLIST
  if (path === cachedPath) return cachedWords
  cachedPath = path
  try {
    cachedWords = readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map(matchKey)
      .filter(Boolean)
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[content] 敏感词表读取失败', err)
    cachedWords = []
  }
  return cachedWords
}

export function assertContent(text, field) {
  const normalized = normalizeText(text)
  const key = matchKey(normalized)
  if (key) {
    for (const word of loadBlocklist()) {
      if (word && key.includes(word)) {
        throw new ApiError(
          400,
          'CONTENT_BLOCKED',
          '内容包含不适合发布的内容，请修改后再试',
          field,
        )
      }
    }
  }
  const links = normalized.match(/(?:https?:\/\/|www\.)\S+/gi) ?? []
  if (links.length > maxLinksPerField()) {
    throw new ApiError(
      400,
      'TOO_MANY_LINKS',
      `最多只能包含 ${maxLinksPerField()} 个链接`,
      field,
    )
  }
  return normalized
}

/**
 * 统一入口：先归一化，再做长度/敏感词/链接校验，最后返回可入库文本。
 * 用于昵称、标题、说明、投票理由和举报说明。
 */
export function contentText(value, options) {
  if (typeof value !== 'string') return str(value, options)
  const cleaned = sanitizeText(value)
  const out = str(cleaned, options)
  assertContent(out, options?.field)
  return out
}

export function reasonKey(value) {
  return matchKey(value)
}
