import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './tests/lab',
  outputDir: './test-results/lab',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' }
})
