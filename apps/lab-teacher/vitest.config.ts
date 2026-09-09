import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    root: __dirname,
    include: ['renderer/__tests__/**/*.test.ts', 'main/__tests__/**/*.test.ts']
  }
})
