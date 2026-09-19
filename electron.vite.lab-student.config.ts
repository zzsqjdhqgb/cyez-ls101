import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import metadata from './package.json'
import { labBundleAudit } from './scripts/lab/bundle-audit'

export default defineConfig({
  main: {
    plugins: [labBundleAudit('student')],
    define: { __LAB_VERSION__: JSON.stringify(metadata.version) },
    build: {
      externalizeDeps: false,
      outDir: 'out/lab-student/main',
      rollupOptions: { input: resolve('apps/lab-student/main/index.ts'), external: ['electron'] }
    }
  },
  preload: {
    plugins: [labBundleAudit('student')],
    build: {
      externalizeDeps: false,
      outDir: 'out/lab-student/preload',
      rollupOptions: { input: resolve('apps/lab-student/preload/index.ts'), external: ['electron'] }
    }
  },
  renderer: {
    root: resolve('apps/lab-student/renderer'),
    plugins: [react(), labBundleAudit('student')],
    build: {
      outDir: resolve('out/lab-student/renderer'),
      rollupOptions: { input: resolve('apps/lab-student/renderer/index.html') }
    }
  }
})
