import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createTemporaryDirectory } from '../support/temporary-directory'
import { closeStartupReleaseNotes, launchIntegrationApp } from './support/electron-app'

const config = JSON.parse(readFileSync(path.resolve('scripts/index-tts/assets.json'), 'utf8')) as {
  package: { id: string; version: string }
  voices: { id: string }[]
}
const packagePath = path.resolve('dist', `${config.package.id}-${config.package.version}.zip`)

async function createProfile(): Promise<{ userData: string; cleanup: () => Promise<void> }> {
  const userData = await createTemporaryDirectory('index-tts-electron-')
  let modelData: string | undefined
  const cleanup = async (): Promise<void> => {
    await rm(userData, { recursive: true, force: true })
    if (modelData) await rm(modelData, { recursive: true, force: true })
  }
  try {
    // Keep Chromium's symlink-dependent profile on the OS filesystem while
    // permitting multi-gigabyte model imports onto the selected data volume.
    if (process.env.LS101_TEST_INDEX_TTS_DATA_ROOT) {
      const root = path.resolve(process.env.LS101_TEST_INDEX_TTS_DATA_ROOT)
      await mkdir(root, { recursive: true })
      modelData = await realpath(await mkdtemp(path.join(root, 'index-tts-model-data-')))
      await writeFile(
        path.join(modelData, '.ls101-data.json'),
        JSON.stringify({
          formatVersion: 1,
          kind: 'ls101-data-directory',
          directoryId: randomUUID()
        })
      )
      await writeFile(
        path.join(userData, 'data-location.json'),
        JSON.stringify({ formatVersion: 1, state: 'ready', activeDataDirectory: modelData })
      )
    }
    return { userData, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

test('IndexTTS imports and removes the real Q8 model package in the packaged application', async () => {
  test.skip(
    process.env.LS101_TEST_INDEX_TTS_IMPORT !== '1',
    'Requires the generated 3.3 GiB model ZIP and sufficient model storage'
  )
  test.setTimeout(300_000)
  const profile = await createProfile()
  const app = await launchIntegrationApp(profile.userData)
  try {
    const page = await app.firstWindow()
    await closeStartupReleaseNotes(page)
    await app.evaluate(({ dialog }, file) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [file], bookmarks: [] })
      })
    }, packagePath)
    const imported = await page.evaluate(() => window.airouter.importSpeechModelPackage())
    expect(imported?.package.runtime.engine).toBe('index-tts')
    expect(imported?.package.voices.map(({ id }) => id)).toEqual(config.voices.map(({ id }) => id))
    expect(imported?.storedAssetCount).toBeGreaterThan(0)
    expect(
      await page.evaluate(() => window.airouter.listSpeechModelPackages('index-tts'))
    ).toHaveLength(1)
    await page.evaluate(async (metadata) => {
      await window.airouter.deleteSpeechModelPackage(metadata.id, metadata.version)
    }, config.package)
    expect(await page.evaluate(() => window.airouter.listSpeechModelPackages('index-tts'))).toEqual(
      []
    )
  } finally {
    await app.close()
    await profile.cleanup()
  }
})

// Explicit opt-in makes unavailable hardware visible without a fake inference
// substitute. Once opted in, missing runtime/model assets are hard failures.
test('IndexTTS generates A → B → A with the real packaged CUDA helper', async () => {
  test.skip(
    process.env.LS101_TEST_INDEX_TTS_CUDA !== '1',
    'Requires the published/built CUDA runtime and an NVIDIA GPU'
  )
  test.setTimeout(900_000)
  const profile = await createProfile()
  const app = await launchIntegrationApp(profile.userData)
  try {
    const page = await app.firstWindow()
    await closeStartupReleaseNotes(page)
    await app.evaluate(({ dialog }, file) => {
      Object.defineProperty(dialog, 'showOpenDialog', {
        configurable: true,
        value: async () => ({ canceled: false, filePaths: [file], bookmarks: [] })
      })
    }, packagePath)
    const imported = await page.evaluate(() => window.airouter.importSpeechModelPackage())
    expect(imported?.package.runtime.engine).toBe('index-tts')
    const provider = await page.evaluate(
      async (metadata) =>
        window.airouter.saveSpeechProviderConfig({
          name: 'Real IndexTTS CUDA',
          kind: 'local',
          type: 'index-tts',
          backend: 'cuda',
          modelPackageId: metadata.package.id,
          modelPackageVersion: metadata.package.version,
          models: [{ id: metadata.package.id, enabled: true }],
          voices: metadata.voices.map(({ id }) => ({ id, enabled: true }))
        }),
      config
    )
    for (const voice of [config.voices[0], config.voices[1], config.voices[0]]) {
      const audio = await page.evaluate(
        (request) =>
          new Promise<{ format: string; bytes: number; sampleRate?: number }>((resolve, reject) => {
            window.airouter.startSpeechSynthesis(
              {
                text: 'Hello.',
                routing: {
                  default: {
                    providerConfigId: request.provider,
                    modelId: request.model,
                    voiceId: request.voice
                  }
                }
              },
              (event) => {
                if (event.type === 'error') reject(new Error(event.message))
                else
                  resolve({
                    format: event.audio.format,
                    bytes: event.audio.data.byteLength,
                    sampleRate: event.audio.sampleRate
                  })
              }
            )
          }),
        { provider: provider.id, model: config.package.id, voice: voice.id }
      )
      expect(audio).toMatchObject({ format: 'wav', sampleRate: 22050 })
      expect(audio.bytes).toBeGreaterThan(44)
    }
    await page.evaluate(
      async (metadata) => {
        await window.airouter.deleteSpeechProviderConfig(metadata.provider)
        await window.airouter.deleteSpeechModelPackage(metadata.id, metadata.version)
      },
      { provider: provider.id, id: config.package.id, version: config.package.version }
    )
  } finally {
    await app.close()
    await profile.cleanup()
  }
})
