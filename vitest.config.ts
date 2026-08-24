import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'packages/*/vitest.config.ts',
      'tests/main/vitest.config.ts',
      'tests/product-docs/vitest.config.ts'
    ]
  }
})
