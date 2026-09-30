import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      'apps/lab-student/vitest.config.ts',
      'apps/lab-teacher/vitest.config.ts',
      'packages/lab-desktop-host/vitest.config.ts',
      'packages/lab-renderer/vitest.config.ts'
    ]
  }
})
