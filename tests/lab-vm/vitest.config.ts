import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    root: __dirname,
    include: ['protocol/**/*.test.ts'],
    // Several cases stand up a real TLS service and drive real uploads, so the default 5 s is not
    // enough for the archive and concurrency cases.
    testTimeout: 60000
  }
})
