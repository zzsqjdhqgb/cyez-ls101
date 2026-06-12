/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { app, shell, session } from 'electron'
import { writeFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_CLEAR_FLAG = '.clear-cache-pending'

export function isDev(): boolean {
  return !app.isPackaged
}

export function getCacheClearFlagPath(): string {
  return join(getUserDataPath(), CACHE_CLEAR_FLAG)
}

export function getUserDataPath(): string {
  return app.getPath('userData')
}

export function clearSessionData(): void {
  try {
    session.defaultSession.clearCache()
    session.defaultSession.clearStorageData({
      storages: [
        'cookies',
        'filesystem',
        'indexdb',
        'localstorage',
        'shadercache',
        'websql',
        'serviceworkers',
        'cachestorage'
      ]
    })
  } catch {
    // ignore session clear errors
  }
}

export function deepRemove(path: string): string[] {
  const failed: string[] = []

  function walk(currentPath: string): void {
    try {
      rmSync(currentPath, { recursive: true, force: true })
      return
    } catch {
      // fast path failed, fall through to manual recursion
    }

    let entries: string[]
    try {
      entries = readdirSync(currentPath)
    } catch {
      failed.push(currentPath)
      return
    }

    for (const entry of entries) {
      const full = join(currentPath, entry)
      let isDir = false
      try {
        isDir = statSync(full).isDirectory()
      } catch {
        try {
          rmSync(full, { force: true })
        } catch {
          failed.push(full)
        }
        continue
      }

      if (isDir) {
        walk(full)
      } else {
        try {
          rmSync(full, { force: true })
        } catch {
          failed.push(full)
        }
      }
    }

    try {
      rmSync(currentPath, { recursive: true, force: true })
    } catch {
      // parent dir itself may remain, but individual files are tracked above
    }
  }

  walk(path)
  return failed
}

export function writeClearFlag(): void {
  writeFileSync(getCacheClearFlagPath(), 'true')
}

export function openDataFolder(): void {
  shell.openPath(getUserDataPath())
}

export function writeFlagAndExit(): void {
  writeClearFlag()
  app.exit(0)
}

export function triggerHardReset(): void {
  writeClearFlag()
  app.relaunch()
  app.exit(0)
}
