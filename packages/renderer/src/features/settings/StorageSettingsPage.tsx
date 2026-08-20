import { HardDrive, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState, type JSX } from 'react'
import type { DataDirectoryCandidate, DataDirectoryInfo } from '@ls101/core-types'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import styles from './StorageSettingsPage.module.css'

export function StorageSettingsPage(): JSX.Element {
  const bridge = window.dataDirectory
  const [info, setInfo] = useState<DataDirectoryInfo | null>(null)
  const [candidate, setCandidate] = useState<DataDirectoryCandidate | null>(null)
  const [resettingDefault, setResettingDefault] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const load = async (): Promise<void> => {
    if (!bridge) {
      setError('数据目录服务不可用')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setInfo(await bridge.getInfo())
    } catch (loadError) {
      setError(errorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    if (!bridge) {
      queueMicrotask(() => {
        if (!active) return
        setError('数据目录服务不可用')
        setLoading(false)
      })
      return () => {
        active = false
      }
    }
    void bridge
      .getInfo()
      .then((loaded) => {
        if (active) setInfo(loaded)
      })
      .catch((loadError: unknown) => {
        if (active) setError(errorMessage(loadError))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [bridge])

  const choose = async (): Promise<void> => {
    if (!bridge) return
    setError(null)
    try {
      const selected = await bridge.choose()
      if (selected?.kind === 'current') return
      setResettingDefault(false)
      setCandidate(selected)
    } catch (chooseError) {
      setError(errorMessage(chooseError))
    }
  }

  const chooseDefault = async (): Promise<void> => {
    if (!bridge) return
    setError(null)
    try {
      const selected = await bridge.chooseDefault()
      if (selected.kind === 'current') return
      setResettingDefault(true)
      setCandidate(selected)
    } catch (chooseError) {
      setError(errorMessage(chooseError))
    }
  }

  const confirm = async (): Promise<void> => {
    if (!bridge || !candidate) return
    setBusy(true)
    setError(null)
    try {
      if (resettingDefault) await bridge.resetDefault()
      else if (candidate.kind === 'managed') await bridge.useExisting(candidate.path)
      else await bridge.migrate(candidate.path)
    } catch (migrationError) {
      setError(errorMessage(migrationError))
      setCandidate(null)
      setResettingDefault(false)
      setBusy(false)
    }
  }

  const deleteOld = async (): Promise<void> => {
    if (!bridge || !info.oldDataDirectory) return
    setBusy(true)
    setDeleteError(null)
    try {
      await bridge.deleteOld()
      setDeleteOpen(false)
      await load()
    } catch (deleteFailure) {
      setDeleteError(errorMessage(deleteFailure))
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <div className={styles.status} role={error ? 'alert' : undefined}>
        <span>{error ?? (loading ? '正在加载存储设置...' : '存储设置不可用')}</span>
        {error ? (
          <Button icon={RotateCcw} onClick={() => void load()}>
            重试
          </Button>
        ) : null}
      </div>
    )
  }

  const usesDefault = sameDisplayPath(info.currentPath, info.defaultPath)
  const usingExisting = candidate?.kind === 'managed'
  const oldDataDirectory = info.oldDataDirectory
  return (
    <SettingsContent>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <SettingsSection
        title="数据位置"
        description="模板、题库、配置、API 密钥和本地模型保存在这里。"
      >
        <SettingsRow
          label="当前目录"
          description={`${formatBytes(info.sizeBytes)} · ${usesDefault ? '默认位置' : '自定义位置'}`}
        >
          <div className={styles.directoryControl}>
            <code className={styles.path} title={info.currentPath}>
              {info.currentPath}
            </code>
            <Button
              disabled={busy || oldDataDirectory !== null}
              icon={HardDrive}
              title={oldDataDirectory ? '请先删除旧数据目录' : undefined}
              onClick={() => void choose()}
            >
              更改位置
            </Button>
            <Button
              disabled={busy || usesDefault || oldDataDirectory !== null}
              icon={RotateCcw}
              title={oldDataDirectory ? '请先删除旧数据目录' : undefined}
              variant="secondary"
              onClick={() => void chooseDefault()}
            >
              恢复默认位置
            </Button>
          </div>
        </SettingsRow>
        {oldDataDirectory ? (
          <SettingsRow
            label="旧数据目录"
            description={
              oldDataDirectory.sizeBytes === null
                ? '暂时不可访问'
                : `${formatBytes(oldDataDirectory.sizeBytes)} · ${oldDataDirectory.deleting ? '等待继续删除' : '迁移前的数据副本'}`
            }
          >
            <div className={styles.directoryControl}>
              <code className={styles.path} title={oldDataDirectory.path}>
                {oldDataDirectory.path}
              </code>
              <Button
                disabled={busy}
                icon={Trash2}
                variant="danger"
                onClick={() => {
                  setDeleteError(null)
                  setDeleteOpen(true)
                }}
              >
                {oldDataDirectory.deleting ? '继续删除' : '删除旧数据'}
              </Button>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsSection>
      <p className={styles.note}>
        Electron 缓存和可重新生成的 Qwen TTS 运行文件不会移动。旧数据删除前不能再次更改位置。
      </p>
      <ConfirmModal
        busy={busy}
        closeOnConfirm={false}
        confirmLabel={usingExisting ? '使用并重启' : '复制并重启'}
        error={null}
        message={confirmationMessage(candidate, info.sizeBytes)}
        onCancel={() => {
          setCandidate(null)
          setResettingDefault(false)
        }}
        onConfirm={() => void confirm()}
        open={candidate !== null}
        title={usingExisting ? '使用已有数据目录？' : '迁移数据目录？'}
      />
      <ConfirmModal
        busy={busy}
        closeOnConfirm={false}
        confirmLabel="永久删除"
        danger
        error={deleteError}
        message={
          oldDataDirectory
            ? `将永久删除“${oldDataDirectory.path}”及其中的全部数据。当前目录不受影响，此操作无法撤销。`
            : ''
        }
        onCancel={() => {
          setDeleteError(null)
          setDeleteOpen(false)
        }}
        onConfirm={() => void deleteOld()}
        open={deleteOpen && oldDataDirectory !== null}
        title="删除旧数据目录？"
      />
    </SettingsContent>
  )
}

function confirmationMessage(
  candidate: DataDirectoryCandidate | null,
  currentSizeBytes: number
): string {
  if (!candidate) return ''
  if (candidate.kind === 'managed') {
    return `应用将重启并直接使用“${candidate.path}”中的现有数据（${formatBytes(candidate.sizeBytes)}）。当前数据不会复制或删除。`
  }
  return `应用将重启，把当前的 ${formatBytes(currentSizeBytes)} 数据复制到“${candidate.path}”。复制成功前不会切换目录，原数据不会删除。`
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

function sameDisplayPath(left: string, right: string): boolean {
  const normalizedLeft = left.replaceAll('\\', '/')
  const normalizedRight = right.replaceAll('\\', '/')
  if (!isWindowsPlatform()) return normalizedLeft === normalizedRight
  return normalizedLeft.toLocaleLowerCase() === normalizedRight.toLocaleLowerCase()
}

function isWindowsPlatform(): boolean {
  return /windows/i.test(navigator.userAgent) || /^win/i.test(navigator.platform)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
