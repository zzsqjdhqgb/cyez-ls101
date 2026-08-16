import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PNG } from 'pngjs'
import { preserveEquivalentEvidenceImages, visuallyEquivalentPng } from './evidence-image'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('visuallyEquivalentPng', () => {
  it('accepts different PNG encodings of the same pixels', () => {
    const pixels = [20, 40, 60, 255, 80, 100, 120, 255]
    const compressed = png(2, 1, pixels, 9)
    const uncompressed = png(2, 1, pixels, 0)

    expect(compressed.equals(uncompressed)).toBe(false)
    expect(visuallyEquivalentPng(compressed, uncompressed)).toBe(true)
  })

  it('accepts imperceptible color differences but rejects visible changes', () => {
    const original = png(1, 1, [100, 100, 100, 255])

    expect(visuallyEquivalentPng(original, png(1, 1, [101, 100, 100, 255]))).toBe(true)
    expect(visuallyEquivalentPng(original, png(1, 1, [220, 100, 100, 255]))).toBe(false)
  })

  it('rejects different dimensions and invalid PNG data', () => {
    expect(visuallyEquivalentPng(png(1, 1, [0, 0, 0, 255]), png(2, 1, [0, 0, 0, 255]))).toBe(false)
    expect(visuallyEquivalentPng(Buffer.from('not-png'), Buffer.from('also-not-png'))).toBe(false)
  })
})

describe('preserveEquivalentEvidenceImages', () => {
  it('keeps published bytes for equivalent images and keeps changed staged images', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ls101-evidence-image-'))
    temporaryDirectories.push(root)
    const publishedRoot = path.join(root, 'published')
    const stagedRoot = path.join(root, 'staged')
    const equivalent = 'module/assets/equivalent.png'
    const changed = 'module/assets/changed.png'
    await Promise.all([
      mkdir(path.dirname(path.join(publishedRoot, equivalent)), { recursive: true }),
      mkdir(path.dirname(path.join(stagedRoot, equivalent)), { recursive: true })
    ])

    const originalPixels = [20, 40, 60, 255, 80, 100, 120, 255]
    const oldEquivalent = png(2, 1, originalPixels, 9)
    const newEquivalent = png(2, 1, originalPixels, 0)
    const oldChanged = png(1, 1, [10, 10, 10, 255])
    const newChanged = png(1, 1, [240, 10, 10, 255])
    await Promise.all([
      writeFile(path.join(publishedRoot, equivalent), oldEquivalent),
      writeFile(path.join(stagedRoot, equivalent), newEquivalent),
      writeFile(path.join(publishedRoot, changed), oldChanged),
      writeFile(path.join(stagedRoot, changed), newChanged)
    ])

    await preserveEquivalentEvidenceImages(publishedRoot, stagedRoot, [equivalent, changed])

    expect(await readFile(path.join(stagedRoot, equivalent))).toEqual(oldEquivalent)
    expect(await readFile(path.join(stagedRoot, changed))).toEqual(newChanged)
  })
})

function png(width: number, height: number, rgba: readonly number[], deflateLevel = 9): Buffer {
  const image = new PNG({ width, height })
  for (let index = 0; index < image.data.length; index += 1) {
    image.data[index] = rgba[index % rgba.length] ?? 0
  }
  return PNG.sync.write(image, { deflateLevel })
}
