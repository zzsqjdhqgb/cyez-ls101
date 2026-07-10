/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getTemplatesPath } from '../utils'
import { importBundledTemplates } from './initialize'

/**
 * Compare two semver version strings, ignoring pre-release suffixes.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const semver = v.split('-')[0]
    return semver.split('.').map(Number)
  }
  const va = parse(a)
  const vb = parse(b)
  for (let i = 0; i < Math.max(va.length, vb.length); i++) {
    const na = va[i] || 0
    const nb = vb[i] || 0
    if (na < nb) return -1
    if (na > nb) return 1
  }
  return 0
}

function clearTemplates(): void {
  const templatesPath = getTemplatesPath()
  const entries = readdirSync(templatesPath, { withFileTypes: true }).filter((e) => e.isDirectory())
  console.log(`[migrate] 清空 ${entries.length} 个试卷模板`)
  for (const entry of entries) {
    rmSync(join(templatesPath, entry.name), { recursive: true, force: true })
  }
}

async function migrateTo030(): Promise<void> {
  console.log('[migrate] 开始迁移至 v0.3.0')
  clearTemplates()
  await importBundledTemplates()
  console.log(`[migrate] 迁移至 v0.3.0+ 完成`)
}

export async function runMigrations(previousVersion: string): Promise<void> {
  if (compareVersions(previousVersion, '0.3.0') < 0) {
    await migrateTo030()
  } else {
    console.log(`[migrate] previous version ${previousVersion} >= 0.3.0, 无需迁移`)
  }
}
