/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

const LICENSE_FILE = 'license.json'

const HARDCODED_SALT1 = 'CYEZ_LS101_SALT_ALPHA_v1'
const HARDCODED_SALT2 = 'CYEZ_LS101_SALT_BETA_v2'
const HARDCODED_EXPECTED = '578bbd51ee3da388fae8d5ed1c1425d38b3bd79cbff813b775dcf676be4d3b7b'

const EXPIRATION_DATE = new Date('2026-07-01T00:00:00+08:00')
// const EXPIRATION_DATE = new Date('2025-07-01T00:00:00+08:00')

interface StoredLicense {
  salt: string
  hash: string
}

function getLicensePath(): string {
  return join(app.getPath('userData'), LICENSE_FILE)
}

export function isExpired(): boolean {
  return new Date() >= EXPIRATION_DATE
}

export function getExpirationMessage(): string {
  return '软件试用期已于 2026年7月1日 到期。如需继续使用，请联系开发者获取新版本。'
}

function computeDoubleSaltedHash(code: string): string {
  const first = createHash('sha256')
    .update(code + HARDCODED_SALT1)
    .digest('hex')
  return createHash('sha256')
    .update(first + HARDCODED_SALT2)
    .digest('hex')
}

export function validateInvitationCode(code: string): boolean {
  const hash = computeDoubleSaltedHash(code)
  return hash === HARDCODED_EXPECTED
}

export function saveLicense(code: string): void {
  const salt = randomBytes(32).toString('hex')
  const hash = createHash('sha256')
    .update(code + salt)
    .digest('hex')
  const data: StoredLicense = { salt, hash }
  writeFileSync(getLicensePath(), JSON.stringify(data), 'utf-8')
}

export function hasStoredLicense(): boolean {
  return existsSync(getLicensePath())
}

export function verifyStoredLicense(code: string): boolean {
  try {
    const raw = readFileSync(getLicensePath(), 'utf-8')
    const data: StoredLicense = JSON.parse(raw)
    if (!data.salt || !data.hash) return false
    const computed = createHash('sha256')
      .update(code + data.salt)
      .digest('hex')
    return computed === data.hash
  } catch {
    return false
  }
}

export function clearLicense(): void {
  try {
    unlinkSync(getLicensePath())
  } catch {
    // ignore
  }
}
