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
      minify: 'esbuild',
      sourcemap: true,
      rollupOptions: {
        external: ['onnxruntime-node', 'sherpa-onnx-node', 'ffmpeg-static'],
        input: {
          index: resolve('src/main/bootstrap.ts'),
          application: resolve('src/main/index.ts'),
          'pocket-tts-worker': resolve('packages/airouter/src/main/pocket-tts-worker.ts'),
          'pronunciation-assessment-worker': resolve(
            'packages/airouter/src/main/pronunciation-assessment-worker.ts'
          ),
          'qwen3-asr-worker': resolve('packages/airouter/src/main/qwen3-asr-worker.ts'),
          'legacy-data-worker': resolve('src/main/legacy-data-worker.ts')
        },
        output: {
          sourcemapExcludeSources: true
        }
      }
    }
  },
  preload: {
    build: {
      minify: 'esbuild'
    }
  },
  renderer: {
    root: resolve('packages/renderer'),
    build: {
      minify: 'esbuild',
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
