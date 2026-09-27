#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-user-facing-copy.mjs — 禁止英文错误信息直达界面。
 *
 * 领域包与主进程抛出的错误会经 IPC 传到 renderer 的错误条上原样显示。凡用户可能读到的错误消息，
 * 一律使用中文（术语见 docs/ui/glossary.md）；本脚本扫描非测试源码里的错误构造点：
 *
 *   1. `new Error('…')` 与 `new XxxError('…')`
 *   2. `new XxxError('CODE', '…')` 的第二个参数
 *   3. 各包的错误工厂（`invalidData`、`identityConflict`、`revisionConflict` …）的字符串参数
 *
 * 消息含中日韩字符即通过；纯英文、且含字母的消息判为违规。错误码（如 `INVALID_DATA`）不算消息，不检查。
 *
 * 用法：yarn docs:copy:check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ROOTS = ['packages', 'src']
const CJK = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/
const HAS_LETTER = /[A-Za-z]/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', '__tests__', 'test-results'])
const ERROR_FACTORIES = [
  'invalidData',
  'invalidStorage',
  'identityConflict',
  'revisionConflict',
  'invalidArchive',
  'invalidModelResponse',
  'invalidPackage',
  'invalidZip',
  'builtinSchemaError',
  'notFound',
  'functionNotFound',
  'invalidLocalLibrary',
  'releaseConflict',
  'templateReleaseConflict'
]

const QUOTE = `['"\`]`
const MESSAGE = `((?:[^'"\`\\\\]|\\\\.)*?)`
const PATTERNS = [
  new RegExp(String.raw`new\s+[A-Za-z]*Error\(\s*(${QUOTE})${MESSAGE}\1`, 'g'),
  new RegExp(
    String.raw`new\s+[A-Za-z]*Error\(\s*(${QUOTE})(?:[^'"\`\\\\]|\\\\.)*?\1\s*,\s*(${QUOTE})${MESSAGE}\2`,
    'g'
  ),
  new RegExp(String.raw`\b(?:${ERROR_FACTORIES.join('|')})\(\s*(${QUOTE})${MESSAGE}\1`, 'g')
]

/** 错误码形如 `INVALID_DATA`；跟在逗号后的下一个字符串才是给用户的消息。 */
const ERROR_CODE = /^[A-Z][A-Z0-9_]*$/

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) walk(full, files)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) files.push(full)
  }
  return files
}

const violations = []
for (const root of ROOTS) {
  for (const file of walk(path.join(ROOT, root))) {
    const text = fs.readFileSync(file, 'utf8')
    for (const pattern of PATTERNS) {
      pattern.lastIndex = 0
      let match
      while ((match = pattern.exec(text)) !== null) {
        const message = match[match.length - 1]
        if (!message || !HAS_LETTER.test(message)) continue
        // `new XxxError('CODE', 消息)`：错误码后面还有别的参数就跳过，消息本身仍会被其它模式检查。
        if (ERROR_CODE.test(message) && /^\s*,/.test(text.slice(match.index + match[0].length))) {
          continue
        }
        // 消息里只要出现中日韩字符就算已本地化（可能夹带允许保留的英文缩写）。
        if (CJK.test(message)) continue
        violations.push({
          file: path.relative(ROOT, file).split(path.sep).join('/'),
          line: text.slice(0, match.index).split(/\r?\n/).length,
          message
        })
      }
    }
  }
}

if (violations.length > 0) {
  console.log(`\nERRORS (${violations.length})：以下错误消息会原样显示给用户，必须改为中文`)
  for (const item of violations) {
    console.log(`  - ${item.file}:${item.line}  ${JSON.stringify(item.message)}`)
  }
}
console.log(`\n用户可见错误文案：检查 ${ROOTS.join(' / ')}，${violations.length} 处英文消息`)
process.exit(violations.length > 0 ? 1 : 0)
