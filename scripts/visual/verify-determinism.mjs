#!/usr/bin/env node
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/**
 * verify-determinism.mjs — 验证 canonical 基线发布的可复现性。
 *
 * 在能访问 Docker 宿主的机器上连续执行两次 canonical 发布，逐字节比较两次写出的 PNG：
 * 第二次发布必须与第一次完全一致（同一提交、同一镜像）。开发容器内无法代跑，原因见
 * docs/engineering/todo/dev-container-docker.md。
 *
 * 用法：yarn visual:verify-determinism
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const baselineRoot = path.join(repositoryRoot, 'tests/visual/baselines')

function hashBaselines() {
  const hashes = new Map()
  if (!existsSync(baselineRoot)) return hashes
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.png')) {
        const relative = path.relative(baselineRoot, full).split(path.sep).join('/')
        hashes.set(relative, createHash('sha256').update(readFileSync(full)).digest('hex'))
      }
    }
  }
  walk(baselineRoot)
  return hashes
}

function publish(attempt) {
  const result = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts/visual/docker.mjs'), 'publish'],
    { cwd: repositoryRoot, stdio: 'inherit' }
  )
  if (result.error) throw result.error
  if (result.status !== 0) {
    console.error(`第 ${attempt} 次 canonical 发布失败（退出码 ${result.status ?? '未知'}）。`)
    process.exit(result.status ?? 1)
  }
}

const before = hashBaselines()
publish('一')
const first = hashBaselines()
publish('二')
const second = hashBaselines()

const problems = []
for (const [file, hash] of first) {
  if (!second.has(file)) problems.push(`${file}: 第二次发布后基线消失`)
  else if (second.get(file) !== hash) problems.push(`${file}: 两次发布的 PNG 不一致`)
}
for (const file of second.keys()) {
  if (!first.has(file)) problems.push(`${file}: 第二次发布新增了基线`)
}

const changedOnFirstPublish = [...first].filter(([file, hash]) => before.get(file) !== hash).length
const changedOnSecondPublish = [...second].filter(([file, hash]) => first.get(file) !== hash).length
console.log(`基线数量：${second.size}`)
console.log(
  `第一次发布改动的基线：${changedOnFirstPublish}；第二次发布改动的基线：${changedOnSecondPublish}`
)

if (problems.length > 0) {
  console.error('可复现性验证失败：')
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}
console.log('可复现性验证通过：两次 canonical 发布逐字节一致。')
