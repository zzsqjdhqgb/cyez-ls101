import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AIRouterSpeechModelPackageManifest } from '../shared'
import {
  isAllowedHelperDigest,
  runtimeAssetBasename,
  runtimeStagingDirectory,
  selectRuntimeAssets
} from '../main/index-tts-runtime'

const CUDA_SHA256 = 'a'.repeat(64)
const CPU_SHA256 = 'b'.repeat(64)
const LIBRARY_SHA256 = 'c'.repeat(64)
const OTHER_LIBRARY_SHA256 = 'd'.repeat(64)

describe('selectRuntimeAssets', () => {
  it('prefers the entry naming both the platform and the backend', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe', sha256: CUDA_SHA256 },
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cpu.exe', sha256: CPU_SHA256 },
      { path: 'runtime/linux-x64/ls101-index-tts-helper-cuda', sha256: CUDA_SHA256 }
    ])

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual([
      {
        assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      }
    ])
    expect(selectRuntimeAssets(manifest, 'index-model', 'cpu', 'win32-x64')).toEqual([
      {
        assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cpu.exe',
        kind: 'runtime-helper',
        sha256: CPU_SHA256
      }
    ])
    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'linux-x64')).toEqual([
      {
        assetPath: 'runtime/linux-x64/ls101-index-tts-helper-cuda',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      }
    ])
  })

  it('falls back to a unique backend entry without the platform key', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe', sha256: CUDA_SHA256 }
    ])

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'linux-x64')).toEqual([
      {
        assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      }
    ])
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

    expect(selectRuntimeAssets(ambiguousPlatform, 'index-model', 'cuda', 'win32-x64')).toBeNull()
    expect(selectRuntimeAssets(ambiguousFallback, 'index-model', 'cuda', 'darwin-arm64')).toBeNull()
    expect(selectRuntimeAssets(noBackendToken, 'index-model', 'cuda', 'win32-x64')).toBeNull()
    expect(
      selectRuntimeAssets(
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

    expect(selectRuntimeAssets(manifest, 'missing-model', 'cuda', 'win32-x64')).toBeNull()
    expect(
      selectRuntimeAssets({ ...manifest, assets: [] }, 'index-model', 'cuda', 'win32-x64')
    ).toBeNull()
    expect(
      selectRuntimeAssets(manifestWithoutArtifacts(), 'index-model', 'cuda', 'win32-x64')
    ).toBeNull()
  })

  it('tolerates backslash paths and case differences', () => {
    const manifest = manifestWith([
      { path: 'runtime\\WIN32-X64\\LS101-Index-TTS-Helper-CUDA.EXE', sha256: CUDA_SHA256 }
    ])

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual([
      {
        assetPath: 'runtime\\WIN32-X64\\LS101-Index-TTS-Helper-CUDA.EXE',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      }
    ])
    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'WIN32-X64')).not.toBeNull()
  })

  it('returns the helper together with the libraries that ship next to it', () => {
    const manifest = manifestWith([
      { path: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe', sha256: CUDA_SHA256 },
      {
        path: 'runtime/win32-x64/cublas64_12.dll',
        sha256: OTHER_LIBRARY_SHA256,
        kind: 'runtime-library'
      },
      {
        path: 'runtime/win32-x64/libaudiocpp.so.0',
        sha256: LIBRARY_SHA256,
        kind: 'runtime-library'
      },
      {
        path: 'runtime/linux-x64/libcublas.so.12',
        sha256: 'e'.repeat(64),
        kind: 'runtime-library'
      },
      { path: 'libcudart.so.12', sha256: 'f'.repeat(64), kind: 'runtime-library' }
    ])

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual([
      {
        assetPath: 'runtime/win32-x64/ls101-index-tts-helper-cuda.exe',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      },
      { assetPath: 'libcudart.so.12', kind: 'runtime-library', sha256: 'f'.repeat(64) },
      {
        assetPath: 'runtime/win32-x64/cublas64_12.dll',
        kind: 'runtime-library',
        sha256: OTHER_LIBRARY_SHA256
      },
      {
        assetPath: 'runtime/win32-x64/libaudiocpp.so.0',
        kind: 'runtime-library',
        sha256: LIBRARY_SHA256
      }
    ])
  })

  it('accepts libraries declared through artifacts and skips another backend', () => {
    const manifest = manifestWith(
      [
        { path: 'runtime/win32-x64/helper-cuda.exe', sha256: CUDA_SHA256 },
        {
          path: 'runtime/win32-x64/cuda/cudart64_12.dll',
          sha256: LIBRARY_SHA256,
          kind: 'runtime-library'
        },
        {
          path: 'runtime/win32-x64/cpu/libcpu.so',
          sha256: OTHER_LIBRARY_SHA256,
          kind: 'runtime-library'
        },
        {
          path: 'runtime/win32-x64/artifact-only.dll',
          sha256: 'e'.repeat(64),
          kind: 'runtime-library'
        }
      ],
      { libraryArtifacts: true }
    )

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'win32-x64')).toEqual([
      {
        assetPath: 'runtime/win32-x64/helper-cuda.exe',
        kind: 'runtime-helper',
        sha256: CUDA_SHA256
      },
      {
        assetPath: 'runtime/win32-x64/artifact-only.dll',
        kind: 'runtime-library',
        sha256: 'e'.repeat(64)
      },
      {
        assetPath: 'runtime/win32-x64/cuda/cudart64_12.dll',
        kind: 'runtime-library',
        sha256: LIBRARY_SHA256
      }
    ])
    expect(selectRuntimeAssets(manifest, 'index-model', 'cpu', 'win32-x64')).toBeNull()
  })

  it('returns null when a selected library has no declared digest', () => {
    const manifest = manifestWith(
      [
        { path: 'runtime/win32-x64/helper-cuda.exe', sha256: CUDA_SHA256 },
        {
          path: 'runtime/win32-x64/libaudiocpp.so.0',
          sha256: LIBRARY_SHA256,
          kind: 'runtime-library'
        }
      ],
      { libraryArtifacts: true }
    )
    const stripped = {
      ...manifest,
      assets: manifest.assets.filter((asset) => asset.kind !== 'runtime-library')
    }

    expect(selectRuntimeAssets(manifest, 'index-model', 'cuda', 'win32-x64')).not.toBeNull()
    expect(selectRuntimeAssets(stripped, 'index-model', 'cuda', 'win32-x64')).toBeNull()
  })
})

describe('runtimeStagingDirectory', () => {
  it('keys the staging directory by platform, package id and package version', () => {
    const first = runtimeStagingDirectory('/runtime', 'win32-x64', 'index-package', '1.0.0')

    expect(first).toBe(path.join('/runtime', 'win32-x64', 'index-package-1.0.0'))
    expect(runtimeStagingDirectory('/runtime', 'win32-x64', 'index-package', '1.0.1')).not.toBe(
      first
    )
    expect(runtimeStagingDirectory('/runtime', 'linux-x64', 'index-package', '1.0.0')).not.toBe(
      first
    )
    expect(runtimeStagingDirectory('/other', 'win32-x64', 'index-package', '1.0.0')).not.toBe(first)
  })

  it('keeps hostile package ids and versions inside the runtime root', () => {
    const directory = runtimeStagingDirectory('/runtime', 'linux-x64', '../evil', '..')
    const relative = path.relative('/runtime', directory)

    expect(directory.startsWith(`${path.join('/runtime', 'linux-x64')}${path.sep}`)).toBe(true)
    expect(path.isAbsolute(relative)).toBe(false)
    expect(relative.startsWith('..')).toBe(false)
  })
})

describe('runtimeAssetBasename', () => {
  it('returns the real basename for both separator styles', () => {
    expect(runtimeAssetBasename('runtime/win32-x64/libaudiocpp.so.0')).toBe('libaudiocpp.so.0')
    expect(runtimeAssetBasename('runtime\\WIN32-X64\\Helper-CUDA.EXE')).toBe('Helper-CUDA.EXE')
    expect(runtimeAssetBasename('  cublas64_12.dll  ')).toBe('cublas64_12.dll')
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

interface TestAsset {
  path: string
  sha256: string
  kind?: 'runtime-helper' | 'runtime-library'
}

function manifestWith(
  assets: TestAsset[],
  options: { libraryArtifacts?: boolean } = {}
): AIRouterSpeechModelPackageManifest {
  const helpers = assets.filter((asset) => (asset.kind ?? 'runtime-helper') === 'runtime-helper')
  const libraries = assets.filter((asset) => asset.kind === 'runtime-library')
  return {
    format: 'ls101.tts-model-package',
    formatVersion: 1,
    package: { id: 'index-package', version: '1.0.0', name: 'IndexTTS 2.5' },
    runtime: { engine: 'index-tts', engineApiVersion: 1 },
    assets: assets.map((asset) => ({
      path: asset.path,
      kind: asset.kind ?? 'runtime-helper',
      size: 4,
      sha256: asset.sha256
    })),
    models: [
      {
        id: 'index-model',
        name: 'IndexTTS 2.5',
        artifacts: {
          'tts-model': ['models/index-tts-2.5.gguf'],
          'runtime-helper': helpers.map((asset) => asset.path),
          ...(options.libraryArtifacts
            ? { 'runtime-library': libraries.map((asset) => asset.path) }
            : {})
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
