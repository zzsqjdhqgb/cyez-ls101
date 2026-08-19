import { copyFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'

const COLOR_DIFFERENCE_THRESHOLD = 0.1
const MAX_DIFFERENCE_RATIO = 0.03

export function visuallyEquivalentPng(left: Buffer, right: Buffer): boolean {
  if (left.equals(right)) return true

  try {
    const leftImage = PNG.sync.read(left)
    const rightImage = PNG.sync.read(right)
    if (leftImage.width === rightImage.width && leftImage.height === rightImage.height) {
      return differenceRatio(leftImage, rightImage) <= MAX_DIFFERENCE_RATIO
    }

    const normalized = normalizeIntegerScale(leftImage, rightImage)
    if (!normalized) return false

    // Device scale and platform rasterization can introduce small visual differences.
    const [normalizedLeft, normalizedRight] = normalized
    return differenceRatio(normalizedLeft, normalizedRight) <= MAX_DIFFERENCE_RATIO
  } catch {
    return false
  }
}

function differenceRatio(left: PNG, right: PNG): number {
  return differentPixelCount(left, right) / (left.width * left.height)
}

function differentPixelCount(left: PNG, right: PNG): number {
  return pixelmatch(left.data, right.data, undefined, left.width, left.height, {
    threshold: COLOR_DIFFERENCE_THRESHOLD
  })
}

function normalizeIntegerScale(left: PNG, right: PNG): [PNG, PNG] | null {
  const leftIsLarger = left.width > right.width && left.height > right.height
  const larger = leftIsLarger ? left : right
  const smaller = leftIsLarger ? right : left
  const scale = larger.width / smaller.width

  if (!Number.isInteger(scale) || scale < 2 || larger.height / smaller.height !== scale) {
    return null
  }

  const resized = downscale(larger, scale)
  return leftIsLarger ? [resized, smaller] : [smaller, resized]
}

function downscale(source: PNG, scale: number): PNG {
  const result = new PNG({ width: source.width / scale, height: source.height / scale })
  const sampleCount = scale * scale

  for (let targetY = 0; targetY < result.height; targetY += 1) {
    for (let targetX = 0; targetX < result.width; targetX += 1) {
      const channels = [0, 0, 0, 0]
      for (let offsetY = 0; offsetY < scale; offsetY += 1) {
        for (let offsetX = 0; offsetX < scale; offsetX += 1) {
          const sourceOffset =
            ((targetY * scale + offsetY) * source.width + targetX * scale + offsetX) * 4
          for (let channel = 0; channel < 4; channel += 1) {
            channels[channel] += source.data[sourceOffset + channel] ?? 0
          }
        }
      }

      const targetOffset = (targetY * result.width + targetX) * 4
      for (let channel = 0; channel < 4; channel += 1) {
        result.data[targetOffset + channel] = Math.round(channels[channel] / sampleCount)
      }
    }
  }

  return result
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
