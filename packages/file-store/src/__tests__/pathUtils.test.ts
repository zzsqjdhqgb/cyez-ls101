import { describe, expect, it } from 'vitest'
import { validateFilename, validateScope, validateScopeSegment } from '../shared/pathUtils'

describe('file-store paths', () => {
  it.each(['interfaces', 'drafts', 'draft-abc123', '550e8400-e29b-41d4-a716-446655440000'])(
    'accepts scope segment %s',
    (segment) => {
      expect(() => validateScopeSegment(segment)).not.toThrow()
    }
  )

  it.each(['.drafts', 'drafts.current', 'drafts/current', 'drafts\\current', '../drafts', ''])(
    'rejects scope segment %s',
    (segment) => {
      expect(() => validateScopeSegment(segment)).toThrow('Invalid file-store scope segment')
    }
  )

  it('requires a non-empty scope of valid segments', () => {
    expect(() => validateScope(['interfaces', 'drafts', 'draft-abc123'])).not.toThrow()
    expect(() => validateScope([])).toThrow('at least one segment')
    expect(() => validateScope(['interfaces', '..'])).toThrow('Invalid file-store scope segment')
  })

  it.each(['manifest.json', 'cover-1.png', 'recording_2.mp3', 'content'])(
    'accepts filename %s',
    (filename) => {
      expect(() => validateFilename(filename)).not.toThrow()
    }
  )

  it.each(['.hidden', '../secret', 'nested/file', 'nested\\file', ''])(
    'rejects filename %s',
    (filename) => {
      expect(() => validateFilename(filename)).toThrow('Invalid file-store filename')
    }
  )
})
