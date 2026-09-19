#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-docs.mjs — 文档门禁
 *
 * 校验：
 *   1. 手写文档是否带状态元数据块，字段与取值是否合法（docs/product/** 作为弃用层豁免）
 *   2. 相对链接是否可达（old/ 与 docs/archive/ 为冻结层，断链降级为警告）
 *   3. 关键索引文件是否存在
 *   4. implemented 文档中是否出现明确的未来时态（警告，启发式）
 *   5. docs/ui、docs/engineering 下是否有未被任何文档链接的孤儿（警告）
 *
 * 用法：yarn docs:check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const STATUS = new Set(['implemented', 'confirmed', 'draft', 'superseded', 'archived'])
const AUDIENCE = new Set(['user', 'engineer', 'both'])
const REQUIRED = ['status', 'product-version', 'audience', 'owner']
const FUTURE_RE = /(计划实现|计划支持|将来版本|未来版本|TODO:|FIXME)/

const REQUIRED_INDEX = [
  'docs/README.md',
  'docs/ui/README.md',
  'docs/engineering/README.md',
  'docs/archive/README.md',
  'docs/manual/README.md'
]

const MANAGED_ORPHAN_DIRS = ['docs/ui', 'docs/engineering']
const DEPRECATED_PREFIX = 'docs/product/'

const errors = []
const warnings = []

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')
const isFrozen = (r) => r.startsWith('old/') || r.startsWith('docs/archive/')

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p))
    else if (entry.name.endsWith('.md')) out.push(p)
  }
  return out
}

const files = new Set()
for (const p of walk(path.join(ROOT, 'docs'))) files.add(p)
for (const p of walk(path.join(ROOT, 'old'))) files.add(p)
for (const name of ['README.md', 'CONTRIBUTING.md', 'AGENTS.md', 'DOCS-REVISION-PLAN.md']) {
  const p = path.join(ROOT, name)
  if (fs.existsSync(p)) files.add(p)
}
for (const name of ['.claude/CLAUDE.md', '.github/CI.md']) {
  const p = path.join(ROOT, name)
  if (fs.existsSync(p)) files.add(p)
}

const linkedTargets = new Set()

function parseMeta(text) {
  const m = text.match(/^\uFEFF?\s*<!--\s*\r?\n([\s\S]*?)\r?\n\s*-->/)
  if (!m) return null
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([a-zA-Z-]+)\s*:\s*(.*?)\s*$/)
    if (kv && kv[2] !== '') meta[kv[1]] = kv[2]
  }
  return meta
}

for (const file of [...files].sort()) {
  const text = fs.readFileSync(file, 'utf8')
  const r = rel(file)
  const deprecated = r.startsWith(DEPRECATED_PREFIX)
  const head = text.slice(0, 400)
  const generated =
    head.includes('<!--') && (head.includes('自动生成') || head.includes('generated'))

  if (!generated && !deprecated) {
    const meta = parseMeta(text)
    if (!meta || !meta.status) {
      errors.push(`${r}: 缺少文件头状态元数据块（<!-- status: ... -->）`)
    } else {
      for (const key of REQUIRED) {
        if (!meta[key]) errors.push(`${r}: 元数据缺少 ${key}`)
      }
      if (!STATUS.has(meta.status)) errors.push(`${r}: 非法 status "${meta.status}"`)
      if (meta.audience && !AUDIENCE.has(meta.audience)) {
        errors.push(`${r}: 非法 audience "${meta.audience}"`)
      }
      if (meta.status === 'superseded' && !meta['superseded-by']) {
        errors.push(`${r}: status=superseded 但缺少 superseded-by`)
      }
      if (meta.status === 'implemented' && !isFrozen(r)) {
        text.split(/\r?\n/).forEach((line, i) => {
          if (FUTURE_RE.test(line)) {
            warnings.push(
              `${r}:${i + 1}: implemented 文档出现未来时态: ${line.trim().slice(0, 40)}`
            )
          }
        })
      }
    }
  }

  const re = /\]\(([^)\s]+)\)/g
  let m
  while ((m = re.exec(text))) {
    let link = m[1]
    if (/^(https?:|mailto:|#)/.test(link)) continue
    link = link.split('#')[0].replace(/:\d+$/, '')
    if (!link) continue
    // 跳过文档中的占位/表达式写法，例如 [@this.question-image]
    if (/[[\]@]/.test(link)) continue
    const target = path.resolve(path.dirname(file), decodeURIComponent(link))
    linkedTargets.add(target)
    if (!fs.existsSync(target)) {
      const msg = `${r}: 断链 -> ${m[1]}`
      if (isFrozen(r)) warnings.push(`${msg}（冻结层）`)
      else errors.push(msg)
    }
  }
}

for (const idx of REQUIRED_INDEX) {
  if (!fs.existsSync(path.join(ROOT, idx))) errors.push(`缺少索引文件: ${idx}`)
}

for (const dir of MANAGED_ORPHAN_DIRS) {
  for (const file of walk(path.join(ROOT, dir))) {
    if (path.basename(file) === 'README.md') continue
    if (!linkedTargets.has(file)) warnings.push(`${rel(file)}: 未被任何文档链接（孤儿）`)
  }
}

// 6. 逐屏规格：必须声明 anchors.visual；规格文件与索引必须一致
const SCREEN_DIR = path.join(ROOT, 'docs/ui/screens')
const SCREEN_INDEX = path.join(SCREEN_DIR, 'README.md')
if (fs.existsSync(SCREEN_DIR)) {
  const specFiles = fs
    .readdirSync(SCREEN_DIR)
    .filter((name) => /^UI-[A-Z]{2}-\d{2}\.md$/.test(name))
  const visualStats = { anchored: 0, unverified: 0, na: 0 }
  const behaviorStats = { anchored: 0, unverified: 0 }
  for (const name of specFiles) {
    const text = fs.readFileSync(path.join(SCREEN_DIR, name), 'utf8')
    const vm = text.match(/visual:\s*([^\n]+)/)
    if (!vm) {
      errors.push(`docs/ui/screens/${name}: 缺少 anchors.visual（必须显式声明或写 n/a（原因））`)
    } else {
      const value = vm[1].trim()
      if (/^n\/a/i.test(value)) visualStats.na += 1
      else if (/unverified/i.test(value)) visualStats.unverified += 1
      else visualStats.anchored += 1
    }
    const bm = text.match(/behavior:\s*([^\n]+)/)
    if (bm && !/unverified/i.test(bm[1])) behaviorStats.anchored += 1
    else behaviorStats.unverified += 1
  }
  console.log(
    `UI 规格 ${specFiles.length} 篇：视觉锚定 ${visualStats.anchored} / 未验证 ${visualStats.unverified} / n/a ${visualStats.na}；` +
      `行为锚定 ${behaviorStats.anchored} / 未验证 ${behaviorStats.unverified}`
  )

  if (fs.existsSync(SCREEN_INDEX)) {
    const indexText = fs.readFileSync(SCREEN_INDEX, 'utf8')
    const declared = new Map()
    for (const line of indexText.split(/\r?\n/)) {
      const m = line.match(/^\|\s*(UI-[A-Z]{2}-\d{2})\s*\|(.*)$/)
      if (m) declared.set(m[1], !m[2].includes('未建立'))
    }
    for (const name of specFiles) {
      const id = name.replace(/\.md$/, '')
      if (!declared.has(id)) {
        warnings.push(`docs/ui/screens/${name}: 规格未登记在 docs/ui/screens/README.md 索引中`)
      } else if (!declared.get(id)) {
        warnings.push(`docs/ui/screens/${name}: 索引仍标记为「未建立」（索引待刷新）`)
      }
    }
  }
}

function print(label, list) {
  if (!list.length) return
  console.log(`\n${label} (${list.length})`)
  for (const item of list) console.log(`  - ${item}`)
}

print('ERRORS', errors)
print('WARNINGS', warnings)
console.log(`\n检查 ${files.size} 个 markdown 文件：${errors.length} 错误，${warnings.length} 警告`)
process.exit(errors.length ? 1 : 0)
