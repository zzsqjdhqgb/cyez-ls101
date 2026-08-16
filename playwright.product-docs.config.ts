import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/product-docs',
  testIgnore: '**/*.test.ts',
  outputDir: './test-results/product-docs',
  timeout: 30_000,
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
