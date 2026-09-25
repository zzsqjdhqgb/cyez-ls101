import { defineConfig } from '@playwright/test'

const VISUAL_TEST_TIMEOUT = process.platform === 'win32' ? 75_000 : 30_000

export default defineConfig({
  testDir: './tests/visual',
  testIgnore: '**/*.test.ts',
  outputDir: './test-results/visual',
  timeout: VISUAL_TEST_TIMEOUT,
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
