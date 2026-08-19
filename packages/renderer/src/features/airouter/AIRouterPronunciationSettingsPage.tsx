import { useCallback, useEffect, useState, type JSX } from 'react'
import { CheckCircle2, Download, Package, Upload } from 'lucide-react'
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
            <CheckCircle2 aria-label="扩展包已就绪" />
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
    </SettingsContent>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
