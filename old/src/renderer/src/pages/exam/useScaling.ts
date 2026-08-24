/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { useCallback, useEffect, useState } from 'react'

export const DESIGN_WIDTH = 1200
export const DESIGN_HEIGHT = 800

export default function useScalingRatio(): number {
  const [scale, setScale] = useState(() => {
    if (typeof window === 'undefined') return 1
    return Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT)
  })

  const handleResize = useCallback(() => {
    setScale(Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT))
  }, [])

  useEffect(() => {
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [handleResize])

  return scale
}
