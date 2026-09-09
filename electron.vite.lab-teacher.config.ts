import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import metadata from './package.json'
import { labBundleAudit } from './scripts/lab/bundle-audit'
export default defineConfig({
  main: {
    plugins: [labBundleAudit('teacher')],
    define: { __LAB_VERSION__: JSON.stringify(metadata.version) },
    build: {
      externalizeDeps: false,
      outDir: 'out/lab-teacher/main',
      rollupOptions: { input: resolve('apps/lab-teacher/main/index.ts'), external: ['electron'] }
    }
  },
  preload: {
    plugins: [labBundleAudit('teacher')],
    build: {
      externalizeDeps: false,
      outDir: 'out/lab-teacher/preload',
      rollupOptions: { input: resolve('apps/lab-teacher/preload/index.ts'), external: ['electron'] }
    }
  },
  renderer: {
    root: resolve('apps/lab-teacher/renderer'),
    plugins: [react(), labBundleAudit('teacher')],
    build: {
      outDir: resolve('out/lab-teacher/renderer'),
      rollupOptions: { input: resolve('apps/lab-teacher/renderer/index.html') }
    }
  }
})
