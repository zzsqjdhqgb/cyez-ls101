/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import {
  buildModelCatalog,
  MODEL_CATALOG_SOURCES,
  serializeModelCatalog,
  validateModelCatalog
} from './model-catalog.mjs'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '..', '..')
const CATALOG_PATH = join(
  REPOSITORY_ROOT,
  'packages',
  'airouter',
  'src',
  'main',
  'model-catalog.generated.json'
)
const OVERRIDES_PATH = join(SCRIPT_DIR, 'model-catalog.overrides.json')

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readPreviousCatalog() {
  try {
    return await readJson(CATALOG_PATH)
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

async function check() {
  validateModelCatalog(await readJson(CATALOG_PATH))
  console.log(`[airouter:model-catalog] valid: ${CATALOG_PATH}`)
}

async function update() {
  const response = await fetch(MODEL_CATALOG_SOURCES['models.dev'].url, {
    signal: AbortSignal.timeout(30_000)
  })
  if (!response.ok) throw new Error(`models.dev request failed (HTTP ${response.status})`)
  const [rawCatalog, overrides, previousCatalog] = await Promise.all([
    response.json(),
    readJson(OVERRIDES_PATH),
    readPreviousCatalog()
  ])
  const catalog = buildModelCatalog(rawCatalog, overrides, previousCatalog)
  await writeFile(CATALOG_PATH, serializeModelCatalog(catalog), 'utf8')
  console.log(
    `[airouter:model-catalog] wrote ${Object.keys(catalog.providers).length} providers to ${CATALOG_PATH}`
  )
}

const mode = process.argv[2]
if (mode === '--check') {
  await check()
} else if (mode === undefined || mode === '--update') {
  await update()
} else {
  throw new Error(`unsupported argument: ${mode}`)
}
