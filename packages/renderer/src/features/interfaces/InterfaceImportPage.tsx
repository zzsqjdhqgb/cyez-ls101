import { useMemo, useState, type JSX } from 'react'
import { ArrowLeft, CheckCircle2, Download, PackageCheck, XCircle } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { InterfaceImportSession } from '@ls101/interface-editor'
import { Button } from '../../components/ui/Button'
import { toast } from '../../components/ui/toast'
import { errorMessage } from './interfaceUi'
import styles from './InterfaceTransferPage.module.css'

export function InterfaceImportPage(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const session = (location.state as { session?: InterfaceImportSession } | null)?.session
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        session?.preview.instances
          .filter((item) => item.status === 'available')
          .map((item) => item.instanceId)
      )
  )
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = session?.preview
  const availableCount = useMemo(
    () => preview?.instances.filter((item) => item.status === 'available').length ?? 0,
    [preview]
  )

  if (!session || !preview) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <h1>没有待导入的题型文件</h1>
          <Button icon={ArrowLeft} onClick={() => navigate('/interfaces')}>
            返回题型库
          </Button>
        </div>
      </div>
    )
  }

  const cancel = (): void => {
    session.cancel()
    navigate('/interfaces')
  }

  const commit = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      await session.commit({ mode: 'selected', instanceIds: [...selected] })
      toast.success('题型已导入')
      navigate('/interfaces')
    } catch (reason) {
      setError(errorMessage(reason))
      setWorking(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>题型库 / 导入题型</p>
          <h1>审查题型文件</h1>
          <p>{preview.filename}</p>
        </div>
        <Button icon={ArrowLeft} variant="ghost" onClick={cancel}>
          取消导入
        </Button>
      </header>
      <main className={styles.body}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <section className={styles.card}>
          <dl className={styles.summary}>
            <div>
              <dt>题型</dt>
              <dd>{preview.interface.name}</dd>
            </div>
            <div>
              <dt>题型身份</dt>
              <dd>{preview.builtin ? `内置题型 · ${preview.builtin.builtinKey}` : '用户题型'}</dd>
            </div>
            <div>
              <dt>可导入题组</dt>
              <dd>{availableCount}</dd>
            </div>
          </dl>
          <div className={styles.toolbar}>
            <h2>文件内的题组</h2>
            <span>已选择 {selected.size} 个</span>
          </div>
          <div className={styles.list}>
            {preview.instances.map((item) => {
              const disabled = item.status !== 'available'
              const icon =
                item.status === 'available'
                  ? CheckCircle2
                  : item.status === 'existing'
                    ? PackageCheck
                    : XCircle
              const Icon = icon
              return (
                <label
                  className={styles.row}
                  data-disabled={disabled || undefined}
                  key={item.instanceId}
                >
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={selected.has(item.instanceId)}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current)
                        if (next.has(item.instanceId)) next.delete(item.instanceId)
                        else next.add(item.instanceId)
                        return next
                      })
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.assetFilenames.length
                        ? `包含 ${item.assetFilenames.length} 个资源文件`
                        : '不包含图片资源'}
                    </small>
                  </span>
                  <span
                    className={styles.status}
                    data-kind={
                      item.status === 'available'
                        ? 'available'
                        : item.status === 'existing'
                          ? 'existing'
                          : 'conflict'
                    }
                  >
                    <Icon size={16} aria-hidden="true" /> {item.reason ?? '可以导入'}
                  </span>
                </label>
              )
            })}
          </div>
        </section>
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={cancel}>
            取消
          </Button>
          <Button
            icon={Download}
            variant="primary"
            disabled={working || selected.size === 0}
            onClick={() => void commit()}
          >
            {working ? '正在导入...' : '导入选中的题组'}
          </Button>
        </footer>
      </main>
    </div>
  )
}
