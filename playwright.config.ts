import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/integration',
  outputDir: './test-results/integration',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
