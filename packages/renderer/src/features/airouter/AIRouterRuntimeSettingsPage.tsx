import { useCallback, useEffect, useState, type JSX } from 'react'
import type {
  AIRouterCudaRuntimeStatus,
  AIRouterIndexTtsRuntimeStatus,
  AIRouterQwenTtsCudaProbeResult
} from '@ls101/airouter/shared'
import { CheckCircle2, Cpu, Download, Package, TestTube2, Trash2, X } from 'lucide-react'
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

export function AIRouterRuntimeSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [cudaStatus, setCudaStatus] = useState<AIRouterCudaRuntimeStatus | null>(null)
  const [indexTtsStatus, setIndexTtsStatus] = useState<AIRouterIndexTtsRuntimeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cudaBusy, setCudaBusy] = useState(false)
  const [indexTtsBusy, setIndexTtsBusy] = useState(false)
  const [cudaFeedback, setCudaFeedback] = useState<AIRouterFeedbackValue | undefined>()
  const [indexTtsFeedback, setIndexTtsFeedback] = useState<AIRouterFeedbackValue | undefined>()
  const [probe, setProbe] = useState<AIRouterQwenTtsCudaProbeResult | null>(null)
  const [cudaDeleteConfirmationOpen, setCudaDeleteConfirmationOpen] = useState(false)
  const [cudaDeleteError, setCudaDeleteError] = useState<string | null>(null)
  const [indexTtsDeleteConfirmationOpen, setIndexTtsDeleteConfirmationOpen] = useState(false)
  const [indexTtsDeleteError, setIndexTtsDeleteError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [cuda, indexTts] = await Promise.all([
        application.getCudaRuntimeStatus(),
        application.getIndexTtsRuntimeStatus()
      ])
      setCudaStatus(cuda)
      setIndexTtsStatus(indexTts)
    } catch (reason) {
      setError(formatAIRouterError(reason, '无法加载运行时状态'))
    } finally {
      setLoading(false)
    }
  }, [application])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  // Refresh download progress while an install is running (including one started elsewhere).
  const cudaInstalling = cudaStatus?.state === 'installing'
  const indexTtsInstalling = indexTtsStatus?.state === 'installing'

  useEffect(() => {
    if (!cudaInstalling) return
    const timer = window.setInterval(() => {
      void application
        .getCudaRuntimeStatus()
        .then(setCudaStatus)
        .catch(() => undefined)
    }, PROGRESS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [application, cudaInstalling])

  useEffect(() => {
    if (!indexTtsInstalling) return
    const timer = window.setInterval(() => {
      void application
        .getIndexTtsRuntimeStatus()
        .then(setIndexTtsStatus)
        .catch(() => undefined)
    }, PROGRESS_POLL_MS)
    return () => window.clearInterval(timer)
  }, [application, indexTtsInstalling])

  const installCuda = async (): Promise<void> => {
    setCudaFeedback(undefined)
    setProbe(null)
    setCudaStatus((current) => (current ? { ...current, state: 'installing' } : current))
    try {
      setCudaStatus(await application.installCudaRuntime())
      toast.success('CUDA 运行时已安装')
    } catch (reason) {
      setCudaFeedback({ kind: 'error', text: formatAIRouterError(reason, 'CUDA 运行时下载失败') })
      await load()
    }
  }

  const cancelCuda = async (): Promise<void> => {
    try {
      await application.cancelCudaRuntimeInstall()
    } catch (reason) {
      setCudaFeedback({ kind: 'error', text: formatAIRouterError(reason, '取消下载失败') })
    }
  }

  const runProbe = async (): Promise<void> => {
    setCudaBusy(true)
    setCudaFeedback(undefined)
    try {
      setProbe(await application.probeQwenTtsCuda())
    } catch (reason) {
      setCudaFeedback({ kind: 'error', text: formatAIRouterError(reason, 'CUDA 检测失败') })
    } finally {
      setCudaBusy(false)
    }
  }

  const removeCuda = async (): Promise<void> => {
    setCudaBusy(true)
    setCudaDeleteError(null)
    try {
      await application.removeCudaRuntime()
      setCudaDeleteConfirmationOpen(false)
      setProbe(null)
      await load()
      toast.success('CUDA 运行时已删除')
    } catch (reason) {
      setCudaDeleteError(formatAIRouterError(reason, 'CUDA 运行时删除失败'))
    } finally {
      setCudaBusy(false)
    }
  }

  const installIndexTts = async (): Promise<void> => {
    setIndexTtsFeedback(undefined)
    setIndexTtsStatus((current: AIRouterIndexTtsRuntimeStatus | null) =>
      current ? { ...current, state: 'installing' } : current
    )
    try {
      setIndexTtsStatus(await application.installIndexTtsRuntime())
      toast.success('Index TTS 运行时已安装')
    } catch (reason) {
      setIndexTtsFeedback({
        kind: 'error',
        text: formatAIRouterError(reason, 'Index TTS 运行时下载失败')
      })
      await load()
    }
  }

  const cancelIndexTts = async (): Promise<void> => {
    try {
      await application.cancelIndexTtsRuntimeInstall()
    } catch (reason) {
      setIndexTtsFeedback({ kind: 'error', text: formatAIRouterError(reason, '取消下载失败') })
    }
  }

  const removeIndexTts = async (): Promise<void> => {
    setIndexTtsBusy(true)
    setIndexTtsDeleteError(null)
    try {
      await application.removeIndexTtsRuntime()
      setIndexTtsDeleteConfirmationOpen(false)
      await load()
      toast.success('Index TTS 运行时已删除')
    } catch (reason) {
      setIndexTtsDeleteError(formatAIRouterError(reason, 'Index TTS 运行时删除失败'))
    } finally {
      setIndexTtsBusy(false)
    }
  }

  if (loading && (!cudaStatus || !indexTtsStatus))
    return <AIRouterPageLoading message="正在加载运行时状态..." />
  if (!cudaStatus || !indexTtsStatus) {
    return (
      <AIRouterPageError
        message={error ?? '无法加载运行时状态'}
        onRetry={() => void load()}
        retrying={loading}
        title="无法加载运行时状态"
      />
    )
  }

  const cudaInstalled = cudaStatus.state === 'installed'
  const cudaUnsupported = cudaStatus.state === 'unsupported'
  const cudaPercent = cudaStatus.totalBytes
    ? Math.min(100, Math.floor((cudaStatus.downloadedBytes / cudaStatus.totalBytes) * 100))
    : 0

  const indexTtsInstalled = indexTtsStatus.state === 'installed'
  const indexTtsUnsupported = indexTtsStatus.state === 'unsupported'
  const indexTtsPercent = indexTtsStatus.totalBytes
    ? Math.min(100, Math.floor((indexTtsStatus.downloadedBytes / indexTtsStatus.totalBytes) * 100))
    : 0

  return (
    <SettingsContent>
      <SettingsSection
        title="CUDA 运行时"
        description="按需下载的 NVIDIA CUDA 运行时，供 Qwen3-TTS 等本地引擎使用 GPU 加速。未安装时本地引擎继续使用 CPU。需要已安装兼容的 NVIDIA 显卡驱动，无需安装完整 CUDA Toolkit。"
      >
        <div className={styles.packageItem}>
          {cudaInstalled ? (
            <CheckCircle2 aria-hidden="true" className={styles.packageIcon} />
          ) : cudaUnsupported ? (
            <Cpu aria-hidden="true" className={styles.packageIcon} />
          ) : (
            <Package aria-hidden="true" className={styles.packageIcon} />
          )}
          <span className={styles.packageText}>
            <span className={styles.packageTitle}>
              CUDA 运行时
              <span>v{cudaStatus.version}</span>
            </span>
            <span className={styles.providerMeta}>
              <span>{stateLabelCuda(cudaStatus)}</span>
              <span>{cudaStatus.platform}</span>
              {!cudaUnsupported ? <span>{cudaStatus.fileCount} 个文件</span> : null}
              {!cudaUnsupported ? <span>{formatBytes(cudaStatus.totalBytes)}</span> : null}
            </span>
          </span>
          {cudaUnsupported ? null : cudaInstalling ? (
            <Button icon={X} onClick={() => void cancelCuda()}>
              取消下载
            </Button>
          ) : cudaInstalled ? (
            <>
              <Button icon={TestTube2} disabled={cudaBusy} onClick={() => void runProbe()}>
                检测 CUDA
              </Button>
              <button
                aria-label="删除 CUDA 运行时"
                className={styles.removeModel}
                disabled={cudaBusy}
                onClick={() => {
                  setCudaDeleteError(null)
                  setCudaDeleteConfirmationOpen(true)
                }}
                title="删除 CUDA 运行时"
                type="button"
              >
                <Trash2 aria-hidden="true" />
              </button>
            </>
          ) : (
            <Button icon={Download} variant="primary" onClick={() => void installCuda()}>
              下载并安装
            </Button>
          )}
        </div>
        {cudaInstalling ? (
          <div className={styles.runtimeProgress}>
            <progress
              aria-label="CUDA 运行时下载进度"
              max={cudaStatus.totalBytes || 1}
              value={cudaStatus.downloadedBytes}
            />
            <span>
              {cudaPercent}% · {formatBytes(cudaStatus.downloadedBytes)} /{' '}
              {formatBytes(cudaStatus.totalBytes)}
            </span>
          </div>
        ) : null}
        {probe ? (
          <AIRouterOperationFeedback
            value={
              probe.available
                ? {
                    kind: 'success',
                    text: `CUDA 可用：${probe.description ?? probe.device ?? 'GPU'}${
                      probe.memoryTotal ? `（显存 ${formatBytes(probe.memoryTotal)}）` : ''
                    }`
                  }
                : { kind: 'error', text: `CUDA 不可用：${probe.message ?? '未知原因'}` }
            }
          />
        ) : null}
        <AIRouterOperationFeedback value={cudaFeedback} />
        {!cudaInstalling && !cudaFeedback && cudaStatus.lastError ? (
          <AIRouterOperationFeedback
            value={{ kind: 'error', text: `上次下载失败：${cudaStatus.lastError}` }}
          />
        ) : null}
        {cudaUnsupported ? (
          <div className={styles.localPackagePrompt}>
            <Cpu aria-hidden="true" />
            <span>
              当前平台（{cudaStatus.platform}）没有可用的 CUDA 运行时，本地引擎将使用 CPU。
            </span>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="Index TTS 运行时"
        description="按需下载的 Index TTS 本地语音合成运行时，包含模型和 CUDA 加速推理引擎。需要已安装兼容的 NVIDIA 显卡驱动。"
      >
        <div className={styles.packageItem}>
          {indexTtsInstalled ? (
            <CheckCircle2 aria-hidden="true" className={styles.packageIcon} />
          ) : indexTtsUnsupported ? (
            <Cpu aria-hidden="true" className={styles.packageIcon} />
          ) : (
            <Package aria-hidden="true" className={styles.packageIcon} />
          )}
          <span className={styles.packageText}>
            <span className={styles.packageTitle}>
              Index TTS 运行时
              <span>v{indexTtsStatus.version}</span>
            </span>
            <span className={styles.providerMeta}>
              <span>{stateLabelIndexTts(indexTtsStatus)}</span>
              <span>{indexTtsStatus.platform}</span>
              {!indexTtsUnsupported ? <span>{indexTtsStatus.fileCount} 个文件</span> : null}
              {!indexTtsUnsupported ? <span>{formatBytes(indexTtsStatus.totalBytes)}</span> : null}
            </span>
          </span>
          {indexTtsUnsupported ? null : indexTtsInstalling ? (
            <Button icon={X} onClick={() => void cancelIndexTts()}>
              取消下载
            </Button>
          ) : indexTtsInstalled ? (
            <button
              aria-label="删除 Index TTS 运行时"
              className={styles.removeModel}
              disabled={indexTtsBusy}
              onClick={() => {
                setIndexTtsDeleteError(null)
                setIndexTtsDeleteConfirmationOpen(true)
              }}
              title="删除 Index TTS 运行时"
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : (
            <Button icon={Download} variant="primary" onClick={() => void installIndexTts()}>
              下载并安装
            </Button>
          )}
        </div>
        {indexTtsInstalling ? (
          <div className={styles.runtimeProgress}>
            <progress
              aria-label="Index TTS 运行时下载进度"
              max={indexTtsStatus.totalBytes || 1}
              value={indexTtsStatus.downloadedBytes}
            />
            <span>
              {indexTtsPercent}% · {formatBytes(indexTtsStatus.downloadedBytes)} /{' '}
              {formatBytes(indexTtsStatus.totalBytes)}
            </span>
          </div>
        ) : null}
        <AIRouterOperationFeedback value={indexTtsFeedback} />
        {!indexTtsInstalling && !indexTtsFeedback && indexTtsStatus.lastError ? (
          <AIRouterOperationFeedback
            value={{ kind: 'error', text: `上次下载失败：${indexTtsStatus.lastError}` }}
          />
        ) : null}
        {indexTtsUnsupported ? (
          <div className={styles.localPackagePrompt}>
            <Cpu aria-hidden="true" />
            <span>当前平台（{indexTtsStatus.platform}）没有可用的 Index TTS 运行时。</span>
          </div>
        ) : null}
      </SettingsSection>

      <ConfirmModal
        busy={cudaBusy}
        closeOnConfirm={false}
        confirmLabel="删除运行时"
        danger
        error={cudaDeleteError}
        message="将删除已下载的 CUDA 运行时文件，并停止正在运行的本地引擎。使用 CUDA 的 Provider 需要重新下载后才能继续使用 GPU。"
        open={cudaDeleteConfirmationOpen}
        title="删除 CUDA 运行时？"
        onCancel={() => {
          setCudaDeleteConfirmationOpen(false)
          setCudaDeleteError(null)
        }}
        onConfirm={() => void removeCuda()}
      />

      <ConfirmModal
        busy={indexTtsBusy}
        closeOnConfirm={false}
        confirmLabel="删除运行时"
        danger
        error={indexTtsDeleteError}
        message="将删除已下载的 Index TTS 运行时文件（包含模型和推理引擎）。需要重新下载后才能继续使用本地 Index TTS 语音合成。"
        open={indexTtsDeleteConfirmationOpen}
        title="删除 Index TTS 运行时？"
        onCancel={() => {
          setIndexTtsDeleteConfirmationOpen(false)
          setIndexTtsDeleteError(null)
        }}
        onConfirm={() => void removeIndexTts()}
      />
    </SettingsContent>
  )
}

function stateLabelCuda(status: AIRouterCudaRuntimeStatus): string {
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

function stateLabelIndexTts(status: AIRouterIndexTtsRuntimeStatus): string {
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
