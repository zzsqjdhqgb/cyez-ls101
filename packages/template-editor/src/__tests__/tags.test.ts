import { describe, expect, it } from 'vitest'
import { normalizeTemplateTags } from '../tags'

describe('normalizeTemplateTags', () => {
  it('trims, normalizes, deduplicates and sorts tags', () => {
    expect(normalizeTemplateTags(['  z ', 'e\u0301', 'é', '', 'a'])).toEqual(['a', 'z', 'é'])
  })

  it('accepts missing tags as an empty set', () => {
    expect(normalizeTemplateTags(undefined)).toEqual([])
  })

  it('rejects invalid tag values', () => {
    expect(() => normalizeTemplateTags(['line\nfeed'])).toThrow(/control characters/)
    expect(() => normalizeTemplateTags(['x'.repeat(25)])).toThrow(/24/)
    expect(() =>
      normalizeTemplateTags(Array.from({ length: 13 }, (_, index) => String(index)))
    ).toThrow(/12/)
  })
})
