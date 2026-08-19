import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

if (process.argv.length > 2) {
  console.error(
    '正式产品文档生成不接受文件或 --grep 筛选。请使用 yarn test:product-docs:preview --grep <pattern>。'
  )
  process.exit(2)
}

const repositoryRoot = path.resolve(scriptDirectory, '..')
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js')
const testResult = spawnSync(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.product-docs.config.ts'],
  {
    cwd: repositoryRoot,
    env: { ...process.env, PRODUCT_DOCS_CANONICAL: '1' },
    stdio: 'inherit'
  }
)

if (testResult.error) throw testResult.error
if (testResult.status !== 0) process.exit(testResult.status ?? 1)

const inventoryResult = spawnSync(
  process.execPath,
  [path.join(repositoryRoot, 'scripts', 'generate-playwright-inventory.mjs')],
  { cwd: repositoryRoot, stdio: 'inherit' }
)

if (inventoryResult.error) throw inventoryResult.error
process.exit(inventoryResult.status ?? 1)
