const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const overrides = JSON.parse(
  readFileSync(join(__dirname, '..', 'airouter', 'model-catalog.overrides.json'), 'utf8')
)

function fixtureCatalog() {
  return {
    zebra: {
      models: {
        'model-b': {
          name: 'Model B',
          attachment: true,
          reasoning: true,
          reasoning_options: [{ type: 'effort', values: ['low', 'high', 'unsupported'] }],
          structured_output: false,
          limit: { context: 128000, output: 16384 },
          description: 'not used by AIRouter'
        }
      }
    },
    alpha: {
      models: {
        'model-a': { name: 'Model A', limit: { context: 0, output: 4096 } }
      }
    }
  }
}

test('normalizes supported fields and sorts provider ids', async () => {
  const { normalizeModelsDevCatalog } = await import('../airouter/model-catalog.mjs')
  const providers = normalizeModelsDevCatalog(fixtureCatalog())

  assert.deepEqual(Object.keys(providers), ['alpha', 'zebra'])
  assert.deepEqual(providers.alpha.models['model-a'], {
    source: 'models.dev',
    name: 'Model A',
    outputLimit: 4096
  })
  assert.deepEqual(providers.zebra.models['model-b'], {
    source: 'models.dev',
    name: 'Model B',
    contextLimit: 128000,
    outputLimit: 16384,
    reasoning: true,
    reasoningOptions: [{ type: 'effort', values: ['low', 'high'] }],
    structuredOutput: false,
    attachment: true
  })
})

test('rejects empty and malformed upstream catalogs', async () => {
  const { normalizeModelsDevCatalog } = await import('../airouter/model-catalog.mjs')

  assert.throws(() => normalizeModelsDevCatalog({}), /non-empty object/)
  assert.throws(() => normalizeModelsDevCatalog({ broken: {} }), /has no model map/)
  assert.throws(
    () => normalizeModelsDevCatalog({ broken: { models: { invalid: null } } }),
    /is invalid/
  )
})

test('keeps generation deterministic when normalized content is unchanged', async () => {
  const { buildModelCatalog, serializeModelCatalog } = await import('../airouter/model-catalog.mjs')
  const first = buildModelCatalog(fixtureCatalog(), { providers: {} }, undefined, new Date(0))
  const second = buildModelCatalog(
    fixtureCatalog(),
    { providers: {} },
    first,
    new Date('2030-01-01T00:00:00.000Z')
  )

  assert.equal(second.generatedAt, '1970-01-01T00:00:00.000Z')
  assert.equal(serializeModelCatalog(second), serializeModelCatalog(first))
})

test('adds Agnes Flash metadata from official documentation overrides', async () => {
  const { buildModelCatalog } = await import('../airouter/model-catalog.mjs')
  const catalog = buildModelCatalog(fixtureCatalog(), overrides, undefined, new Date(0))

  assert.deepEqual(catalog.providers['agnes-ai'].models['agnes-2.5-flash'], {
    name: 'Agnes 2.5 Flash',
    contextLimit: 524288,
    outputLimit: 65536,
    reasoning: true,
    attachment: true,
    source: 'agnes-ai'
  })
  assert.equal(catalog.providers['agnes-ai'].models['agnes-2.0-flash'].source, 'agnes-ai')
})

test('validates the committed generated catalog offline', async () => {
  const { validateModelCatalog } = await import('../airouter/model-catalog.mjs')
  const catalog = JSON.parse(
    readFileSync(
      join(
        __dirname,
        '..',
        '..',
        'packages',
        'airouter',
        'src',
        'main',
        'model-catalog.generated.json'
      ),
      'utf8'
    )
  )

  assert.doesNotThrow(() => validateModelCatalog(catalog))
})
