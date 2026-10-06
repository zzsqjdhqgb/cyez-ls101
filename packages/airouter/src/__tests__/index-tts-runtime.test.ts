import { describe, expect, it } from 'vitest'
import type { AIRouterSpeechModelPackageManifest } from '../shared'
import { isAllowedHelperDigest, selectHelperAsset } from '../main/index-tts-runtime'

const CUDA_SHA256 = 'a'.repeat(64)
const CPU_SHA256 = 'b'.repeat(64)

describe('selectHelperAsset', () => {
  it('prefers the entry naming both the platform and the backend', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe', sha256: CUDA_SHA256 },
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cpu.exe', sha256: CPU_SHA256 },
      { path: 'runtime/linux-x64/ls101-index-tts-helper-cuda', sha256: CUDA_SHA256 }
    ])

    expect(selectHelperAsset(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual({
      assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe',
      sha256: CUDA_SHA256
    })
    expect(selectHelperAsset(manifest, 'index-model', 'cpu', 'win32-x64')).toEqual({
      assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cpu.exe',
      sha256: CPU_SHA256
    })
    expect(selectHelperAsset(manifest, 'index-model', 'cuda', 'linux-x64')).toEqual({
      assetPath: 'runtime/linux-x64/ls101-index-tts-helper-cuda',
      sha256: CUDA_SHA256
    })
  })

  it('falls back to a unique backend entry without the platform key', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe', sha256: CUDA_SHA256 }
    ])

    expect(selectHelperAsset(manifest, 'index-model', 'cuda', 'linux-x64')).toEqual({
      assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe',
      sha256: CUDA_SHA256
    })
  })

  it('returns null when the backend entry is ambiguous or missing', () => {
    const ambiguousPlatform = manifestWith([
      { path: 'runtime/win32-x64/helper-cuda-a.exe', sha256: CUDA_SHA256 },
      { path: 'runtime/win32-x64/helper-cuda-b.exe', sha256: CUDA_SHA256 }
    ])
    const ambiguousFallback = manifestWith([
      { path: 'runtime/linux-x64/helper-cuda', sha256: CUDA_SHA256 },
      { path: 'runtime/win32-x64/helper-cuda', sha256: CUDA_SHA256 }
    ])
    const noBackendToken = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper.exe', sha256: CUDA_SHA256 }
    ])

    expect(selectHelperAsset(ambiguousPlatform, 'index-model', 'cuda', 'win32-x64')).toBeNull()
    expect(selectHelperAsset(ambiguousFallback, 'index-model', 'cuda', 'darwin-arm64')).toBeNull()
    expect(selectHelperAsset(noBackendToken, 'index-model', 'cuda', 'win32-x64')).toBeNull()
    expect(
      selectHelperAsset(
        manifestWith([{ path: 'runtime/win32-x64/helper-cpu.exe', sha256: CPU_SHA256 }]),
        'index-model',
        'cuda',
        'win32-x64'
      )
    ).toBeNull()
  })

  it('returns null for unknown models or undeclared assets', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/helper-cuda.exe', sha256: CUDA_SHA256 }
    ])

    expect(selectHelperAsset(manifest, 'missing-model', 'cuda', 'win32-x64')).toBeNull()
    expect(
      selectHelperAsset({ ...manifest, assets: [] }, 'index-model', 'cuda', 'win32-x64')
    ).toBeNull()
    expect(
      selectHelperAsset(manifestWithoutArtifacts(), 'index-model', 'cuda', 'win32-x64')
    ).toBeNull()
  })

  it('tolerates backslash paths and case differences', () => {
    const manifest = manifestWith([
      { path: 'runtime\\WIN32-X64\\LS101-Index-TTS-Helper-CUDA.EXE', sha256: CUDA_SHA256 }
    ])

    expect(selectHelperAsset(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual({
      assetPath: 'runtime\\WIN32-X64\\LS101-Index-TTS-Helper-CUDA.EXE',
      sha256: CUDA_SHA256
    })
    expect(selectHelperAsset(manifest, 'index-model', 'cuda', 'WIN32-X64')).not.toBeNull()
  })
})

describe('isAllowedHelperDigest', () => {
  it('fails closed for an empty allowlist', () => {
    expect(isAllowedHelperDigest('linux-x64', CUDA_SHA256, {})).toBe(false)
    expect(isAllowedHelperDigest('linux-x64', CUDA_SHA256, { 'linux-x64': [] })).toBe(false)
    expect(isAllowedHelperDigest('linux-x64', CUDA_SHA256)).toBe(false)
  })

  it('fails closed for an unknown platform key', () => {
    expect(isAllowedHelperDigest('darwin-arm64', CUDA_SHA256, { 'linux-x64': [CUDA_SHA256] })).toBe(
      false
    )
  })

  it('matches hex digests case-insensitively', () => {
    expect(
      isAllowedHelperDigest('win32-x64', CUDA_SHA256, { 'win32-x64': [CUDA_SHA256.toUpperCase()] })
    ).toBe(true)
    expect(
      isAllowedHelperDigest('win32-x64', CUDA_SHA256.toUpperCase(), {
        'win32-x64': [CUDA_SHA256]
      })
    ).toBe(true)
    expect(isAllowedHelperDigest('win32-x64', CPU_SHA256, { 'win32-x64': [CUDA_SHA256] })).toBe(
      false
    )
  })
})

function manifestWith(
  assets: Array<{ path: string; sha256: string }>
): AIRouterSpeechModelPackageManifest {
  return {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'index-package', version: '1.0.0', name: 'IndexTTS 2.5' },
    runtime: { engine: 'index-tts', engineApiVersion: 1 },
    assets: assets.map((asset) => ({
      path: asset.path,
      kind: 'runtime-helper',
      size: 4,
      sha256: asset.sha256
    })),
    models: [
      {
        id: 'index-model',
        name: 'IndexTTS 2.5',
        artifacts: {
          'tts-model': ['models/index-tts-2.5.gguf'],
          'runtime-helper': assets.map((asset) => asset.path)
        },
        parameters: {}
      }
    ],
    voices: []
  }
}

function manifestWithoutArtifacts(): AIRouterSpeechModelPackageManifest {
  const manifest = manifestWith([])
  return {
    ...manifest,
    models: manifest.models.map((model) => ({
      ...model,
      artifacts: { 'tts-model': ['models/index-tts-2.5.gguf'] }
    }))
  }
}
