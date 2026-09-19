#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-visual.mjs — 逐屏视觉回归配对校验
 *
 * 校验 docs/ui/screens/UI-*.md 的 anchors.visual 与 tests/visual 的一致性：
 *   1. 声明 VR-* 的规格必须能解析出测试文件，且该文件存在；
 *   2. 测试实际捕获的状态集合，必须与磁盘上的基线集合一致（基线存在时）。
 *
 * 基线只由 canonical 容器生成；本地没有基线时只校验第 1 项并输出统计。
 *
 * 用法：yarn visual:check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const SCREEN_DIR = path.join(ROOT, 'docs/ui/screens')
const BASELINE_DIR = path.join(ROOT, 'tests/visual/baselines')

const errors = []
const anchored = []
const notApplicable = []
const unverified = []

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/')

if (!fs.existsSync(SCREEN_DIR)) {
  console.error(`缺少目录: ${rel(SCREEN_DIR)}`)
  process.exit(1)
}

const specs = fs.readdirSync(SCREEN_DIR).filter((name) => /^UI-[A-Z]{2}-\d{2}\.md$/.test(name))

for (const name of specs.sort()) {
  const id = name.replace(/\.md$/, '')
  const text = fs.readFileSync(path.join(SCREEN_DIR, name), 'utf8')
  const match = text.match(/visual:\s*([^\n]+)/)
  if (!match) {
    errors.push(`${rel(path.join(SCREEN_DIR, name))}: 缺少 anchors.visual`)
    continue
  }
  const value = match[1].trim()

  if (/^n\/a/i.test(value)) {
    notApplicable.push(id)
    continue
  }
  if (/unverified/i.test(value)) {
    unverified.push(id)
    continue
  }

  const specMatch = value.match(/tests\/visual\/[^\s；)]+\.spec\.ts/)
  if (!specMatch) {
    errors.push(`${id}: visual 锚点无法解析出 tests/visual 测试路径`)
    continue
  }
  const specPath = path.join(ROOT, specMatch[0])
  if (!fs.existsSync(specPath)) {
    errors.push(`${id}: visual 锚点指向的测试不存在 -> ${specMatch[0]}`)
    continue
  }

  anchored.push(id)

  const specText = fs.readFileSync(specPath, 'utf8')
  const declared = new Set()
  const callRe = /captureState\([^,]+,\s*'([^']+)',\s*'([^']+)'\)/g
  let call
  while ((call = callRe.exec(specText))) {
    if (call[1] === id) declared.add(call[2])
  }
  if (declared.size === 0) {
    errors.push(`${id}: 测试未捕获该界面的任何状态 -> ${specMatch[0]}`)
    continue
  }

  const baselineDir = path.join(BASELINE_DIR, id)
  if (!fs.existsSync(baselineDir)) continue

  const files = new Set(
    fs
      .readdirSync(baselineDir)
      .filter((file) => file.endsWith('.png'))
      .map((file) => file.replace(/\.png$/, ''))
  )
  for (const state of declared) {
    if (!files.has(state)) errors.push(`${id}: 缺少基线 ${state}.png`)
  }
  for (const state of files) {
    if (!declared.has(state)) errors.push(`${id}: 基线 ${state}.png 未在测试中捕获（陈旧基线）`)
  }
}

if (errors.length) {
  console.log(`\nERRORS (${errors.length})`)
  for (const item of errors) console.log(`  - ${item}`)
}

console.log(
  `\n视觉配对：${specs.length} 篇规格；已锚定 ${anchored.length}，未验证 ${unverified.length}，n/a ${notApplicable.length}`
)
if (fs.existsSync(BASELINE_DIR)) {
  console.log(`基线目录已存在：${rel(BASELINE_DIR)}`)
} else {
  console.log('基线目录尚未建立（需 canonical 容器生成）')
}
process.exit(errors.length ? 1 : 0)
