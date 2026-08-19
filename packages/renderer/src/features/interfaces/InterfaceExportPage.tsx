import { useEffect, useState, type JSX } from 'react'
import { ArrowLeft, Download } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage } from './interfaceUi'
import styles from './InterfaceTransferPage.module.css'

interface ExportItem {
  instanceId: string
  name: string
  generatedAt: string
}

export function InterfaceExportPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const { interfaceId = '' } = useParams()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [builtinKey, setBuiltinKey] = useState<string | null>(null)
  const [items, setItems] = useState<ExportItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      application.published.get(interfaceId),
      application.published.listInstances(interfaceId)
    ])
      .then(([details, instances]) => {
        if (!active) return
        if (!details) throw new Error('题型不存在')
        setName(details.definition.name)
        setDescription(details.definition.description)
        setBuiltinKey(details.source.type === 'builtin' ? details.source.builtinKey : null)
        setItems(instances)
        setSelected(new Set(instances.map((item) => item.instanceId)))
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application, interfaceId])

  const toggle = (instanceId: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(instanceId)) next.delete(instanceId)
      else next.add(instanceId)
      return next
    })
  }

  const exportPackage = async (): Promise<void> => {
    setWorking(true)
    setError(null)
    try {
      const result = await application.transfer.export(interfaceId, {
        mode: 'selected',
        instanceIds: [...selected]
      })
      if (result.status === 'exported') {
        toast.success('题型已导出')
        navigate(`/interfaces/${encodeURIComponent(interfaceId)}`)
      }
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setWorking(false)
    }
  }

  if (loading) return <div className={styles.page}>正在准备导出内容...</div>

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>题型库 / 导出题型</p>
          <h1>选择要交付的题组</h1>
          <p>{description || '没有填写题型描述。'}</p>
        </div>
        <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate(-1)}>
          返回
        </Button>
      </header>
      <main className={styles.body}>
        {error ? <div className={styles.error}>{error}</div> : null}
        <section className={styles.card}>
          <dl className={styles.summary}>
            <div>
              <dt>题型</dt>
              <dd>{name}</dd>
            </div>
            <div>
              <dt>题组总数</dt>
              <dd>{items.length}</dd>
            </div>
            <div>
              <dt>题型身份</dt>
              <dd>{builtinKey ? `内置题型 · ${builtinKey}` : '用户题型'}</dd>
            </div>
          </dl>
          <div className={styles.toolbar}>
            <h2>题组</h2>
            <span>已选择 {selected.size} 个</span>
          </div>
          <div className={styles.list}>
            {items.length === 0 ? <p>当前题型没有题组。</p> : null}
            {items.map((item) => (
              <label className={styles.row} key={item.instanceId}>
                <input
                  type="checkbox"
                  checked={selected.has(item.instanceId)}
                  onChange={() => toggle(item.instanceId)}
                />
                <span>
                  <strong>{item.name}</strong>
                  <small>生成于 {new Date(item.generatedAt).toLocaleString()}</small>
                </span>
                <span className={styles.status}>包含全部题组资源</span>
              </label>
            ))}
          </div>
        </section>
        <footer className={styles.footer}>
          <Button variant="ghost" onClick={() => navigate(-1)}>
            取消
          </Button>
          <Button
            icon={Download}
            variant="primary"
            disabled={working || selected.size === 0}
            onClick={() => void exportPackage()}
          >
            {working ? '正在导出...' : '导出题型'}
          </Button>
        </footer>
      </main>
    </div>
  )
}
