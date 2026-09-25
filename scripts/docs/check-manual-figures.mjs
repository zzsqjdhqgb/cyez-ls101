#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-manual-figures.mjs — 说明书配图门禁
 *
 * 校验三方一致：
 *   1. 说明书正文引用的配图必须存在于 `tests/manual/baselines/`；
 *   2. `tests/manual/baselines/` 下的每张基线都必须被说明书引用（无孤儿配图）；
 *   3. 配图用例 `captureFigure(page, '<图号>'[, '<状态>'])` 声明的每张图都必须有基线。
 *
 * 另有两项纪律：
 *   - 说明书配图不得引用逐屏视觉基线（`tests/visual/baselines/`），两套产物不合并；
 *   - 同一张基线被多处引用时给出警告（重复配图）。
 *
 * 整个基线目录尚未建立时（尚未做过 canonical 发布）只校验引用与用例的一致性。
 *
 * 用法：yarn manual:figures:check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE_DIR = path.join(ROOT, 'tests', 'manual', 'baselines')
const SPEC_DIR = path.join(ROOT, 'tests', 'manual')
const VISUAL_BASELINE_MARKER = 'tests/visual/baselines/'
/** `manual-draft/` 是说明书重写的评审暂存区，正式落地到 docs/manual 后删除。 */
const MANUAL_DIRS = ['docs/manual', 'manual-draft']

const errors = []
const warnings = []

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

function walk(dir, extension) {
  const out = []
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, extension))
    else if (entry.name.endsWith(extension)) out.push(full)
  }
  return out
}

/** 说明书正文里的配图引用：`![图 5-1 工作台](../../tests/manual/baselines/FIG-WORKBENCH/empty.png)` */
const references = new Map()
for (const manualDir of MANUAL_DIRS) {
  const absoluteDir = path.join(ROOT, manualDir)
  if (!fs.existsSync(absoluteDir)) continue
  for (const file of walk(absoluteDir, '.md')) {
    const text = fs.readFileSync(file, 'utf8')
    for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const target = match[1]
      if (target.includes(VISUAL_BASELINE_MARKER)) {
        errors.push(`${rel(file)}: 说明书配图不得引用逐屏视觉基线 -> ${target}`)
        continue
      }
      const marker = 'tests/manual/baselines/'
      const index = target.lastIndexOf(marker)
      if (index === -1) continue
      const key = target.slice(index + marker.length)
      const list = references.get(key) ?? []
      list.push(rel(file))
      references.set(key, list)
    }
  }
}

/** 用例声明的捕获：`captureFigure(page, 'FIG-WORKBENCH', 'empty')` */
const captures = new Set()
for (const file of walk(path.join(SPEC_DIR, 'figures'), '.spec.ts')) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(
    /captureFigure\(\s*page\s*,\s*'([^']+)'\s*(?:,\s*'([^']+)'\s*)?\)/g
  )) {
    captures.add(`${match[1]}/${match[2] ?? 'default'}.png`)
  }
}

const baselinesExist = fs.existsSync(BASELINE_DIR)
const baselines = new Set(
  walk(BASELINE_DIR, '.png').map((file) =>
    path.relative(BASELINE_DIR, file).split(path.sep).join('/')
  )
)

for (const [key, files] of references) {
  const source = files.join('、')
  if (files.length > 1) {
    warnings.push(`${key}: 被 ${files.length} 处引用（重复配图）：${source}`)
  }
  if (!baselinesExist) {
    if (!captures.has(key)) {
      errors.push(`${source}: 正文引用了 ${key}，但没有配图用例捕获它`)
    }
    continue
  }
  if (!baselines.has(key)) {
    errors.push(
      `${source}: 引用的配图缺少基线 -> ${key}（先在 canonical 容器内运行 yarn manual:figures:publish）`
    )
  }
}

if (baselinesExist) {
  for (const key of baselines) {
    if (!references.has(key))
      errors.push(`tests/manual/baselines/${key}: 未被任何说明书引用（孤儿配图）`)
    if (!captures.has(key))
      errors.push(`tests/manual/baselines/${key}: 没有对应用例捕获（陈旧基线）`)
  }
  for (const key of captures) {
    if (!baselines.has(key)) errors.push(`配图用例捕获了 ${key}，但磁盘上没有对应基线`)
  }
}

console.log(
  `说明书配图：正文引用 ${references.size} 张；用例捕获 ${captures.size} 张；` +
    (baselinesExist ? `磁盘基线 ${baselines.size} 张` : '基线目录尚未建立（跳过基线比对）')
)

for (const warning of warnings) console.log(`  WARN  ${warning}`)
if (errors.length > 0) {
  console.error(`\nERRORS (${errors.length})`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exitCode = 1
} else {
  console.log('说明书配图检查通过')
}
