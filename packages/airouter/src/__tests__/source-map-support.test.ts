import { describe, expect, it } from 'vitest'
import { installSourceMapSupport, sourceMapExecArgv } from '../main/source-map-support'

describe('sourceMapExecArgv', () => {
  it('installs lazy stack trace mapping for ASAR-packaged code', () => {
    installSourceMapSupport()
    expect(Error.prepareStackTrace).toBeTypeOf('function')
  })

  it('preserves existing Node options and enables source maps', () => {
    expect(sourceMapExecArgv(['--conditions=development'])).toEqual([
      '--conditions=development',
      '--enable-source-maps'
    ])
  })

  it('does not add the source map option twice', () => {
    expect(sourceMapExecArgv(['--enable-source-maps'])).toEqual(['--enable-source-maps'])
  })
})
