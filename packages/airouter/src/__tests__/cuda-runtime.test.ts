import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CudaRuntimeManager, type CudaRuntimeBundle } from '../main/cuda-runtime'

const helper = new TextEncoder().encode('fake cuda helper')
const license = new TextEncoder().encode('license text')

function sha256(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function bundleFor(helperHash = sha256(helper)): Record<string, CudaRuntimeBundle> {
  return {
    'test-x64': {
      version: '9.9.9',
      baseUrl: 'https://example.test/runtime',
      qwenTtsHelper: 'helper-cuda',
      files: [
        { name: 'helper-cuda', size: helper.byteLength, sha256: helperHash, executable: true },
        { name: 'LICENSE.txt', size: license.byteLength, sha256: sha256(license) }
      ]
    }
  }
}

function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string) => {
    const body = url.endsWith('/helper-cuda') ? helper : license
    return new Response(new Uint8Array(body), {
      status: 200,
      headers: { 'content-length': String(body.byteLength) }
    })
  })
}

describe('CudaRuntimeManager', () => {
  let baseDir: string

  beforeEach(async () => {
    baseDir = await mkdtemp(path.join(tmpdir(), 'airouter-cuda-'))
  })

  afterEach(async () => {
    await rm(baseDir, { recursive: true, force: true })
  })

  it('downloads, verifies, and activates the pinned bundle', async () => {
    const fetchMock = fakeFetch()
    const manager = new CudaRuntimeManager({
      baseDir,
      platform: 'test-x64',
      bundles: bundleFor(),
      fetch: fetchMock as unknown as typeof fetch
    })

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
    await expect(manager.resolveQwenTtsHelperPath()).resolves.toBeNull()

    const status = await manager.install()
    expect(status).toMatchObject({
      state: 'installed',
      version: '9.9.9',
      downloadedBytes: helper.byteLength + license.byteLength
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.test/runtime/helper-cuda',
      expect.any(Object)
    )
    const helperPath = await manager.resolveQwenTtsHelperPath()
    expect(helperPath).toBe(
      path.join(baseDir, 'airouter', 'runtimes', 'cuda', '9.9.9', 'test-x64', 'helper-cuda')
    )
    await expect(readFile(helperPath!)).resolves.toEqual(Buffer.from(helper))
  })

  it('rejects a file whose hash is not on the allowlist and leaves nothing installed', async () => {
    const manager = new CudaRuntimeManager({
      baseDir,
      platform: 'test-x64',
      bundles: bundleFor('0'.repeat(64)),
      fetch: fakeFetch() as unknown as typeof fetch
    })

    await expect(manager.install()).rejects.toThrow('SHA-256 校验失败')
    const status = await manager.getStatus()
    expect(status).toMatchObject({ state: 'not-installed' })
    expect(status.lastError).toContain('SHA-256 校验失败')
    await expect(manager.resolveQwenTtsHelperPath()).resolves.toBeNull()
    const root = path.join(baseDir, 'airouter', 'runtimes', 'cuda')
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('removes an installed bundle', async () => {
    const manager = new CudaRuntimeManager({
      baseDir,
      platform: 'test-x64',
      bundles: bundleFor(),
      fetch: fakeFetch() as unknown as typeof fetch
    })
    await manager.install()

    await manager.remove()

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'not-installed' })
  })

  it('reports platforms without a pinned bundle as unsupported', async () => {
    const manager = new CudaRuntimeManager({ baseDir, platform: 'darwin-arm64' })

    await expect(manager.getStatus()).resolves.toMatchObject({ state: 'unsupported' })
    await expect(manager.install()).rejects.toThrow('当前平台不支持')
  })
})
