#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-visual.mjs — 逐屏视觉回归配对校验
 *
 * 校验 docs/ui/screens/UI-*.md 的 anchors.visual 与 tests/visual 的一致性：
 *   1. 声明 VR-* 的规格必须能解析出测试文件，且该文件存在；
 *   2. anchors.visual-states 必须与测试实际捕获的状态集合一致；
 *   3. 已建立基线目录时，全部已锚定规格的基线必须与声明状态一致。
 *
 * 基线只由 canonical 容器生成；整个基线目录尚未建立时只校验规格与测试。
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
  const anchors = text.match(/^```yaml[ \t]*\r?\nanchors:[ \t]*\r?\n([\s\S]*?)^```/m)?.[1] ?? ''
  const match = anchors.match(/^ {2}visual:[ \t]*([^\r\n]+)/m)
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

  const statesLine = anchors.match(/^ {2}visual-states:[ \t]*([^\r\n]+)/m)?.[1]
  const statesMatch = statesLine?.match(/^\[([a-z0-9, -]+)\][ \t]*(?:#.*)?$/)
  const states = statesMatch?.[1].split(',').map((state) => state.trim()) ?? []
  if (
    states.length === 0 ||
    states.some((state) => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state)) ||
    new Set(states).size !== states.length
  ) {
    errors.push(`${id}: anchors.visual-states 必须为非空、无重复的状态列表，如 [default, empty]`)
    continue
  }
  const declared = new Set(states)
  const specText = fs.readFileSync(specPath, 'utf8')
  const captured = new Set()
  const callRe = /\bcaptureState\(\s*[^,]+,\s*(['"])([^'"]+)\1,\s*(['"])([^'"]+)\3\s*,?\s*\)/g
  let call
  while ((call = callRe.exec(specText))) {
    if (call[2] === id) captured.add(call[4])
    else errors.push(`${id}: 测试捕获了其他界面 ${call[2]} -> ${specMatch[0]}`)
  }
  for (const state of declared) {
    if (!captured.has(state)) errors.push(`${id}: 规格声明状态 ${state} 未在测试中捕获`)
  }
  for (const state of captured) {
    if (!declared.has(state)) errors.push(`${id}: 测试捕获了规格未声明的状态 ${state}`)
  }

  if (!fs.existsSync(BASELINE_DIR)) continue
  const baselineDir = path.join(BASELINE_DIR, id)
  if (!fs.existsSync(baselineDir)) {
    errors.push(`${id}: 缺少基线目录 ${rel(baselineDir)}`)
    continue
  }

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
    if (!declared.has(state)) errors.push(`${id}: 基线 ${state}.png 未在规格中声明（陈旧基线）`)
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
