/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { getUserDataPath } from '../services/dev-service'

const UPDATE_NOTIFICATION_FLAG = '.update-notification'
const RESET_REQUIRED_FLAG = '.reset-data-required'

export function getVersionFilePath(): string {
  return join(getUserDataPath(), 'version')
}

export function getUpdateNotificationFlagPath(): string {
  return join(getUserDataPath(), UPDATE_NOTIFICATION_FLAG)
}

export function getCurrentVersion(): string {
  return app.getVersion()
}

export function getStoredVersion(): string | null {
  try {
    const p = getVersionFilePath()
    if (!existsSync(p)) return null
    return readFileSync(p, 'utf-8').trim()
  } catch {
    return null
  }
}

export function writeVersionFile(version: string): void {
  writeFileSync(getVersionFilePath(), version)
}

export function writeUpdateNotificationFlag(previousVersion: string): void {
  writeFileSync(getUpdateNotificationFlagPath(), `${previousVersion}\n${getCurrentVersion()}`)
}

export function checkAndClearUpdateNotificationFlag(): {
  previousVersion: string
  currentVersion: string
} | null {
  const p = getUpdateNotificationFlagPath()
  try {
    if (!existsSync(p)) return null
    const lines = readFileSync(p, 'utf-8').trim().split('\n')
    unlinkSync(p)
    if (lines.length >= 2) {
      return { previousVersion: lines[0], currentVersion: lines[1] }
    }
    return null
  } catch {
    return null
  }
}

export function getResetRequiredFlagPath(): string {
  return join(getUserDataPath(), RESET_REQUIRED_FLAG)
}

export function writeResetRequiredFlag(): void {
  writeFileSync(getResetRequiredFlagPath(), 'true')
}

export function checkAndClearResetRequiredFlag(): boolean {
  const p = getResetRequiredFlagPath()
  try {
    if (!existsSync(p)) return false
    unlinkSync(p)
    return true
  } catch {
    return false
  }
}
