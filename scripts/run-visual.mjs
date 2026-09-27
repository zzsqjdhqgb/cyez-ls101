#!/usr/bin/env node
/**
 * 视觉回归 runner。
 *
 * preview（默认，Docker 外）：只运行逐屏视觉测试并截图到 test-results，不校验基线。
 * publish / check（canonical 容器内）：写入或校验 tests/visual/baselines。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCanonicalEnvironment } from './product-docs/environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const mode = process.argv[2] ?? 'preview'
if (process.argv.length > 3 || !['preview', 'publish', 'check'].includes(mode)) {
  console.error('视觉回归 runner 用法：node scripts/run-visual.mjs <preview|publish|check>')
  process.exit(2)
}

const repositoryRoot = path.resolve(scriptDirectory, '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')

if (
  mode !== 'preview' &&
  (process.env['LS101_VISUAL_CANONICAL'] !== undefined ||
    process.env['LS101_VISUAL_CANONICAL_RUNNER'] !== undefined)
) {
  console.error('preview 视觉回归运行禁止设置 canonical runner 环境变量。')
  process.exit(2)
}

if (mode !== 'preview') verifyCanonicalEnvironment({ repositoryRoot })

const environment =
  mode === 'preview'
    ? process.env
    : {
        ...process.env,
        LS101_VISUAL_CANONICAL: '1',
        LS101_VISUAL_CANONICAL_RUNNER: '1',
        LS101_VISUAL_MODE: mode
      }

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.visual.config.ts'],
  { cwd: repositoryRoot, env: environment, stdio: 'inherit' }
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
