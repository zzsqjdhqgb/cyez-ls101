import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCanonicalEnvironment } from './product-docs/environment.mjs'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

const mode = process.argv[2] ?? 'preview'
if (process.argv.length > 3 || !['preview', 'publish'].includes(mode)) {
  console.error(
    '产品文档 runner 用法：node scripts/run-product-docs.mjs <preview|publish>。筛选请使用 yarn test:product-docs:preview --grep <pattern>。'
  )
  process.exit(2)
}

const repositoryRoot = path.resolve(scriptDirectory, '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
if (
  mode === 'preview' &&
  (process.env['PRODUCT_DOCS_CANONICAL'] !== undefined ||
    process.env['PRODUCT_DOCS_CANONICAL_RUNNER'] !== undefined)
) {
  console.error('preview 产品文档运行禁止设置 canonical runner 环境变量。')
  process.exit(2)
}
if (mode === 'publish') verifyCanonicalEnvironment({ repositoryRoot })

const testResult = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.product-docs.config.ts'],
  {
    cwd: repositoryRoot,
    env:
      mode === 'publish'
        ? { ...process.env, PRODUCT_DOCS_CANONICAL: '1', PRODUCT_DOCS_CANONICAL_RUNNER: '1' }
        : process.env,
    stdio: 'inherit'
  }
)

if (testResult.error) throw testResult.error
if (testResult.status !== 0) process.exit(testResult.status ?? 1)

if (mode === 'publish') {
  const inventoryResult = spawnSync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts', 'generate-playwright-inventory.mjs')],
    { cwd: repositoryRoot, stdio: 'inherit' }
  )

  if (inventoryResult.error) throw inventoryResult.error
  process.exit(inventoryResult.status ?? 1)
}

process.exit(0)
