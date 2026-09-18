import { useEffect, useRef, useState, type JSX } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { LegacyDataInfo } from '@ls101/core-types'
import { TitleBar } from '../../components/shell/TitleBar'
import { Button } from '../../components/ui/Button'
import styles from './LegacyDataMigrationPage.module.css'

interface LegacyDataMigrationPageProps {
  initialInfo?: LegacyDataInfo
  onComplete(): void
}

export function LegacyDataMigrationPage({
  initialInfo,
  onComplete
}: LegacyDataMigrationPageProps): JSX.Element {
  const bridge = window.legacyData
  const [info, setInfo] = useState<LegacyDataInfo | null>(initialInfo ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(() =>
    bridge ? null : '旧数据整理服务不可用，请重新启动应用。'
  )
  const [exported, setExported] = useState(false)
  const completed = useRef(false)

  useEffect(() => {
    let active = true
    if (!bridge || initialInfo) return () => undefined
    void bridge.getInfo().then(
      (loaded) => {
        if (active) setInfo(loaded)
      },
      (reason: unknown) => {
        if (active) {
          const message = errorMessage(reason)
          setInfo({
            status: 'error',
            archivePath: null,
            archiveSizeBytes: null,
            sourceDirectories: [],
            error: message
          })
          setError(message)
        }
      }
    )
    return () => {
      active = false
    }
  }, [bridge, initialInfo])

  useEffect(() => {
    if (!completed.current && info && (info.status === 'none' || info.status === 'cleaned')) {
      completed.current = true
      onComplete()
    }
  }, [info, onComplete])

  const exportArchive = async (): Promise<void> => {
    if (!bridge) return
    setBusy(true)
    setError(null)
    try {
      if (await bridge.exportArchive()) setExported(true)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const proceed = async (): Promise<void> => {
    if (!bridge || !info) return
    setBusy(true)
    setError(null)
    try {
      const next =
        info.status === 'error' || info.error ? await bridge.retry() : await bridge.cleanup()
      setInfo(next)
      if (next.status !== 'error') setExported(false)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(false)
    }
  }

  const failed = info?.status === 'error' || Boolean(info?.error) || (!info && error !== null)
  const archived = info?.status === 'archived'

  return (
    <div className={styles.screen}>
      <TitleBar closeDisabled sidebarCollapsed={false} sidebarVisible={false} />
      <main className={styles.content}>
        <section className={styles.panel} aria-labelledby="legacy-data-title">
          <StateIcon failed={failed} finished={archived} />
          <div className={styles.heading}>
            <h1 id="legacy-data-title">
              {failed ? '旧数据整理失败' : archived ? '旧数据已归档' : '正在整理旧数据'}
            </h1>
            <p>{stateMessage(info)}</p>
          </div>

          {archived ? <ArchiveSummary info={info} /> : null}

          {error || info?.error ? (
            <p className={styles.error} role="alert">
              <AlertCircle aria-hidden="true" />
              {error ?? info?.error}
            </p>
          ) : null}

          {exported ? (
            <p className={styles.success} role="status">
              <CheckCircle2 aria-hidden="true" />
              归档已导出到你选择的位置。
            </p>
          ) : null}

          {archived ? (
            <div className={styles.actions}>
              <Button
                disabled={busy}
                icon={Download}
                onClick={() => void exportArchive()}
                variant="secondary"
              >
                导出旧数据
              </Button>
              <Button
                disabled={busy}
                icon={busy ? LoaderCircle : Trash2}
                onClick={() => void proceed()}
                variant="danger"
              >
                {busy ? '正在清理' : '清理并继续'}
              </Button>
            </div>
          ) : failed ? (
            <Button
              className={styles.retryButton}
              disabled={busy || !bridge}
              icon={busy ? LoaderCircle : RefreshCw}
              onClick={() => void proceed()}
              variant="primary"
            >
              {busy ? '正在重试' : '重试'}
            </Button>
          ) : (
            <div className={styles.progress} role="status">
              <LoaderCircle aria-hidden="true" />
              <span>正在扫描、校验并归档，请保持应用运行。</span>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function StateIcon({ failed, finished }: { failed: boolean; finished: boolean }): JSX.Element {
  return (
    <span className={styles.stateIcon} data-state={failed ? 'failed' : finished ? 'done' : 'busy'}>
      {failed ? (
        <AlertCircle aria-hidden="true" />
      ) : finished ? (
        <Archive aria-hidden="true" />
      ) : (
        <LoaderCircle aria-hidden="true" />
      )}
    </span>
  )
}

function ArchiveSummary({ info }: { info: LegacyDataInfo }): JSX.Element {
  const totalFiles = info.sourceDirectories.reduce((total, source) => total + source.fileCount, 0)
  const totalBytes = info.sourceDirectories.reduce((total, source) => total + source.sizeBytes, 0)
  return (
    <dl className={styles.summary}>
      <div>
        <dt>旧数据目录</dt>
        <dd>{info.sourceDirectories.length} 个</dd>
      </div>
      <div>
        <dt>文件</dt>
        <dd>{totalFiles} 个</dd>
      </div>
      <div>
        <dt>数据量</dt>
        <dd>{formatBytes(totalBytes)}</dd>
      </div>
    </dl>
  )
}

function stateMessage(info: LegacyDataInfo | null): string {
  if (info?.status === 'error' || info?.error) {
    return '旧文件尚未清除。请解决下方问题后重试。'
  }
  if (!info || info.status === 'archiving' || info.status === 'cleaning') {
    return '软件正在安全归档旧版本留下的数据，完成前无法进入工作台。'
  }
  if (info.status === 'archived') {
    return '归档已经校验完成。你可以先导出备份，然后清理旧文件并继续。'
  }
  return '旧数据整理完成，正在初始化工作台。'
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
