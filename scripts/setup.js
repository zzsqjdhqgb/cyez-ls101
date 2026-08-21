/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

const SCRIPTS_DIR = __dirname
const PRODUCT_DOCS_MODE = 'product-docs'

const tasks = [
  {
    script: 'qwen-tts/download-release-assets.mjs',
    productDocsEnvironment: { LS101_QWEN_TTS_RUNTIME_ONLY: '1' }
  },
  { script: 'download-tts-assets.js', modelDownload: true },
  { script: 'download-stt-models.js', modelDownload: true },
  { script: 'download-pronunciation-model.js', modelDownload: true },
  { script: 'generate-icons.js' }
]

function setupTasks(mode = process.env.LS101_SETUP_MODE) {
  if (mode !== undefined && mode !== '' && mode !== PRODUCT_DOCS_MODE) {
    throw new Error(`不支持的 LS101_SETUP_MODE：${mode}`)
  }
  return tasks
    .filter((task) => mode !== PRODUCT_DOCS_MODE || !task.modelDownload)
    .map((task) => ({
      script: task.script,
      environment: mode === PRODUCT_DOCS_MODE ? (task.productDocsEnvironment ?? {}) : {}
    }))
}

function main() {
  const mode = process.env.LS101_SETUP_MODE
  if (mode === PRODUCT_DOCS_MODE) {
    console.log('[setup] product-docs mode: skip model downloads, keep required runtime assets')
  }
  for (const task of setupTasks(mode)) {
    execFileSync(process.execPath, [join(SCRIPTS_DIR, task.script)], {
      env: { ...process.env, ...task.environment },
      stdio: 'inherit'
    })
  }
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error)
    process.exit(1)
  }
}

module.exports = { PRODUCT_DOCS_MODE, setupTasks }
