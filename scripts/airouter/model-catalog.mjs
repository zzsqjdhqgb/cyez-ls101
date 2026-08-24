/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

/* eslint-disable @typescript-eslint/explicit-function-return-type */

const SCHEMA_VERSION = 1
const MODEL_FIELDS = [
  'name',
  'contextLimit',
  'outputLimit',
  'reasoning',
  'reasoningOptions',
  'structuredOutput',
  'attachment',
  'source'
]
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])

export const MODEL_CATALOG_SOURCES = {
  'agnes-ai': {
    url: 'https://wiki.agnes-ai.com/llms.txt'
  },
  'models.dev': {
    url: 'https://models.dev/api.json',
    license: 'MIT',
    licenseUrl: 'https://github.com/anomalyco/models.dev/blob/dev/LICENSE'
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sortedEntries(value) {
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
}

function normalizeReasoningOptions(value) {
  if (!Array.isArray(value)) return undefined
  const options = []
  for (const item of value) {
    if (!isRecord(item)) continue
    if (item.type === 'toggle') {
      options.push({ type: 'toggle' })
    } else if (item.type === 'effort' && Array.isArray(item.values)) {
      const values = item.values.filter((entry) => REASONING_EFFORTS.has(entry))
      if (values.length) options.push({ type: 'effort', values })
    } else if (item.type === 'budget_tokens') {
      const option = { type: 'budget_tokens' }
      if (Number.isSafeInteger(item.min) && item.min >= 0) option.min = item.min
      if (Number.isSafeInteger(item.max) && item.max >= 0) option.max = item.max
      options.push(option)
    }
  }
  return options.length ? options : undefined
}

function normalizeModelsDevModel(model) {
  const normalized = { source: 'models.dev' }
  if (typeof model.name === 'string' && model.name) normalized.name = model.name
  if (Number.isSafeInteger(model.limit?.context) && model.limit.context > 0) {
    normalized.contextLimit = model.limit.context
  }
  if (Number.isSafeInteger(model.limit?.output) && model.limit.output > 0) {
    normalized.outputLimit = model.limit.output
  }
  if (typeof model.reasoning === 'boolean') normalized.reasoning = model.reasoning
  const reasoningOptions = normalizeReasoningOptions(model.reasoning_options)
  if (reasoningOptions) normalized.reasoningOptions = reasoningOptions
  if (typeof model.structured_output === 'boolean') {
    normalized.structuredOutput = model.structured_output
  }
  if (typeof model.attachment === 'boolean') normalized.attachment = model.attachment
  return normalized
}

export function normalizeModelsDevCatalog(input) {
  if (!isRecord(input) || Object.keys(input).length === 0) {
    throw new Error('models.dev catalog must be a non-empty object')
  }
  const providers = {}
  for (const [providerId, provider] of sortedEntries(input)) {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      throw new Error(`models.dev provider ${providerId} has no model map`)
    }
    const models = {}
    for (const [modelId, model] of sortedEntries(provider.models)) {
      if (!isRecord(model)) throw new Error(`models.dev model ${providerId}/${modelId} is invalid`)
      models[modelId] = normalizeModelsDevModel(model)
    }
    providers[providerId] = { models }
  }
  return providers
}

export function mergeCatalogOverrides(providers, overrides) {
  if (!isRecord(overrides) || !isRecord(overrides.providers)) {
    throw new Error('model catalog overrides must contain a providers object')
  }
  const merged = structuredClone(providers)
  for (const [providerId, provider] of sortedEntries(overrides.providers)) {
    if (!isRecord(provider) || !isRecord(provider.models)) {
      throw new Error(`override provider ${providerId} has no model map`)
    }
    merged[providerId] ??= { models: {} }
    for (const [modelId, model] of sortedEntries(provider.models)) {
      if (!isRecord(model)) throw new Error(`override model ${providerId}/${modelId} is invalid`)
      merged[providerId].models[modelId] = { ...merged[providerId].models[modelId], ...model }
    }
  }
  return Object.fromEntries(
    sortedEntries(merged).map(([providerId, provider]) => [
      providerId,
      { models: Object.fromEntries(sortedEntries(provider.models)) }
    ])
  )
}

function contentWithoutGeneratedAt(catalog) {
  const content = { ...catalog }
  delete content.generatedAt
  return content
}

export function buildModelCatalog(rawCatalog, overrides, previousCatalog, now = new Date()) {
  const candidate = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    sources: MODEL_CATALOG_SOURCES,
    providers: mergeCatalogOverrides(normalizeModelsDevCatalog(rawCatalog), overrides)
  }
  validateModelCatalog(candidate)
  if (
    previousCatalog &&
    JSON.stringify(contentWithoutGeneratedAt(previousCatalog)) ===
      JSON.stringify(contentWithoutGeneratedAt(candidate))
  ) {
    return { ...candidate, generatedAt: previousCatalog.generatedAt }
  }
  return candidate
}

function assertPositiveInteger(value, location) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${location} must be positive`)
}

function assertNonNegativeInteger(value, location) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${location} must be non-negative`)
}

function validateReasoningOptions(value, location) {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${location} must be non-empty`)
  for (const option of value) {
    if (!isRecord(option)) throw new Error(`${location} contains an invalid option`)
    if (option.type === 'toggle') continue
    if (option.type === 'effort') {
      if (
        !Array.isArray(option.values) ||
        option.values.length === 0 ||
        option.values.some((effort) => !REASONING_EFFORTS.has(effort))
      ) {
        throw new Error(`${location} contains invalid effort values`)
      }
      continue
    }
    if (option.type === 'budget_tokens') {
      if (option.min !== undefined) assertNonNegativeInteger(option.min, `${location}.min`)
      if (option.max !== undefined) assertNonNegativeInteger(option.max, `${location}.max`)
      continue
    }
    throw new Error(`${location} contains an unsupported option`)
  }
}

export function validateModelCatalog(catalog) {
  if (!isRecord(catalog)) throw new Error('model catalog must be an object')
  if (catalog.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported model catalog schema version: ${catalog.schemaVersion}`)
  }
  if (
    typeof catalog.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(catalog.generatedAt))
  ) {
    throw new Error('model catalog generatedAt must be an ISO timestamp')
  }
  if (!isRecord(catalog.sources)) throw new Error('model catalog sources must be an object')
  for (const [sourceId, expected] of Object.entries(MODEL_CATALOG_SOURCES)) {
    if (JSON.stringify(catalog.sources[sourceId]) !== JSON.stringify(expected)) {
      throw new Error(`model catalog source ${sourceId} is missing or invalid`)
    }
  }
  if (!isRecord(catalog.providers) || Object.keys(catalog.providers).length === 0) {
    throw new Error('model catalog providers must be non-empty')
  }
  for (const [providerId, provider] of Object.entries(catalog.providers)) {
    if (!providerId || !isRecord(provider) || !isRecord(provider.models)) {
      throw new Error(`model catalog provider ${providerId} is invalid`)
    }
    for (const [modelId, model] of Object.entries(provider.models)) {
      const location = `${providerId}/${modelId}`
      if (!modelId || !isRecord(model))
        throw new Error(`model catalog model ${location} is invalid`)
      const unknownFields = Object.keys(model).filter((field) => !MODEL_FIELDS.includes(field))
      if (unknownFields.length) throw new Error(`${location} has unknown field ${unknownFields[0]}`)
      if (model.name !== undefined && (typeof model.name !== 'string' || !model.name)) {
        throw new Error(`${location}.name must be a non-empty string`)
      }
      if (model.contextLimit !== undefined)
        assertPositiveInteger(model.contextLimit, `${location}.contextLimit`)
      if (model.outputLimit !== undefined)
        assertPositiveInteger(model.outputLimit, `${location}.outputLimit`)
      for (const field of ['reasoning', 'structuredOutput', 'attachment']) {
        if (model[field] !== undefined && typeof model[field] !== 'boolean') {
          throw new Error(`${location}.${field} must be boolean`)
        }
      }
      if (model.reasoningOptions !== undefined) {
        validateReasoningOptions(model.reasoningOptions, `${location}.reasoningOptions`)
      }
      if (typeof model.source !== 'string' || !catalog.sources[model.source]) {
        throw new Error(`${location}.source is missing or unknown`)
      }
    }
  }
  return catalog
}

export function serializeModelCatalog(catalog) {
  validateModelCatalog(catalog)
  return `${JSON.stringify(catalog, null, 2)}\n`
}
