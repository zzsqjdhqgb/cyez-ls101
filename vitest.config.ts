import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      'tests/main/vitest.config.ts',
      'tests/product-docs/vitest.config.ts'
    ]
  }
})
