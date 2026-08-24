import { describe, expect, it } from 'vitest'
import {
  assetKeyToLocation,
  assetUrlToKey,
  builtinAssetKeyToLocation,
  createAssetKey,
  createBuiltinAssetKey
} from '../shared/assetKey'

describe('asset keys', () => {
  it('round-trips an arbitrary-depth asset location', () => {
    const location = {
      scope: ['interfaces', 'published', 'abc123', 'instances', 'instance-1'],
      filename: 'cover.png'
    }

    const key = createAssetKey(location)

    expect(key).toBe('asset-key://v1/interfaces/published/abc123/instances/instance-1/cover.png')
    expect(assetKeyToLocation(key)).toEqual(location)
  })

  it('keeps builtin asset keys in a separate namespace', () => {
    const location = { scope: ['template-editor'], filename: 'cover.png' }
    const key = createBuiltinAssetKey(location)

    expect(key).toBe('builtin-asset-key://v1/template-editor/cover.png')
    expect(builtinAssetKeyToLocation(key)).toEqual(location)
    expect(() => assetKeyToLocation(key)).toThrow('Invalid asset key')
  })

  it('converts a local asset URL to its IPC-safe asset key', () => {
    expect(assetUrlToKey('asset://local/interfaces/published/abc123/cover-image.png')).toBe(
      'asset-key://v1/interfaces/published/abc123/cover-image.png'
    )
  })

  it.each([
    'asset-key://v2/interfaces/cover.png',
    'asset-key://v1/cover.png',
    'asset-key://v1/interfaces/.assets/cover.png',
    'asset-key://v1/interfaces/%2e%2e/secret.png',
    'asset-key://v1/interfaces/cover.png?download=1',
    'asset-key://v1/interfaces/cover.png#preview',
    'asset://local/interfaces/cover.png'
  ])('rejects invalid key %s', (key) => {
    expect(() => assetKeyToLocation(key)).toThrow('Invalid asset key')
  })
})
