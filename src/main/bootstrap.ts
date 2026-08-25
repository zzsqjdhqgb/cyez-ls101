/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { installSourceMapSupport } from './source-map-support'

installSourceMapSupport()

void import('./index').catch((error: unknown) => {
  console.error('Failed to load main process', error)
  process.exit(1)
})
