#!/usr/bin/env node
/**
 * manual-local.mjs — 在本地生成 docs/manual
 *
 * 产品说明书是纯文本产物（不含截图），因此不依赖 canonical 渲染容器。
 * 逐屏视觉基线仍只允许由 canonical 容器生成（见 tests/visual/README.md）。
 *
 * 用法：yarn docs:manual:local
 * 前置：yarn build:test（需要打包后的应用）
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.product-docs.config.ts'],
  {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PRODUCT_DOCS_CANONICAL: '1',
      PRODUCT_DOCS_CANONICAL_RUNNER: '1',
      PRODUCT_DOCS_MANUAL_ONLY: '1'
    },
    stdio: 'inherit'
  }
)

if (result.error) throw result.error
if (result.status !== 0) {
  console.error('产品说明书生成失败：产品操作测试未全部通过，docs/manual 未被覆盖。')
}
process.exit(result.status ?? 1)
