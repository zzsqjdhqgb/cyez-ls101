export const PAGE_DESIGN_WIDTH = 1200
export const PAGE_DESIGN_HEIGHT = 800
export const PAGE_ASPECT_RATIO = PAGE_DESIGN_WIDTH / PAGE_DESIGN_HEIGHT

export type PageBlockKind = 'text' | 'image' | 'choice-view'

/** Page geometry is stored as percentages of the 1200 x 800 design surface. */
export interface PageBlockGeometry {
  x: number
  y: number
  width?: number
  height?: number
}

export function pagePointFromClient(
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
  clientX: number,
  clientY: number
): { x: number; y: number } {
  return {
    x: ((clientX - rect.left) / rect.width) * 100,
    y: ((clientY - rect.top) / rect.height) * 100
  }
}

export function clampPagePercent(value: number, minimum = 0, maximum = 100): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function roundPagePercent(value: number): number {
  return Math.round(value * 10) / 10
}
