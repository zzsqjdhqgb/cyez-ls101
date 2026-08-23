import { useEffect, useState, type JSX } from 'react'
import type { LegacyDataInfo } from '@ls101/core-types'
import { ConfirmModal } from '../../components/ui/ConfirmModal'

export function LegacyDataDialog(): JSX.Element | null {
  const bridge = window.legacyData
  const [info, setInfo] = useState<LegacyDataInfo | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exported, setExported] = useState(false)

  useEffect(() => {
    let active = true
    if (!bridge) return () => undefined
    void bridge
      .getInfo()
      .then((loaded) => {
        if (active) setInfo(loaded)
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [bridge])

  if (!bridge || dismissed || !info || info.status === 'none' || info.status === 'cleaned') {
    return null
  }

  const failed = info.status === 'error'
  const canExport = !failed && info.archivePath !== null && info.archiveSizeBytes !== null
  const exportArchive = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = await bridge.exportArchive()
      if (saved) setExported(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const next = failed ? await bridge.retry() : await bridge.cleanup()
      setInfo(next)
      if (next.status !== 'error') setExported(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmModal
      busy={busy}
      cancelLabel="稍后处理"
      closeOnConfirm={false}
      confirmLabel={failed ? '重试' : '继续并清理'}
      danger={!failed}
      error={error ?? info.error ?? null}
      message={dialogMessage(info, exported)}
      onCancel={() => setDismissed(true)}
      onConfirm={() => void confirm()}
      onSecondary={canExport ? () => void exportArchive() : undefined}
      open
      secondaryLabel={canExport ? '导出旧数据' : undefined}
      title={failed ? '旧数据归档失败' : '检测到旧版数据'}
    />
  )
}

function dialogMessage(info: LegacyDataInfo, exported: boolean): string {
  const totalFiles = info.sourceDirectories.reduce((total, source) => total + source.fileCount, 0)
  const totalBytes = info.sourceDirectories.reduce((total, source) => total + source.sizeBytes, 0)
  if (info.status === 'error') {
    return '软件未能完成旧数据归档。旧文件尚未清除，你可以稍后重试。'
  }
  const summary = `${info.sourceDirectories.length} 个目录、${totalFiles} 个文件，共 ${formatBytes(totalBytes)}`
  const exportedText = exported ? '归档已导出到你选择的位置。' : ''
  return `检测到旧版软件数据（${summary}）。新版本不会读取这些文件，软件已在用户数据目录中创建 ZIP 归档。旧数据将被清除；如果其中包含重要文件，请先点击“导出旧数据”，并将导出的 ZIP 发送给软件作者寻求数据导出帮助。${exportedText}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = units[0]
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024
    unit = units[index]
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
