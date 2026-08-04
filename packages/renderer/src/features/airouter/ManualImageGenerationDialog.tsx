import { useEffect, useState, useSyncExternalStore, type JSX } from 'react'
import { imageClipboard } from '@ls101/clipboard/renderer'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { Check, ClipboardCopy, ClipboardPaste, FolderOpen, Image, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { toast } from '../../components/ui/toast'
import {
  manualImageGenerationCoordinator,
  type ManualImageGenerationCoordinator,
  type ManualImageGenerationRequest
} from './ManualImageGeneration'
import styles from './ManualImageGenerationDialog.module.css'

interface SelectedImage {
  data: Uint8Array
  mediaType: string
  name: string
  previewUrl: string
}

export function ManualImageGenerationDialog({
  coordinator = manualImageGenerationCoordinator
}: {
  coordinator?: ManualImageGenerationCoordinator
}): JSX.Element | null {
  const request = useSyncExternalStore(
    coordinator.subscribe,
    coordinator.getSnapshot,
    coordinator.getSnapshot
  )

  if (!request) return null

  return (
    <ManualImageGenerationDialogSession
      key={request.id}
      coordinator={coordinator}
      request={request}
    />
  )
}

function ManualImageGenerationDialogSession({
  coordinator,
  request
}: {
  coordinator: ManualImageGenerationCoordinator
  request: ManualImageGenerationRequest
}): JSX.Element {
  const [selected, setSelected] = useState<SelectedImage | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (selected) URL.revokeObjectURL(selected.previewUrl)
    },
    [selected]
  )

  const select = (data: Uint8Array, name: string, mediaType: string): void => {
    const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: mediaType }))
    setSelected((current) => {
      if (current) URL.revokeObjectURL(current.previewUrl)
      return { data: new Uint8Array(data), mediaType, name, previewUrl }
    })
  }

  const chooseFile = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const file = await fileDialog.readBinary({
        title: '导入生成的图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      })
      if (file) select(file.data, file.name, mediaTypeFromName(file.name))
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const chooseClipboard = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const data = await imageClipboard.readImage()
      if (!data) {
        toast.info('剪贴板中没有图片')
        return
      }
      select(data, '剪贴板图片.png', 'image/png')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.backdrop} role="presentation">
      <section
        aria-labelledby="manual-image-title"
        aria-modal="true"
        className={styles.dialog}
        role="dialog"
      >
        <header className={styles.header}>
          <div>
            <span>手动生成模式</span>
            <h2 id="manual-image-title">生成并导入图片</h2>
          </div>
          <IconButton
            icon={X}
            label="取消图片生成"
            variant="ghost"
            onClick={() => coordinator.cancel(request.id)}
          />
        </header>
        <div className={styles.body}>
          <div className={styles.promptHeader}>
            <label htmlFor="manual-image-prompt">图片提示词</label>
            <Button
              icon={ClipboardCopy}
              size="small"
              onClick={() =>
                void imageClipboard.writeText(request.prompt).then(
                  () => toast.success('提示词已复制'),
                  (reason: unknown) => setError(errorMessage(reason))
                )
              }
            >
              复制
            </Button>
          </div>
          <textarea id="manual-image-prompt" readOnly rows={7} value={request.prompt} />
          <div className={styles.importArea}>
            <div className={styles.preview} data-empty={!selected}>
              {selected ? (
                <img alt="待导入图片预览" src={selected.previewUrl} />
              ) : (
                <span>
                  <Image aria-hidden="true" />
                  等待导入生成结果
                </span>
              )}
            </div>
            <div className={styles.importActions}>
              <span>{selected?.name ?? '支持 PNG、JPEG、GIF 和 WebP'}</span>
              <div>
                <Button icon={FolderOpen} disabled={busy} onClick={() => void chooseFile()}>
                  选择文件
                </Button>
                <Button
                  icon={ClipboardPaste}
                  disabled={busy}
                  onClick={() => void chooseClipboard()}
                >
                  从剪贴板读取
                </Button>
              </div>
            </div>
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={() => coordinator.cancel(request.id)}>
            取消
          </Button>
          <Button
            icon={Check}
            variant="primary"
            disabled={!selected || busy}
            onClick={() => {
              if (selected) coordinator.complete(request.id, selected)
            }}
          >
            使用此图片
          </Button>
        </footer>
      </section>
    </div>
  )
}

function mediaTypeFromName(name: string): string {
  const extension = name.toLowerCase().split('.').pop()
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'gif') return 'image/gif'
  if (extension === 'webp') return 'image/webp'
  return 'image/png'
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '导入图片失败'
}
