import { useCallback, useEffect, useState, type JSX } from 'react'
import { CheckCircle2, Download, Package, Trash2, Upload } from 'lucide-react'
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

export function AIRouterPronunciationSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [status, setStatus] = useState<Awaited<
    ReturnType<AIRouterApplication['getPronunciationExtensionStatus']>
  > | null>(null)
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
      setStatus(await application.getPronunciationExtensionStatus())
    } catch (reason) {
      setError(formatAIRouterError(reason, '无法加载 AI 语音评测扩展状态'))
    } finally {
      setLoading(false)
    }
  }, [application])

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const importExtension = async (): Promise<void> => {
    setBusy(true)
    setFeedback(undefined)
    try {
      const result = await application.importPronunciationExtension()
      if (!result) return
      await load()
      toast.success('AI 语音评测扩展包已导入')
    } catch (reason) {
      setFeedback({ kind: 'error', text: formatAIRouterError(reason, '扩展包导入失败') })
    } finally {
      setBusy(false)
    }
  }

  const deleteExtension = async (): Promise<void> => {
    setBusy(true)
    setDeleteError(null)
    try {
      await application.deletePronunciationExtension()
      setDeleteConfirmationOpen(false)
      await load()
      toast.success('AI 语音评测扩展包已删除')
    } catch (reason) {
      setDeleteError(formatAIRouterError(reason, '扩展包删除失败'))
    } finally {
      setBusy(false)
    }
  }

  if (loading || !status) {
    return error ? (
      <AIRouterPageError
        message={error}
        onRetry={() => void load()}
        retrying={loading}
        title="无法加载 AI 语音评测扩展状态"
      />
    ) : (
      <AIRouterPageLoading message="正在加载 AI 语音评测扩展状态..." />
    )
  }

  const imported = status.state === 'imported'
  return (
    <SettingsContent>
      <SettingsSection
        title="AI 语音评测"
        description="AI 语音评测由应用声明的扩展包提供，不支持切换后端。"
      >
        <div className={styles.packageItem}>
          {imported ? (
            <CheckCircle2 aria-hidden="true" className={styles.packageIcon} />
          ) : (
            <Package aria-hidden="true" className={styles.packageIcon} />
          )}
          <span className={styles.packageText}>
            <span className={styles.packageTitle}>
              {status.name}
              <span>v{status.requiredVersion}</span>
            </span>
            <span className={styles.providerMeta}>
              <span>{imported ? '已导入' : '未导入'}</span>
              {imported && status.assetCount !== undefined ? (
                <span>{status.assetCount} 个资源</span>
              ) : null}
              {imported && status.totalBytes !== undefined ? (
                <span>{formatBytes(status.totalBytes)}</span>
              ) : null}
            </span>
          </span>
          {!imported ? (
            <Button
              icon={Upload}
              variant="primary"
              disabled={busy}
              onClick={() => void importExtension()}
            >
              导入扩展包
            </Button>
          ) : (
            <button
              aria-label={`删除扩展包 ${status.name}`}
              className={styles.removeModel}
              disabled={busy}
              onClick={() => {
                setDeleteError(null)
                setDeleteConfirmationOpen(true)
              }}
              title="删除扩展包"
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          )}
        </div>
        <AIRouterOperationFeedback value={feedback} />
        {!imported ? (
          <div className={styles.localPackagePrompt}>
            <Download aria-hidden="true" />
            <span>导入与应用要求版本匹配的扩展包后，固定阅读题的发音评测才可用。</span>
          </div>
        ) : null}
      </SettingsSection>
      <ConfirmModal
        busy={busy}
        closeOnConfirm={false}
        confirmLabel="删除扩展包"
        danger
        error={deleteError}
        message={`将删除“${status.name}”v${status.requiredVersion} 及其本地模型资源。删除后需要重新导入才能使用语音评测。`}
        open={deleteConfirmationOpen}
        title="删除 AI 语音评测扩展包？"
        onCancel={() => {
          setDeleteConfirmationOpen(false)
          setDeleteError(null)
        }}
        onConfirm={() => void deleteExtension()}
      />
    </SettingsContent>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
