const assert = require('node:assert/strict')
const test = require('node:test')
const { setupTasks } = require('../setup.js')

test('product documentation setup keeps runtime assets and skips full models', () => {
  assert.deepEqual(setupTasks('product-docs'), [
    {
      script: 'qwen-tts/download-release-assets.mjs',
      environment: { LS101_QWEN_TTS_RUNTIME_ONLY: '1' }
    },
    { script: 'generate-icons.js', environment: {} }
  ])
})

test('default setup retains all installation tasks', () => {
  assert.deepEqual(
    setupTasks('').map((task) => task.script),
    [
      'qwen-tts/download-release-assets.mjs',
      'download-tts-assets.js',
      'download-stt-models.js',
      'download-pronunciation-model.js',
      'generate-icons.js'
    ]
  )
})

test('setup rejects unknown modes', () => {
  assert.throws(() => setupTasks('fast'), /不支持的 LS101_SETUP_MODE/)
})
