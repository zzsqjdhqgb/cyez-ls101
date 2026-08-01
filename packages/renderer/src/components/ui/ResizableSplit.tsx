import {
  Fragment,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode
} from 'react'
import styles from './ResizableSplit.module.css'

interface ResizableSplitProps {
  children: ReactNode
  initialSize: number
  minFirst: number
  minSecond: number
  className?: string
  label?: string
}

export function ResizableSplit({
  children,
  initialSize,
  minFirst,
  minSecond,
  className,
  label = '调整分栏宽度'
}: ResizableSplitProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(initialSize)
  const [dragging, setDragging] = useState(false)
  const panels = Array.isArray(children) ? children.filter(Boolean) : [children]
  const classes = [styles.split, className].filter(Boolean).join(' ')

  const setSizeFromClientX = (clientX: number): void => {
    const root = rootRef.current
    if (!root || panels.length < 2) return
    const rect = root.getBoundingClientRect()
    const maxFirst = Math.max(minFirst, rect.width - minSecond - 8)
    setSize(Math.min(maxFirst, Math.max(minFirst, clientX - rect.left)))
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (panels.length < 2) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragging) setSizeFromClientX(event.clientX)
  }

  const stopDragging = (event: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setDragging(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? 64 : 16
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const root = rootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    setSizeFromClientX(rect.left + size + (event.key === 'ArrowLeft' ? -step : step))
  }

  const gridTemplateColumns =
    panels.length < 2
      ? 'minmax(0, 1fr)'
      : `minmax(${minFirst}px, ${size}px) 8px minmax(${minSecond}px, 1fr)`
  const splitStyle = { gridTemplateColumns } as CSSProperties

  return (
    <div className={classes} data-dragging={dragging || undefined} ref={rootRef} style={splitStyle}>
      {panels.map((panel, index) => (
        <Fragment key={`split-panel-${index}`}>
          {index > 0 ? (
            <div
              aria-label={label}
              aria-orientation="vertical"
              aria-valuemin={minFirst}
              aria-valuenow={Math.round(size)}
              className={styles.handle}
              key={`handle-${index}`}
              onKeyDown={onKeyDown}
              onPointerCancel={stopDragging}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={stopDragging}
              role="separator"
              tabIndex={0}
            />
          ) : null}
          <div className={styles.panel} key={`panel-${index}`}>
            {panel}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
