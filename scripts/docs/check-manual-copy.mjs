#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * check-manual-copy.mjs — 说明书文案引用门禁
 *
 * 说明书里用「」引用的界面文字（按钮、标题、提示语、字段标签、内置内容名称）必须能在权威来源里找到：
 *   docs/ui/screens/**        逐屏规格的「文案」与小节标题
 *   docs/ui/modules/**        模块设计文档
 *   docs/ui/glossary.md       术语表
 *   packages/renderer/src/**  界面源码里的用户可见文案
 *   resources/builtin/**      随软件提供的内置题型、模板、评分单元名称
 *
 * 这样手册不能凭印象编按钮名或提示语；引用不到就改手册，或先补规格。
 * 少数说明性短语（流程串写、操作系统路径）登记在 ALLOWED 中放行。
 *
 * 用法：yarn manual:copy:check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const MANUAL_DIR = path.join(ROOT, 'docs', 'manual')

/** 权威语料：规格、界面源码、内置内容。 */
const SOURCES = [
  { dir: 'docs/ui/screens', extensions: ['.md'] },
  { dir: 'docs/ui/modules', extensions: ['.md'] },
  { dir: 'packages/renderer/src', extensions: ['.tsx'], skipTests: true },
  { dir: 'resources/builtin', extensions: ['.json'], keepDotDirectories: true }
]
const SOURCE_FILES = ['docs/ui/glossary.md', 'docs/ui/README.md']

/** 说明性短语与操作系统路径：不是本软件的界面文字，不需要出现在规格里。 */
const ALLOWED = new Set([
  '出卷 → 考试 → 批改',
  '出卷 → 组卷 → 考试 → 评分',
  '设置 → AI 引擎',
  '设置 → 存储',
  '设置 → 许可',
  '设置 → 应用 → 已安装的应用',
  '控制面板 → 程序和功能',
  '出卷：先定评分标准',
  '出卷：准备题目内容',
  '出卷：把题目排成试卷，并生成可运行的试卷',
  '考试：存放生成好的试卷，考试从试卷库启动',
  '批改：导入作答、评分、结算出成绩',
  '通用：服务商、存储位置、许可、外观',
  '首页，汇总当前进度并提供入口',
  '版本 N',
  '未结算',
  '已结算'
])

function walk(directory, options, out = []) {
  if (!fs.existsSync(directory)) return out
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && !options.keepDotDirectories) continue
      if (options.skipTests && entry.name === '__tests__') continue
      walk(path.join(directory, entry.name), options, out)
      continue
    }
    if (options.extensions.some((extension) => entry.name.endsWith(extension))) {
      out.push(path.join(directory, entry.name))
    }
  }
  return out
}

const corpus = [
  ...SOURCES.flatMap((source) => walk(path.join(ROOT, source.dir), source)),
  ...SOURCE_FILES.map((file) => path.join(ROOT, file)).filter((file) => fs.existsSync(file))
]
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n')

const errors = []
const checked = new Set()

for (const file of walk(MANUAL_DIR, { extensions: ['.md'] })) {
  const lines = fs.readFileSync(file, 'utf8').split('\n')
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/「([^」]+)」/g)) {
      const quote = match[1].trim()
      if (quote === '' || ALLOWED.has(quote) || checked.has(quote)) continue
      checked.add(quote)
      if (!corpus.includes(quote)) {
        errors.push(
          `${path.relative(ROOT, file)}:${index + 1}: 引用的界面文字在规格中找不到 -> 「${quote}」`
        )
      }
    }
  })
}

console.log(`说明书文案引用：核对 ${checked.size} 条引用`)

if (errors.length > 0) {
  console.error(`\nERRORS (${errors.length})`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exitCode = 1
} else {
  console.log('全部引用都能在规格中找到')
}
