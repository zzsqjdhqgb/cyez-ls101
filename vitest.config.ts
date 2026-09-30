import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/*/vitest.config.ts',
      'packages/*/vitest.config.ts',
      'tests/main/vitest.config.ts',
      'tests/product-docs/vitest.config.ts',
      // The lab VM drivers are developed against the real service in-process; the VM run adds the
      // parts that only exist on a target machine.
      'tests/lab-vm/vitest.config.ts'
    ]
  }
})
