import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('tests/components'),
  plugins: [react()],
  resolve: {
    alias: {
      '@renderer': resolve('packages/renderer/src')
    }
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  }
})
