/* eslint-disable react-refresh/only-export-components -- public package entrypoint */
import { useState, type CSSProperties, type HTMLAttributes, type JSX, type ReactNode } from 'react'
import styles from './PageRenderer.module.css'
import {
  PAGE_DESIGN_HEIGHT,
  PAGE_DESIGN_WIDTH,
  type PageBlockGeometry,
  type PageBlockKind
} from './geometry'

export * from './geometry'

export interface PageStageProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode
}

export function PageStage({ className, children, ...props }: PageStageProps): JSX.Element {
  return (
    <div className={joinClasses(styles.stage, className)} data-page-stage="" {...props}>
      {children}
    </div>
  )
}

export interface ScaledPageProps extends HTMLAttributes<HTMLDivElement> {
  scale: number
  children: ReactNode
}

export function ScaledPage({
  scale,
  className,
  children,
  style,
  ...props
}: ScaledPageProps): JSX.Element {
  const normalizedScale = Number.isFinite(scale) && scale > 0 ? scale : 1
  return (
    <div
      className={joinClasses(styles.scaledPage, className)}
      style={{
        width: PAGE_DESIGN_WIDTH * normalizedScale,
        height: PAGE_DESIGN_HEIGHT * normalizedScale,
        ...style
      }}
      {...props}
    >
      <div className={styles.scaledPageInner} style={{ transform: `scale(${normalizedScale})` }}>
        {children}
      </div>
    </div>
  )
}

export interface PageBlockProps extends HTMLAttributes<HTMLDivElement>, PageBlockGeometry {
  kind: PageBlockKind
  layer?: number
}

export function PageBlock({
  x,
  y,
  width,
  height,
  kind,
  layer,
  className,
  style,
  children,
  ...props
}: PageBlockProps): JSX.Element {
  const geometryStyle: CSSProperties = {
    left: `${x}%`,
    top: `${y}%`,
    ...(width === undefined ? {} : { width: `${width}%` }),
    ...(height === undefined ? {} : { height: `${height}%` }),
    ...(layer === undefined ? {} : { zIndex: layer })
  }
  return (
    <div
      className={joinClasses(styles.block, styles[kind], className)}
      data-page-block-kind={kind}
      style={{ ...geometryStyle, ...style }}
      {...props}
    >
      {children}
    </div>
  )
}

export interface PageTextProps extends HTMLAttributes<HTMLDivElement> {
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
}

export function PageText({
  fontSize = 28,
  bold = false,
  align = 'left',
  className,
  style,
  children,
  ...props
}: PageTextProps): JSX.Element {
  return (
    <div
      className={joinClasses(styles.textContent, className)}
      style={{
        fontSize,
        fontWeight: bold ? 700 : 400,
        textAlign: align,
        ...style
      }}
      {...props}
    >
      {children}
    </div>
  )
}

export interface PageImageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  src?: string
  alt: string
  placeholder?: ReactNode
}

export function PageImage({
  src,
  alt,
  placeholder,
  className,
  ...props
}: PageImageProps): JSX.Element {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const failed = Boolean(src && failedSrc === src)
  return (
    <div className={joinClasses(styles.imageContent, className)} {...props}>
      {src && !failed ? (
        <img alt={alt} draggable={false} src={src} onError={() => setFailedSrc(src)} />
      ) : (
        <div className={styles.mediaPlaceholder}>{placeholder}</div>
      )}
    </div>
  )
}

export function PageChoiceView({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={joinClasses(styles.choiceContent, className)} {...props}>
      {children}
    </div>
  )
}

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}
