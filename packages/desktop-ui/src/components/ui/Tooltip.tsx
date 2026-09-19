import type { ReactElement } from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import styles from './Tooltip.module.css'

interface TooltipProps {
  label: string
  children: ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  disabled?: boolean
}

export function Tooltip({
  label,
  children,
  side = 'top',
  disabled = false
}: TooltipProps): ReactElement {
  if (disabled) return children

  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className={styles.content} side={side} sideOffset={8}>
            {label}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
