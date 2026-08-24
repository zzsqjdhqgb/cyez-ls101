/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { protocol } from 'electron'
import { join } from 'node:path'
import { getGradingPath } from '../utils'
import { createResourceProtocolHandler } from './factory'

export function registerGradingResourceProtocol(): void {
  protocol.handle(
    'grading-resource',
    createResourceProtocolHandler((rid) => join(getGradingPath(), rid))
  )
}
