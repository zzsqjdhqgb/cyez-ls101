import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { root: __dirname, include: ['*.test.ts'], testTimeout: 15 * 60000, maxWorkers: 1 }
})
