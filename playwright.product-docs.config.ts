import { defineConfig } from '@playwright/test'

const PRODUCT_DOCS_TEST_TIMEOUT = process.platform === 'win32' ? 75_000 : 30_000

export default defineConfig({
  testDir: './tests/product-docs',
  testIgnore: '**/*.test.ts',
  outputDir: './test-results/product-docs',
  timeout: PRODUCT_DOCS_TEST_TIMEOUT,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['./tests/product-docs/support/product-docs-reporter.ts']],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
