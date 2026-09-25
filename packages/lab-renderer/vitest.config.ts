import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: __dirname,
    environment: 'jsdom',
    setupFiles: ['../../vitest.setup.ts'],
    include: ['src/__tests__/**/*.test.{ts,tsx}']
  }
})
