/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require('node:child_process')
const { join } = require('node:path')

const SCRIPTS_DIR = __dirname

const tasks = [
  { script: 'download-tts-assets.js' },
  { script: 'download-stt-models.js' },
  { script: 'generate-icons.js' }
]

for (const task of tasks) {
  execSync(`node "${join(SCRIPTS_DIR, task.script)}"`, { stdio: 'inherit' })
}
