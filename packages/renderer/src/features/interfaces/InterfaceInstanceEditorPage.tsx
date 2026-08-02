import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react'
import type { TaskProgressHandle, TaskProgressItem } from '@ls101/core-types'
import type {
  FieldLeaf,
  InterfaceAIGenerationResult,
  InterfaceDef,
  InterfaceInstanceDetails,
  InstanceDataError
} from '@ls101/interface-editor'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Braces,
  Check,
  Circle,
  Image as ImageIcon,
  LoaderCircle,
  Save,
  X
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { ResizableSplit } from '../../components/ui/ResizableSplit'
import { toast } from '../../components/ui/toast'
import { useInterfaceApplication } from './InterfaceApplicationContext'
import { errorMessage, flattenNodes } from './interfaceUi'
import shared from './InterfaceShared.module.css'
import styles from './InterfaceInstanceEditorPage.module.css'

interface LeafEntry {
  key: string
  leaf: FieldLeaf
  path: string[]
}

interface GenerationSession {
  handle: TaskProgressHandle<InterfaceAIGenerationResult> | null
  result: InterfaceAIGenerationResult | null
  startError: string | null
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
  const [generation, setGeneration] = useState<GenerationSession | null>(null)
  const [dirty, setDirty] = useState(false)
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
  }

  const updateValue = (varName: string, value: string): void => {
    setValues((current) => ({ ...current, [varName]: value }))
    setDirty(true)
  }

  const startGeneration = async (): Promise<void> => {
    setGeneration({ handle: null, result: null, startError: null })
    setError(null)
    setJsonErrors([])
    try {
      const handle = await application.instances.startAIGeneration(interfaceId, instanceId)
      setGeneration({ handle, result: null, startError: null })
      const result = await handle.completion
      setGeneration((current) => (current ? { ...current, result } : current))
      if (result.status === 'completed') {
        setDetails(result.instance)
        setValues(result.instance.instance.values)
        setDirty(false)
        toast.success('AI 生成内容已保存')
      } else if (result.status === 'invalid-response') {
        setJson(result.rawOutput)
        setJsonErrors(result.errors)
        setJsonOpen(true)
        setError('AI 返回内容未通过字段校验')
      } else if (result.status === 'failed') {
        setError(result.message)
      } else {
        toast.info('已取消 AI 生成')
      }
    } catch (reason) {
      const message = errorMessage(reason)
      setError(message)
      setGeneration((current) => (current ? { ...current, startError: message } : current))
    }
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
      toast.success('题组已保存')
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
      setJsonOpen(false)
      setJson('')
      toast.success('已从 JSON 更新题组')
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

  const aiBusy = generation !== null
  const busy = saving || aiBusy

  if (loading) return <div className={shared.loading}>正在加载题组...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton
            disabled={aiBusy}
            icon={ArrowLeft}
            label="返回题型详情"
            variant="ghost"
            onClick={leave}
          />
          <div>
            <h1>{name || '未命名题组'}</h1>
            <span>
              {definition?.name ?? '题组'} · {dirty ? '有未保存修改' : '编辑'}
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button icon={Braces} disabled={busy} onClick={() => setJsonOpen((open) => !open)}>
            JSON
          </Button>
          <Button
            icon={aiBusy ? LoaderCircle : Bot}
            disabled={!details || busy || dirty}
            title={dirty ? '请先保存当前修改' : undefined}
            onClick={() => void startGeneration()}
          >
            {aiBusy ? '生成中' : 'AI 生成'}
          </Button>
          <Button
            icon={Save}
            variant="primary"
            disabled={!details || busy || !dirty}
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
                disabled={busy}
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
                    disabled={busy}
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
                disabled={busy}
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
                <Button variant="ghost" disabled={busy} onClick={() => setJsonOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  disabled={!json.trim() || busy}
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
      {generation ? (
        <GenerationModal
          session={generation}
          onCancel={() => generation.handle?.cancel()}
          onFinish={() => setGeneration(null)}
        />
      ) : null}
    </div>
  )
}

function GenerationModal({
  session,
  onCancel,
  onFinish
}: {
  session: GenerationSession
  onCancel(): void
  onFinish(): void
}): JSX.Element {
  const finished = session.result !== null || session.startError !== null

  return (
    <div className={styles.generationBackdrop} role="presentation">
      <section
        aria-labelledby="generation-modal-title"
        aria-modal="true"
        className={styles.generationDialog}
        role="dialog"
      >
        <header className={styles.generationHeader}>
          <span className={styles.generationIcon}>
            <Bot aria-hidden="true" />
          </span>
          <div>
            <span>{finished ? '生成任务已结束' : '正在生成题组'}</span>
            <h2 id="generation-modal-title">AI 生成</h2>
          </div>
        </header>

        <div className={styles.generationBody}>
          {session.handle ? <GenerationProgress handle={session.handle} /> : null}
          {!session.handle && !finished ? (
            <div className={styles.generationStarting} role="status">
              <LoaderCircle aria-hidden="true" />
              <div>
                <strong>正在启动生成任务</strong>
                <span>正在读取模型配置并准备提示词...</span>
              </div>
            </div>
          ) : null}
          {finished ? <GenerationResult session={session} /> : null}
        </div>

        <footer className={styles.generationActions}>
          {finished ? (
            <Button icon={Check} variant="primary" onClick={onFinish}>
              完成
            </Button>
          ) : (
            <Button icon={X} disabled={!session.handle} variant="ghost" onClick={onCancel}>
              取消生成
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
}

function GenerationResult({ session }: { session: GenerationSession }): JSX.Element {
  let title = '生成任务启动失败'
  let message = session.startError ?? '无法启动生成任务'
  let status = 'error'

  if (session.result?.status === 'completed') {
    title = '生成完成'
    message = '生成内容已通过校验并保存到当前题组。'
    status = 'success'
  } else if (session.result?.status === 'invalid-response') {
    title = '生成内容未通过校验'
    message = `发现 ${session.result.errors.length} 个字段错误，可点击完成后在 JSON 面板中检查。`
  } else if (session.result?.status === 'failed') {
    title = '生成失败'
    message = session.result.message
  } else if (session.result?.status === 'cancelled') {
    title = '生成已取消'
    message = '任务已停止，当前题组内容没有被生成结果覆盖。'
    status = 'cancelled'
  }

  return (
    <div className={styles.generationResult} data-status={status} role="status">
      {status === 'success' ? <Check aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
      <div>
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
    </div>
  )
}

function GenerationProgress({
  handle
}: {
  handle: TaskProgressHandle<InterfaceAIGenerationResult>
}): JSX.Element {
  const snapshot = useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot)

  return (
    <section aria-label="AI 生成进度" className={styles.generationProgress}>
      <ol>
        {snapshot.items.map((item) => (
          <li data-status={item.status} key={item.id}>
            <ProgressIcon item={item} />
            <div>
              <strong>{item.label}</strong>
              {item.log?.content ? <pre>{item.log.content}</pre> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function ProgressIcon({ item }: { item: TaskProgressItem }): JSX.Element {
  if (item.status === 'completed') return <Check aria-hidden="true" />
  if (item.status === 'running') return <LoaderCircle aria-hidden="true" />
  return <Circle aria-hidden="true" />
}
