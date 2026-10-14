import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AIRouterIndexTtsRuntimeStatus } from '@ls101/airouter/shared'
import { CheckCircle2, Cpu, Download, Package, Trash2, X } from 'lucide-react'
import type { AIRouterApplication } from './AIRouterApplication'
import { airouterApplication } from './AIRouterApplication'
import {
  AIRouterOperationFeedback,
  AIRouterPageError,
  AIRouterPageLoading,
  type AIRouterFeedbackValue
} from './AIRouterFeedback'
import { formatAIRouterError } from './airouterError'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { SettingsContent, SettingsSection } from '../../components/settings/SettingsContent'
import { toast } from '../../components/ui/toast'
import styles from './AIRouterSettingsPage.module.css'

const PROGRESS_POLL_MS = 500

export function AIRouterIndexTtsRuntimeSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [status, setStatus] = useState<AIRouterIndexTtsRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<AIRouterFeedbackValue | undefined>()
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setStatus(await application.getIndexTtsRuntimeStatus())
    } catch (reason) {
      setError(formatAIRouterError(reason, '无法加载 Index TTS 运行时状态'))
    } finally {
      setLoading(false)
    }
  }, [application])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Refresh download progress while an install is running (including one started elsewhere).
  const installing = status?.state === 'installing'
  useEffect(() => {
    if (!installing) return
    const timer = window.setInterval(() => {
      void application
        .getIndexTtsRuntimeStatus()
        .then(setStatus)
        .catch(() => undefined)
    }, PROGRESS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [application, installing])

  const install = async (): Promise<void> => {
    setFeedback(undefined)
    setStatus((current: AIRouterIndexTtsRuntimeStatus | null) =>
      current ? { ...current, state: 'installing' } : current
    )
    try {
      setStatus(await application.installIndexTtsRuntime())
      toast.success('Index TTS 运行时已安装')
    } catch (reason) {
      setFeedback({ kind: 'error', text: formatAIRouterError(reason, 'Index TTS 运行时下载失败') })
      await load()
    }
  }

  const cancel = async (): Promise<void> => {
    try {
      await application.cancelIndexTtsRuntimeInstall()
    } catch (reason) {
      setFeedback({ kind: 'error', text: formatAIRouterError(reason, '取消下载失败') })
    }
  }

  const remove = async (): Promise<void> => {
    setBusy(true)
    setDeleteError(null)
    try {
      await application.removeIndexTtsRuntime()
      setDeleteConfirmationOpen(false)
      await load()
      toast.success('Index TTS 运行时已删除')
    } catch (reason) {
      setDeleteError(formatAIRouterError(reason, 'Index TTS 运行时删除失败'))
    } finally {
      setBusy(false)
    }
  }

  if (loading && !status) return <AIRouterPageLoading message="正在加载 Index TTS 运行时状态..." />
  if (!status) {
    return (
      <AIRouterPageError
        message={error ?? '无法加载 Index TTS 运行时状态'}
        onRetry={() => void load()}
        retrying={loading}
        title="无法加载 Index TTS 运行时状态"
      />
    )
  }

  const installed = status.state === 'installed'
  const unsupported = status.state === 'unsupported'
  const percent = status.totalBytes
    ? Math.min(100, Math.floor((status.downloadedBytes / status.totalBytes) * 100))
    : 0
  return (
    <SettingsContent>
      <SettingsSection
        title="Index TTS 运行时"
        description="按需下载的 Index TTS 本地语音合成运行时，包含模型和 CUDA 加速推理引擎。需要已安装兼容的 NVIDIA 显卡驱动。"
      >
        <div className={styles.packageItem}>
          {installed ? (
            <CheckCircle2 aria-hidden="true" className={styles.packageIcon} />
          ) : unsupported ? (
            <Cpu aria-hidden="true" className={styles.packageIcon} />
          ) : (
            <Package aria-hidden="true" className={styles.packageIcon} />
          )}
          <span className={styles.packageText}>
            <span className={styles.packageTitle}>
              Index TTS 运行时
              <span>v{status.version}</span>
            </span>
            <span className={styles.providerMeta}>
              <span>{stateLabel(status)}</span>
              <span>{status.platform}</span>
              {!unsupported ? <span>{status.fileCount} 个文件</span> : null}
              {!unsupported ? <span>{formatBytes(status.totalBytes)}</span> : null}
            </span>
          </span>
          {unsupported ? null : installing ? (
            <Button icon={X} onClick={() => void cancel()}>
              取消下载
            </Button>
          ) : installed ? (
            <button
              aria-label="删除 Index TTS 运行时"
              className={styles.removeModel}
              disabled={busy}
              onClick={() => {
                setDeleteError(null)
                setDeleteConfirmationOpen(true)
              }}
              title="删除 Index TTS 运行时"
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : (
            <Button icon={Download} variant="primary" onClick={() => void install()}>
              下载并安装
            </Button>
          )}
        </div>
        {installing ? (
          <div className={styles.runtimeProgress}>
            <progress
              aria-label="Index TTS 运行时下载进度"
              max={status.totalBytes || 1}
              value={status.downloadedBytes}
            />
            <span>
              {percent}% · {formatBytes(status.downloadedBytes)} / {formatBytes(status.totalBytes)}
            </span>
          </div>
        ) : null}
        <AIRouterOperationFeedback value={feedback} />
        {!installing && !feedback && status.lastError ? (
          <AIRouterOperationFeedback
            value={{ kind: 'error', text: `上次下载失败：${status.lastError}` }}
          />
        ) : null}
        {unsupported ? (
          <div className={styles.localPackagePrompt}>
            <Cpu aria-hidden="true" />
            <span>当前平台（{status.platform}）没有可用的 Index TTS 运行时。</span>
          </div>
        ) : null}
      </SettingsSection>
      <ConfirmModal
        busy={busy}
        closeOnConfirm={false}
        confirmLabel="删除运行时"
        danger
        error={deleteError}
        message="将删除已下载的 Index TTS 运行时文件（包含模型和推理引擎）。需要重新下载后才能继续使用本地 Index TTS 语音合成。"
        open={deleteConfirmationOpen}
        title="删除 Index TTS 运行时？"
        onCancel={() => {
          setDeleteConfirmationOpen(false)
          setDeleteError(null)
        }}
        onConfirm={() => void remove()}
      />
    </SettingsContent>
  )
}

function stateLabel(status: AIRouterIndexTtsRuntimeStatus): string {
  switch (status.state) {
    case 'installed':
      return '已安装'
    case 'installing':
      return '正在下载'
    case 'unsupported':
      return '当前平台不支持'
    default:
      return '未安装'
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
