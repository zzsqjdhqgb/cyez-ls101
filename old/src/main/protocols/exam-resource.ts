/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { protocol } from 'electron'
import { join } from 'node:path'
import { getExamsPath } from '../utils'
import { createResourceProtocolHandler } from './factory'

export function registerExamResourceProtocol(): void {
  protocol.handle(
    'exam-resource',
    createResourceProtocolHandler((examId) => join(getExamsPath(), examId))
  )
}
