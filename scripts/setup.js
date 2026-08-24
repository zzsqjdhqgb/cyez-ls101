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
  { script: 'airouter/update-model-catalog.mjs', arguments: ['--check'] },
  {
    script: 'qwen-tts/download-release-assets.mjs',
    assetVerification: true,
    productDocsEnvironment: { LS101_QWEN_TTS_RUNTIME_ONLY: '1' }
  },
  { script: 'download-tts-assets.js', assetVerification: true, modelDownload: true },
  { script: 'download-stt-models.js', assetVerification: true, modelDownload: true },
  { script: 'download-pronunciation-model.js', assetVerification: true, modelDownload: true },
  { script: 'generate-icons.js' }
]

function parseOptions(argv) {
  const allowed = new Set(['--verify', '--verify-upstream'])
  const unknown = argv.filter((argument) => !allowed.has(argument))
  if (unknown.length > 0) throw new Error(`未知 setup 参数：${unknown.join(', ')}`)
  return argv
}

function setupTasks(mode = process.env.LS101_SETUP_MODE, verificationArguments = []) {
  if (mode !== undefined && mode !== '' && mode !== PRODUCT_DOCS_MODE) {
    throw new Error(`不支持的 LS101_SETUP_MODE：${mode}`)
  }
  const verifiedArguments = parseOptions(verificationArguments)
  return tasks
    .filter((task) => mode !== PRODUCT_DOCS_MODE || !task.modelDownload)
    .map((task) => ({
      script: task.script,
      arguments: [...(task.arguments ?? []), ...(task.assetVerification ? verifiedArguments : [])],
      environment: mode === PRODUCT_DOCS_MODE ? (task.productDocsEnvironment ?? {}) : {}
    }))
}

function main() {
  const mode = process.env.LS101_SETUP_MODE
  const verificationArguments = parseOptions(process.argv.slice(2))
  if (mode === PRODUCT_DOCS_MODE) {
    console.log('[setup] product-docs mode: skip model downloads, keep required runtime assets')
  }
  for (const task of setupTasks(mode, verificationArguments)) {
    execFileSync(process.execPath, [join(SCRIPTS_DIR, task.script), ...task.arguments], {
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

module.exports = { PRODUCT_DOCS_MODE, parseOptions, setupTasks }
