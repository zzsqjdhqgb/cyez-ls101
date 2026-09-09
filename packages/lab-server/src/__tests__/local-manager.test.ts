import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { manageLocalService } from '../local-manager'

describe('fixed local manager capabilities', () => {
  it('reports an absent install and rejects arbitrary commands and malformed inputs before OS execution', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ls101-manager-test-'))
    const paths = { root, runtime: join(root, 'missing'), source: join(root, 'source') }
    try {
      expect(await manageLocalService('status', undefined, paths)).toMatchObject({
        state: 'not-installed'
      })
      for (const [operation, input] of [
        ['execute', { command: 'anything' }],
        ['start', {}],
        ['autostart', 'yes'],
        ['configure', { port: 8443, directory: '/arbitrary' }],
        ['initialize', { port: -1 }]
      ] as const) {
        await expect(manageLocalService(operation, input, paths)).rejects.toMatchObject({
          code: 'INVALID_REQUEST'
        })
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
