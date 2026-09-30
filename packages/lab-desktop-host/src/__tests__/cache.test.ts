import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import { ExamCache } from '../cache'

describe('ExamCache', () => {
  it('serves resource paths with encoded keys verbatim', async () => {
    const packagePath = 'resources/player-block%3Amain-page%2Fpicture/picture.png'
    const resourceBytes = new Uint8Array([1, 2, 3])
    const exam: ExamPackage = {
      format: 'ls101-exam',
      formatVersion: 1,
      packageId: 'cache-test',
      examData: {
        title: '缓存测试',
        resources: { image: { filename: 'picture.png', packagePath, mediaType: 'image/png' } },
        player: {
          pages: [
            {
              id: 'page',
              content: [
                {
                  id: 'image',
                  type: 'image',
                  x: 0,
                  y: 0,
                  width: 100,
                  height: 100,
                  src: 'resource:image'
                }
              ],
              timeline: [{ type: 'countdown', seconds: 0 }]
            }
          ],
          recordingIndices: []
        }
      },
      answerCapturePlan: { strings: [], audios: [] },
      submissionTemplate: {
        format: 'ls101-submission',
        formatVersion: 1,
        meta: { examPackageId: 'cache-test', examTitle: '缓存测试' },
        schemaUses: [],
        resources: {}
      }
    }
    const bytes = await encodeExamPackage(exam, { image: resourceBytes })
    const tempRoot = await mkdtemp(join(tmpdir(), 'ls101-cache-'))
    const filename = join(tempRoot, 'test.lsexam')
    const root = join(filename, '..', 'cache')
    try {
      await writeFile(filename, bytes)
      const cache = new ExamCache(root)
      const digest = createHash('sha256').update(bytes).digest('hex')
      const baseUrl = await cache.prepare(filename, digest)
      const response = cache.respond(`${baseUrl}${packagePath}`)
      expect(response.status).toBe(200)
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(resourceBytes)
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
