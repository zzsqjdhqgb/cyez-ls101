/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { createRequire } from 'node:module'

interface SourceMapSupport {
  install(options: { handleUncaughtExceptions: boolean }): void
}

const require = createRequire(import.meta.url)

export function installSourceMapSupport(): void {
  // Node's built-in external source-map loader cannot read maps from an ASAR archive.
  const sourceMapSupport = require('source-map-support') as SourceMapSupport
  sourceMapSupport.install({ handleUncaughtExceptions: false })
}
