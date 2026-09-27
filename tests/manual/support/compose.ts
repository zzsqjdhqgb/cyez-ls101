import { PNG } from 'pngjs'

interface SplitThemeOptions {
  /** 倾斜量：分割线在上下两端相对中线的左右偏移比例。 */
  slant?: number
  /** 边界羽化宽度（像素），避免斜线出现锯齿。 */
  feather?: number
}

/**
 * 把同尺寸的浅色与深色截图合成一张：左侧取浅色，右侧取深色，分割线略带倾斜。
 * 用于"同一屏在浅色与深色主题下的对照"配图；只做像素搬运与边界混合，说明文字写在手册图注里。
 */
export function composeSplitTheme(
  light: Buffer,
  dark: Buffer,
  options: SplitThemeOptions = {}
): Buffer {
  const { slant = 0.12, feather = 2 } = options
  const lightImage = PNG.sync.read(light)
  const darkImage = PNG.sync.read(dark)
  if (lightImage.width !== darkImage.width || lightImage.height !== darkImage.height) {
    throw new Error('合成主题对照图要求两张截图尺寸一致')
  }

  const { width, height } = lightImage
  const canvas = new PNG({ width, height })

  for (let row = 0; row < height; row += 1) {
    const progress = height > 1 ? row / (height - 1) : 0
    const splitX = width * (0.5 + slant * (progress - 0.5))
    for (let column = 0; column < width; column += 1) {
      const offset = (width * row + column) << 2
      const lightWeight = boundaryWeight(column, splitX, feather)
      for (let channel = 0; channel < 4; channel += 1) {
        const fromLight = lightImage.data[offset + channel] * lightWeight
        const fromDark = darkImage.data[offset + channel] * (1 - lightWeight)
        canvas.data[offset + channel] = Math.round(fromLight + fromDark)
      }
    }
  }

  return PNG.sync.write(canvas)
}

/** 1 表示完全取浅色，0 表示完全取深色，中间为边界羽化。 */
function boundaryWeight(column: number, splitX: number, feather: number): number {
  const start = splitX - feather / 2
  if (column <= start) return 1
  if (column >= start + feather) return 0
  return 1 - (column - start) / feather
}
