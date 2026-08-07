/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['sherpa-onnx-node', 'ffmpeg-static'],
        input: {
          index: resolve('src/main/index.ts'),
          'pocket-tts-worker': resolve('packages/airouter/src/main/pocket-tts-worker.ts')
        }
      }
    }
  },
  preload: {},
  renderer: {
    root: resolve('packages/renderer'),
    build: {
      rollupOptions: {
        input: resolve('packages/renderer/index.html')
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve('packages/renderer/src')
      }
    },
    plugins: [react()]
  }
})
