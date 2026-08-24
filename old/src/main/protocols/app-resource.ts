/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { protocol, app } from 'electron'
import { join } from 'node:path'
import process from 'node:process'
import { createSimpleProtocolHandler } from './factory'

export function registerAppResourceProtocol(): void {
  const baseDir = app.isPackaged
    ? join(process.resourcesPath, 'media')
    : join(app.getAppPath(), 'resources', 'media')

  protocol.handle('app-resource', createSimpleProtocolHandler(baseDir))
}
