#!/usr/bin/env node
/**
 * 说明书配图 runner。
 *
 * preview（默认，Docker 外）：只运行配图用例并截图到 `test-results/manual-preview`，不校验基线。
 * publish / check（canonical 容器内）：写入或校验 `tests/manual/baselines`。
 *
 * 与逐屏视觉回归（`scripts/run-visual.mjs`）共用确定性启动与截图比对实现，
 * 但基线目录、运行模式变量与 Playwright 配置独立，产物不并入视觉基线。
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCanonicalEnvironment } from './product-docs/environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const mode = process.argv[2] ?? 'preview'
if (process.argv.length > 3 || !['preview', 'publish', 'check'].includes(mode)) {
  console.error(
    '说明书配图 runner 用法：node scripts/run-manual-figures.mjs <preview|publish|check>'
  )
  process.exit(2)
}

const repositoryRoot = path.resolve(scriptDirectory, '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')

if (
  mode !== 'preview' &&
  (process.env['LS101_MANUAL_CANONICAL'] !== undefined ||
    process.env['LS101_MANUAL_CANONICAL_RUNNER'] !== undefined)
) {
  console.error('preview 说明书配图运行禁止设置 canonical runner 环境变量。')
  process.exit(2)
}

if (mode !== 'preview') verifyCanonicalEnvironment({ repositoryRoot })

const environment =
  mode === 'preview'
    ? process.env
    : {
        ...process.env,
        LS101_MANUAL_CANONICAL: '1',
        LS101_MANUAL_CANONICAL_RUNNER: '1',
        LS101_MANUAL_MODE: mode
      }

const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.manual.config.ts'],
  { cwd: repositoryRoot, env: environment, stdio: 'inherit' }
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
