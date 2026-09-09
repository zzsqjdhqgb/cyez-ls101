import { build } from 'vite'
import { resolve } from 'node:path'

await build({
  configFile: false,
  ssr: { noExternal: true },
  build: {
    ssr: resolve('tests/lab/teacher-local-entry.ts'),
    outDir: resolve('out/lab-tests'),
    target: 'node22',
    rollupOptions: {
      external: ['electron', /^node:/],
      output: { format: 'cjs', entryFileNames: 'teacher-local.cjs', inlineDynamicImports: true }
    }
  }
})
