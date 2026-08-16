import { copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const COLOR_DIFFERENCE_THRESHOLD = 0.1

export function visuallyEquivalentPng(left: Buffer, right: Buffer): boolean {
  if (left.equals(right)) return true

  try {
    const leftImage = PNG.sync.read(left)
    const rightImage = PNG.sync.read(right)
    if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) return false

    return (
      pixelmatch(leftImage.data, rightImage.data, undefined, leftImage.width, leftImage.height, {
        threshold: COLOR_DIFFERENCE_THRESHOLD
      }) === 0
    )
  } catch {
    return false
  }
}

export async function preserveEquivalentEvidenceImages(
  publishedRoot: string,
  stagedRoot: string,
  generatedFiles: readonly string[]
): Promise<void> {
  for (const filename of generatedFiles.filter((item) => item.endsWith('.png'))) {
    const published = path.join(publishedRoot, filename)
    const staged = path.join(stagedRoot, filename)
    const [publishedBytes, stagedBytes] = await Promise.all([
      readFileIfPresent(published),
      readFileIfPresent(staged)
    ])
    if (
      publishedBytes &&
      stagedBytes &&
      visuallyEquivalentPng(publishedBytes, stagedBytes) &&
      !publishedBytes.equals(stagedBytes)
    ) {
      await copyFile(published, staged)
    }
  }
}

async function readFileIfPresent(filename: string): Promise<Buffer | null> {
  try {
    return await readFile(filename)
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}
