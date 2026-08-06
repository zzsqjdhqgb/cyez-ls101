import { describe, expect, it } from 'vitest'
import { assetUrlToLocation, builtinAssetUrlToLocation } from '../main/assetUrl'

describe('asset URL parsing', () => {
  it('converts an arbitrary-depth asset URL into a location', () => {
    expect(assetUrlToLocation('asset://local/interfaces/drafts/draft-abc123/cover.png')).toEqual({
      scope: ['interfaces', 'drafts', 'draft-abc123'],
      filename: 'cover.png'
    })
  })

  it.each([
    'https://local/interfaces/cover.png',
    'asset://other/interfaces/cover.png',
    'asset://local/cover.png',
    'asset://local/interfaces/.text/manifest.json',
    'asset://local/interfaces/%2e%2e/secret',
    'asset://local/interfaces/cover.png?download=1',
    'asset://local/interfaces/cover.png#fragment'
  ])('rejects %s', (url) => {
    expect(() => assetUrlToLocation(url)).toThrow()
  })

  it('parses builtin asset URLs only through the builtin protocol', () => {
    const url = 'builtin-asset://local/template-editor/cover.png'
    expect(builtinAssetUrlToLocation(url)).toEqual({
      scope: ['template-editor'],
      filename: 'cover.png'
    })
    expect(() => assetUrlToLocation(url)).toThrow()
  })
})
