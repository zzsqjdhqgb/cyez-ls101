import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'
import {
  PageBlock,
  PageChoiceView,
  PageImage,
  PageStage,
  PageText,
  ScaledPage,
  clampPagePercent,
  pagePointFromClient,
  roundPagePercent,
  PAGE_DESIGN_HEIGHT,
  PAGE_DESIGN_WIDTH
} from '@ls101/page-renderer'
import type {
  ContentBlock,
  PageNode,
  TemplateDocumentOperation,
  TextExpression,
  VariableRef
} from '@ls101/template-editor'
import {
  Copy,
  Image as ImageIcon,
  ListChecks,
  Maximize2,
  Plus,
  Trash2,
  Type,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { IconButton } from '../../components/ui/IconButton'
import styles from './TemplatePageCanvas.module.css'

interface TemplatePageCanvasProps {
  page: PageNode
  selectedBlockId: string | null
  disabled?: boolean
  apply(operation: TemplateDocumentOperation): boolean
  onSelectBlock(blockId: string | null): void
}

type InteractionMode = 'move' | 'resize'

export function TemplatePageCanvas({
  page,
  selectedBlockId,
  disabled = false,
  apply,
  onSelectBlock
}: TemplatePageCanvasProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const interactionCleanupRef = useRef<(() => void) | null>(null)
  const [fitScale, setFitScale] = useState(0.5)
  const [zoom, setZoom] = useState(1)
  const [adding, setAdding] = useState(false)
  const [previewBlock, setPreviewBlock] = useState<ContentBlock | null>(null)
  const scale = fitScale * zoom
  const selectedBlock = page.content.blocks.find((block) => block.id === selectedBlockId) ?? null

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateFit = (): void => {
      const horizontalRoom = Math.max(240, viewport.clientWidth - 48)
      const verticalRoom = Math.max(180, viewport.clientHeight - 48)
      setFitScale(
        Math.min(horizontalRoom / PAGE_DESIGN_WIDTH, verticalRoom / PAGE_DESIGN_HEIGHT, 1)
      )
    }
    updateFit()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateFit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => () => interactionCleanupRef.current?.(), [])

  const addBlock = (type: ContentBlock['type']): void => {
    const block = createContentBlock(type)
    const blockId = availableBlockId(block.id, page.content.blocks)
    if (
      apply({
        type: 'insert-content-block',
        pageId: page.id,
        block: { ...block, id: blockId }
      })
    ) {
      onSelectBlock(blockId)
      setAdding(false)
    }
  }

  const removeSelected = (): void => {
    if (!selectedBlock) return
    if (apply({ type: 'remove-content-block', pageId: page.id, blockId: selectedBlock.id })) {
      onSelectBlock(null)
    }
  }

  const copySelected = (): void => {
    if (!selectedBlock) return
    const blockId = availableBlockId(selectedBlock.id, page.content.blocks)
    const copy = offsetBlock({ ...structuredClone(selectedBlock), id: blockId })
    if (apply({ type: 'insert-content-block', pageId: page.id, block: copy })) {
      onSelectBlock(blockId)
    }
  }

  const updateBlock = (block: ContentBlock): void => {
    apply({
      type: 'update-content-block',
      pageId: page.id,
      blockId: block.id,
      block
    })
  }

  const beginInteraction = (
    event: ReactPointerEvent<HTMLElement>,
    block: ContentBlock,
    mode: InteractionMode
  ): void => {
    if (disabled || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onSelectBlock(block.id)
    interactionCleanupRef.current?.()

    const stage = event.currentTarget.closest<HTMLElement>('[data-page-stage]')
    const blockElement = event.currentTarget.closest<HTMLElement>('[data-content-block-id]')
    if (!stage || !blockElement) return
    const stageRect = stage.getBoundingClientRect()
    const blockRect = blockElement.getBoundingClientRect()
    const startPoint = pagePointFromClient(stageRect, event.clientX, event.clientY)
    const visualWidth = (blockRect.width / stageRect.width) * 100
    const visualHeight = (blockRect.height / stageRect.height) * 100
    const initialWidth = block.width ?? visualWidth
    const initialHeight = block.type === 'choice-view' ? block.height : visualHeight
    let latest = structuredClone(block)
    const move = (pointerEvent: PointerEvent): void => {
      const point = pagePointFromClient(stageRect, pointerEvent.clientX, pointerEvent.clientY)
      const deltaX = point.x - startPoint.x
      const deltaY = point.y - startPoint.y
      if (mode === 'move') {
        latest = {
          ...block,
          x: roundPagePercent(clampPagePercent(block.x + deltaX, 0, 100 - visualWidth)),
          y: roundPagePercent(clampPagePercent(block.y + deltaY, 0, 100 - visualHeight))
        }
      } else if (block.type === 'choice-view') {
        latest = {
          ...block,
          width: roundPagePercent(clampPagePercent(initialWidth + deltaX, 5, 100 - block.x)),
          height: roundPagePercent(clampPagePercent(initialHeight + deltaY, 5, 100 - block.y))
        }
      } else {
        latest = {
          ...block,
          width: roundPagePercent(clampPagePercent(initialWidth + deltaX, 5, 100 - block.x))
        }
      }
      setPreviewBlock(latest)
    }

    const cleanup = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
      interactionCleanupRef.current = null
    }
    const finish = (): void => {
      cleanup()
      setPreviewBlock(null)
      if (!sameGeometry(block, latest)) updateBlock(latest)
    }
    const cancel = (): void => {
      cleanup()
      setPreviewBlock(null)
    }
    interactionCleanupRef.current = cancel
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
  }

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (disabled || !selectedBlock || isTextEntry(event.target)) return
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      removeSelected()
    }
  }

  const displayBlocks = page.content.blocks.map((block) =>
    previewBlock?.id === block.id ? previewBlock : block
  )
  const stageStyle = { '--page-editor-scale': scale } as CSSProperties

  return (
    <section className={styles.editor} aria-label={`页面 ${page.id} 内容编辑器`}>
      <div className={styles.toolbar}>
        <div className={styles.toolGroup}>
          <IconButton
            aria-expanded={adding}
            icon={Plus}
            label="添加内容块"
            size="small"
            disabled={disabled}
            onClick={() => setAdding((current) => !current)}
          />
          {adding ? (
            <div className={styles.addMenu} aria-label="内容块类型">
              <IconButton
                icon={Type}
                label="添加文本"
                size="small"
                onClick={() => addBlock('text')}
              />
              <IconButton
                icon={ImageIcon}
                label="添加图片"
                size="small"
                onClick={() => addBlock('image')}
              />
              <IconButton
                icon={ListChecks}
                label="添加选择题视图"
                size="small"
                onClick={() => addBlock('choice-view')}
              />
            </div>
          ) : null}
          <span className={styles.divider} />
          <IconButton
            icon={Copy}
            label="复制内容块"
            size="small"
            disabled={disabled || !selectedBlock}
            onClick={copySelected}
          />
          <IconButton
            icon={Trash2}
            label="删除内容块"
            size="small"
            variant="danger"
            disabled={disabled || !selectedBlock}
            onClick={removeSelected}
          />
        </div>
        <div className={styles.pageIdentity}>
          <strong>{page.name?.trim() || '页面'}</strong>
          <span>{page.content.blocks.length} 个内容块</span>
        </div>
        <div className={styles.toolGroup}>
          <IconButton
            icon={ZoomOut}
            label="缩小页面"
            size="small"
            disabled={zoom <= 0.5}
            onClick={() => setZoom((value) => Math.max(0.5, value - 0.1))}
          />
          <input
            aria-label="页面缩放"
            className={styles.zoomSlider}
            max="1.5"
            min="0.5"
            step="0.1"
            type="range"
            value={zoom}
            onChange={(event) => setZoom(Number(event.target.value))}
          />
          <IconButton
            icon={ZoomIn}
            label="放大页面"
            size="small"
            disabled={zoom >= 1.5}
            onClick={() => setZoom((value) => Math.min(1.5, value + 0.1))}
          />
          <IconButton icon={Maximize2} label="适合窗口" size="small" onClick={() => setZoom(1)} />
        </div>
      </div>
      <div
        ref={viewportRef}
        aria-label={`页面 ${page.id} 内容编辑器`}
        className={styles.viewport}
        role="application"
        tabIndex={0}
        onKeyDown={handleCanvasKeyDown}
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onSelectBlock(null)
        }}
      >
        <ScaledPage className={styles.pageFrame} scale={scale}>
          <PageStage
            aria-label={`页面 ${page.id}`}
            className={styles.stage}
            style={stageStyle}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) onSelectBlock(null)
            }}
          >
            {displayBlocks.map((block, index) => (
              <PageBlock
                aria-label={`${contentBlockLabel(block.type)} ${block.id}`}
                className={styles.contentBlock}
                data-content-block-id={block.id}
                height={block.type === 'choice-view' ? block.height : undefined}
                key={block.id}
                kind={block.type}
                layer={blockLayer(block.type, index)}
                role="button"
                tabIndex={0}
                width={block.width}
                x={block.x}
                y={block.y}
                data-selected={block.id === selectedBlockId || undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  onSelectBlock(block.id)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectBlock(block.id)
                  }
                }}
                onPointerDown={(event) => beginInteraction(event, block, 'move')}
              >
                <ContentBlockView block={block} />
                {block.id === selectedBlockId ? (
                  <>
                    <span className={styles.selectionLabel}>{block.id}</span>
                    <button
                      aria-label={`调整内容块 ${block.id} 大小`}
                      className={styles.resizeHandle}
                      type="button"
                      onPointerDown={(event) => beginInteraction(event, block, 'resize')}
                    />
                  </>
                ) : null}
              </PageBlock>
            ))}
            {page.content.blocks.length === 0 ? (
              <div className={styles.emptyPage}>
                <Type aria-hidden="true" />
                <span>空白页面</span>
              </div>
            ) : null}
          </PageStage>
        </ScaledPage>
      </div>
    </section>
  )
}

function ContentBlockView({ block }: { block: ContentBlock }): JSX.Element {
  if (block.type === 'text') {
    return (
      <PageText align={block.align} bold={block.bold} fontSize={block.fontSize}>
        {renderTextExpression(block.text)}
      </PageText>
    )
  }
  if (block.type === 'image') {
    const src = block.src.source === 'literal' ? block.src.value : undefined
    return (
      <PageImage
        alt={block.id}
        placeholder={
          <span className={styles.imagePlaceholder}>
            <ImageIcon aria-hidden="true" />
            <span>{block.src.source === 'variable' ? variableName(block.src.ref) : block.id}</span>
          </span>
        }
        src={src}
      />
    )
  }
  return (
    <PageChoiceView>
      <div className={styles.choicePreview}>
        <div className={styles.choicePreviewHeading}>
          <ListChecks aria-hidden="true" />
          <span>{choiceModeLabel(block.defaultViewport.mode)}</span>
        </div>
        {[0, 1, 2].map((item) => (
          <span className={styles.choicePreviewRow} key={item} />
        ))}
      </div>
    </PageChoiceView>
  )
}

function renderTextExpression(expression: TextExpression): ReactNode {
  if (expression.parts.length === 0) return <span className={styles.emptyText}>文本</span>
  return expression.parts.map((part, index) =>
    part.type === 'literal' ? (
      part.value
    ) : (
      <span className={styles.variableToken} key={`${variableName(part.ref)}-${index}`}>
        {`[@${variableName(part.ref)}]`}
      </span>
    )
  )
}

function createContentBlock(type: ContentBlock['type']): ContentBlock {
  if (type === 'text') {
    return {
      id: 'text',
      type: 'text',
      x: 10,
      y: 10,
      width: 40,
      fontSize: 32,
      text: { type: 'string', parts: [{ type: 'literal', value: '' }] }
    }
  }
  if (type === 'image') {
    return {
      id: 'image',
      type: 'image',
      x: 10,
      y: 10,
      width: 40,
      src: { type: 'file', source: 'literal', value: '' }
    }
  }
  return {
    id: 'choice-view',
    type: 'choice-view',
    x: 10,
    y: 10,
    width: 50,
    height: 50,
    defaultViewport: { mode: 'free' }
  }
}

function availableBlockId(suggestion: string, blocks: readonly ContentBlock[]): string {
  const used = new Set(blocks.map((block) => block.id))
  if (!used.has(suggestion)) return suggestion
  let suffix = 1
  while (used.has(`${suggestion}-${suffix}`)) suffix += 1
  return `${suggestion}-${suffix}`
}

function offsetBlock(block: ContentBlock): ContentBlock {
  const width = block.width ?? 20
  const height = block.type === 'choice-view' ? block.height : 10
  return {
    ...block,
    x: roundPagePercent(clampPagePercent(block.x + 2, 0, 100 - width)),
    y: roundPagePercent(clampPagePercent(block.y + 2, 0, 100 - height))
  }
}

function sameGeometry(first: ContentBlock, second: ContentBlock): boolean {
  return (
    first.x === second.x &&
    first.y === second.y &&
    first.width === second.width &&
    (first.type !== 'choice-view' ||
      (second.type === 'choice-view' && first.height === second.height))
  )
}

function blockLayer(type: ContentBlock['type'], index: number): number {
  if (type === 'image') return 100 + index
  if (type === 'choice-view') return 1000 + index
  return 2000 + index
}

function contentBlockLabel(type: ContentBlock['type']): string {
  if (type === 'text') return '文本'
  if (type === 'image') return '图片'
  return '选择题视图'
}

function choiceModeLabel(mode: 'free' | 'focus' | 'range'): string {
  if (mode === 'focus') return '题目聚焦'
  if (mode === 'range') return '分页范围'
  return '自由浏览'
}

function variableName(ref: VariableRef): string {
  return ref.scope === 'interface' ? `${ref.alias}.${ref.varName}` : ref.name
}

function isTextEntry(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  )
}
