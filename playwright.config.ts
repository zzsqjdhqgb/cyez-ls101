import { defineConfig } from '@playwright/test'

export default defineConfig({
  captureGitInfo: {
    commit: true,
    diff: false
  },
  testDir: './tests/integration',
  outputDir: './test-results/integration',
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 2,
  projects: [
    {
      name: 'airouter',
      testMatch: '**/airouter.spec.ts',
      workers: 1
    },
    {
      name: 'application',
      testIgnore: '**/airouter.spec.ts',
      workers: 1
    }
  ],
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
