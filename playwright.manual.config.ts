import { defineConfig } from '@playwright/test'

const MANUAL_FIGURE_TIMEOUT = process.platform === 'win32' ? 75_000 : 30_000

/**
 * 说明书配图套件。
 *
 * 与逐屏视觉回归（`playwright.visual.config.ts`）共用确定性启动与截图比对实现，
 * 但配置、用例目录、基线与运行命令全部独立，产物不并入 `tests/visual/baselines`。
 */
export default defineConfig({
  testDir: './tests/manual',
  testIgnore: '**/*.test.ts',
  outputDir: './test-results/manual',
  timeout: MANUAL_FIGURE_TIMEOUT,
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
