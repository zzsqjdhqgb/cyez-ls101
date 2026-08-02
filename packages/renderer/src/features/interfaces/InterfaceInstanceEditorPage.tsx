import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  FieldLeaf,
  InterfaceDef,
  InterfaceInstanceDetails,
  InstanceDataError
} from '@ls101/interface-editor'
import { AlertCircle, ArrowLeft, Bot, Braces, Check, Image as ImageIcon, Save } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { ResizableSplit } from '../../components/ui/ResizableSplit'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage, flattenNodes } from './interfaceUi'
import shared from './InterfaceShared.module.css'
import styles from './InterfaceInstanceEditorPage.module.css'

interface LeafEntry {
  key: string
  leaf: FieldLeaf
  path: string[]
}

export function InterfaceInstanceEditorPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const { interfaceId = '', instanceId = '' } = useParams()
  const [definition, setDefinition] = useState<InterfaceDef | null>(null)
  const [details, setDetails] = useState<InterfaceInstanceDetails | null>(null)
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [json, setJson] = useState('')
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonErrors, setJsonErrors] = useState<readonly InstanceDataError[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)

  useEffect(() => {
    let active = true
    void Promise.all([
      application.published.get(interfaceId),
      application.instances.get(interfaceId, instanceId)
    ])
      .then(([published, instance]) => {
        if (!active) return
        setDefinition(published?.definition ?? null)
        setDetails(instance)
        setName(instance?.instance.name ?? '')
        setValues(instance?.instance.values ?? {})
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
  }, [application, interfaceId, instanceId])

  const leaves = useMemo<LeafEntry[]>(() => {
    if (!definition) return []
    return flattenNodes(definition.fields)
      .filter((entry): entry is typeof entry & { node: FieldLeaf } => entry.node.type !== 'group')
      .map(({ key, node, path }) => ({ key, leaf: node, path }))
  }, [definition])

  const updateName = (next: string): void => {
    setName(next)
    setDirty(true)
    setStatus(null)
  }

  const updateValue = (varName: string, value: string): void => {
    setValues((current) => ({ ...current, [varName]: value }))
    setDirty(true)
    setStatus(null)
  }

  const save = async (): Promise<void> => {
    if (!details) return
    setSaving(true)
    setError(null)
    try {
      const saved = await application.instances.save(interfaceId, instanceId, { name, values })
      setDetails(saved)
      setValues(saved.instance.values)
      setDirty(false)
      setStatus('已保存')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const replaceJson = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    setJsonErrors([])
    try {
      const result = await application.instances.replaceFromJson(interfaceId, instanceId, json)
      if (result.status === 'invalid-json') {
        setJsonErrors(result.errors)
        return
      }
      setDetails(result.instance)
      setValues(result.instance.instance.values)
      setDirty(false)
      setStatus('已从 JSON 更新')
      setJsonOpen(false)
      setJson('')
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  const leave = (): void => {
    if (dirty) {
      setConfirmLeave(true)
      return
    }
    navigate(`/interfaces/${encodeURIComponent(interfaceId)}`)
  }

  if (loading) return <div className={shared.loading}>正在加载题组...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton icon={ArrowLeft} label="返回题型详情" variant="ghost" onClick={leave} />
          <div>
            <h1>{name || '未命名题组'}</h1>
            <span>
              {definition?.name ?? '题组'} · {dirty ? '有未保存修改' : status || '编辑'}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button icon={Braces} onClick={() => setJsonOpen((open) => !open)}>
            JSON
          </Button>
          <Button icon={Bot} disabled title="AI 引擎尚未配置">
            AI 生成
          </Button>
          <Button
            icon={Save}
            variant="primary"
            disabled={!details || saving || !dirty}
            onClick={() => void save()}
          >
            保存
          </Button>
        </div>
      </header>

      {!details || !definition ? (
        <main className={styles.missing}>题组不存在</main>
      ) : (
        <ResizableSplit
          className={styles.workspace}
          initialSize={560}
          minFirst={360}
          minSecond={320}
          label="调整题组字段与 JSON 面板宽度"
        >
          <section className={styles.formPane}>
            {error ? (
              <div className={shared.notice} role="alert">
                <AlertCircle aria-hidden="true" />
                <span>{error}</span>
              </div>
            ) : null}

            <div className={styles.nameField}>
              <label htmlFor="instance-name">题组名称</label>
              <input
                id="instance-name"
                value={name}
                onChange={(event) => updateName(event.target.value)}
                placeholder="未命名题组"
              />
            </div>

            <div className={styles.fieldHeader}>
              <div>
                <h2>内容字段</h2>
                <span>{leaves.length} 个变量</span>
              </div>
              {!dirty && status ? (
                <span className={styles.savedStatus}>
                  <Check aria-hidden="true" />
                  {status}
                </span>
              ) : null}
            </div>

            <div className={styles.fields}>
              {leaves.map(({ key, leaf, path }) => (
                <label className={styles.valueField} key={path.join('.')}>
                  <span className={styles.valueHeading}>
                    <span>
                      {leaf.type === 'image' ? <ImageIcon aria-hidden="true" /> : null}
                      <strong>{key}</strong>
                      <code>[@{leaf.varName}]</code>
                    </span>
                    <small>{path.slice(0, -1).join(' / ')}</small>
                  </span>
                  <span className={styles.description}>{leaf.description}</span>
                  <textarea
                    rows={leaf.type === 'image' ? 3 : 5}
                    value={values[leaf.varName] ?? ''}
                    onChange={(event) => updateValue(leaf.varName, event.target.value)}
                    placeholder={leaf.example}
                  />
                </label>
              ))}
            </div>
          </section>

          {jsonOpen ? (
            <aside className={styles.jsonPane} aria-label="JSON 覆盖">
              <header>
                <div>
                  <h2>JSON 覆盖</h2>
                  <span>按题型字段结构替换全部值</span>
                </div>
              </header>
              <textarea
                aria-label="JSON 内容"
                value={json}
                onChange={(event) => setJson(event.target.value)}
                placeholder={'{\n  "section": {\n    "question": "..."\n  }\n}'}
                spellCheck={false}
              />
              {jsonErrors.length ? (
                <div className={styles.jsonErrors} role="alert">
                  {jsonErrors.map((item, index) => (
                    <span key={`${item.path}-${index}`}>
                      {item.path || '$'}：{item.message}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className={styles.jsonActions}>
                <Button variant="ghost" onClick={() => setJsonOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  disabled={!json.trim() || saving}
                  onClick={() => void replaceJson()}
                >
                  覆盖全部值
                </Button>
              </div>
            </aside>
          ) : null}
        </ResizableSplit>
      )}
      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate(`/interfaces/${encodeURIComponent(interfaceId)}`)}
      />
    </div>
  )
}
