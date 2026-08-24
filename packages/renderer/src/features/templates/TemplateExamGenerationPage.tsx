import type { TaskProgressHandle } from '@ls101/core-types'
import type { TemplateDocument, TemplateInterfaceBinding } from '@ls101/template-editor'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  FileArchive,
  Library,
  LoaderCircle,
  RefreshCw,
  Volume2,
  X
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { IconButton } from '../../components/ui/IconButton'
import { TaskProgress } from '../../components/ui/TaskProgress'
import { toast } from '../../components/ui/toast'
import { useExamLibrary } from '../exams/ExamLibraryContext'
import {
  createExamGenerationSession,
  exportGeneratedExam,
  listSpeechGenerationSelections,
  type ExamGenerationResult,
  type ExamGenerationSession,
  type SpeechGenerationSelection
} from './TemplateExamGeneration'
import { useTemplateApplication } from './TemplateApplicationContext'
import { templateErrorMessage } from './templateUi'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'
import styles from './TemplateExamGenerationPage.module.css'

type GenerationPhase = 'settings' | 'running' | 'failed' | 'result'
type SpeechRole = 'default' | 'man' | 'woman'

interface SpeechChoice {
  providerConfigId: string
  modelId: string
  voiceId: string
}

type SpeechChoices = Record<SpeechRole, SpeechChoice>

type InstanceOptions = Record<
  string,
  Awaited<
    ReturnType<ReturnType<typeof useTemplateApplication>['browser']['listInterfaceInstances']>
  >
>

const SPEECH_ROLES: readonly { role: SpeechRole; label: string }[] = [
  { role: 'default', label: '默认音色' },
  { role: 'man', label: '男声音色' },
  { role: 'woman', label: '女声音色' }
]

export function TemplateExamGenerationPage(): JSX.Element {
  return <TemplateExamGenerationPageContent source="local" />
}

export function BuiltinTemplateExamGenerationPage(): JSX.Element {
  return <TemplateExamGenerationPageContent source="builtin" />
}

function TemplateExamGenerationPageContent({
  source
}: {
  source: 'local' | 'builtin'
}): JSX.Element {
  const { templateId = '' } = useParams()
  const application = useTemplateApplication()
  const examLibrary = useExamLibrary()
  const navigate = useNavigate()
  const [document, setDocument] = useState<TemplateDocument | null>(null)
  const [instances, setInstances] = useState<InstanceOptions>({})
  const [instanceSelections, setInstanceSelections] = useState<Record<string, string>>({})
  const [interfaceNames, setInterfaceNames] = useState<Record<string, string>>({})
  const [speechOptions, setSpeechOptions] = useState<SpeechGenerationSelection[]>([])
  const [speechChoices, setSpeechChoices] = useState<SpeechChoices | null>(null)
  const [examName, setExamName] = useState('')
  const [phase, setPhase] = useState<GenerationPhase>('settings')
  const [handle, setHandle] = useState<TaskProgressHandle<ExamGenerationResult> | null>(null)
  const [result, setResult] = useState<Extract<
    ExamGenerationResult,
    { status: 'completed' }
  > | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [added, setAdded] = useState(false)
  const [exported, setExported] = useState(false)
  const sessionRef = useRef<ExamGenerationSession | null>(null)
  const leavingProtected = phase === 'running' || (phase === 'result' && !added && !exported)
  const navigationGuard = useUnsavedChangesGuard(leavingProtected)

  useEffect(() => {
    let active = true
    const loadDocument = async (): Promise<TemplateDocument | null> => {
      if (source === 'local') return application.templates.get(templateId)
      const release = await application.builtinTemplates.get(templateId)
      return release
        ? {
            templateId: release.templateId,
            revision: 0,
            content: structuredClone(release.document.content),
            resources: structuredClone(release.document.resources),
            editorState: structuredClone(release.document.editorState)
          }
        : null
    }
    void Promise.all([
      loadDocument(),
      application.browser.listInterfaces(),
      listSpeechGenerationSelections()
    ])
      .then(async ([loadedDocument, manifests, speech]) => {
        if (!active) return
        if (!loadedDocument) throw new Error('试卷模板不存在')
        const instanceEntries = await Promise.all(
          loadedDocument.content.interfaces.map(
            async (requirement) =>
              [
                requirement.alias,
                await application.browser.listInterfaceInstances(requirement.interfaceId)
              ] as const
          )
        )
        if (!active) return
        const nextInstances = Object.fromEntries(instanceEntries)
        setDocument(loadedDocument)
        setExamName(loadedDocument.content.name)
        setInterfaceNames(
          Object.fromEntries(
            manifests.map((manifest) => [manifest.interfaceId, manifest.interfaceName])
          )
        )
        setInstances(nextInstances)
        setInstanceSelections(
          Object.fromEntries(
            loadedDocument.content.interfaces.map((requirement) => [
              requirement.alias,
              nextInstances[requirement.alias]?.[0]?.instanceId ?? ''
            ])
          )
        )
        setSpeechOptions(speech)
        setSpeechChoices(initialSpeechChoices(speech))
      })
      .catch((reason: unknown) => setError(templateErrorMessage(reason)))
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      sessionRef.current?.dispose()
    }
  }, [application, source, templateId])

  const requiresSpeech = document ? containsSpeech(document) : false
  const bindings: TemplateInterfaceBinding[] = useMemo(
    () =>
      (document?.content.interfaces ?? []).map((requirement) => ({
        alias: requirement.alias,
        interfaceId: requirement.interfaceId,
        instanceId: instanceSelections[requirement.alias] ?? ''
      })),
    [document, instanceSelections]
  )
  const missingInstances = bindings.some((binding) => !binding.instanceId)
  const speechComplete = speechChoices
    ? SPEECH_ROLES.every(({ role }) => completeSpeechChoice(speechChoices[role], speechOptions))
    : false
  const canStart =
    Boolean(document && examName.trim()) &&
    !loading &&
    !missingInstances &&
    (!requiresSpeech || speechComplete)

  const start = async (retry = false): Promise<void> => {
    if (!document || (!retry && !canStart)) return
    setError(null)
    setPhase('running')
    let session = sessionRef.current
    if (!session) {
      session = createExamGenerationSession({
        application,
        document,
        source,
        examName: examName.trim(),
        bindings,
        ...(requiresSpeech && speechChoices
          ? {
              speech: {
                default: speechChoices.default,
                man: speechChoices.man,
                woman: speechChoices.woman
              }
            }
          : {})
      })
      sessionRef.current = session
    }
    const nextHandle = session.start()
    setHandle(nextHandle)
    const outcome = await nextHandle.completion
    if (outcome.status === 'completed') {
      setResult(outcome)
      setPhase('result')
    } else if (outcome.status === 'failed') {
      setError(outcome.message)
      setPhase('failed')
    }
  }

  const close = (): void => {
    navigate(source === 'builtin' ? '/templates' : `/templates/${templateId}`)
  }

  const confirmLeave = (): void => {
    handle?.cancel()
    sessionRef.current?.dispose()
    navigationGuard.confirmNavigation()
  }

  const addToLibrary = async (): Promise<void> => {
    if (!result || adding || added) return
    setAdding(true)
    setError(null)
    try {
      const imported = await examLibrary.importArchive(result.archive)
      setAdded(true)
      if (imported.status === 'duplicate') toast.info('该试卷已经在试卷库中')
      else toast.success(`已将“${imported.record.title}”加入试卷库`)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setAdding(false)
    }
  }

  const exportFile = async (): Promise<void> => {
    if (!result || exporting) return
    setExporting(true)
    setError(null)
    try {
      if (await exportGeneratedExam(result.archive, examName.trim())) {
        setExported(true)
        toast.success('试卷文件已导出')
      }
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <main className={styles.loading}>
        <LoaderCircle aria-hidden="true" />
        <span>正在准备试卷生成设置...</span>
      </main>
    )
  }

  if (!document) {
    return (
      <main className={styles.missing}>
        <AlertCircle aria-hidden="true" />
        <h1>无法生成试卷</h1>
        <p>{error ?? '试卷模板不存在'}</p>
        <Button icon={ArrowLeft} onClick={close}>
          返回试卷模板
        </Button>
      </main>
    )
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <IconButton icon={ArrowLeft} label="返回试卷模板" onClick={close} />
          <div>
            <span>生成试卷</span>
            <h1>{examName.trim() || document.content.name || '未命名试卷'}</h1>
          </div>
        </div>
        <GenerationSteps phase={phase} />
        <IconButton icon={X} label="关闭生成试卷" onClick={close} />
      </header>

      {phase === 'settings' ? (
        <SettingsStage
          document={document}
          examName={examName}
          instances={instances}
          instanceSelections={instanceSelections}
          interfaceNames={interfaceNames}
          requiresSpeech={requiresSpeech}
          speechChoices={speechChoices}
          speechOptions={speechOptions}
          error={error}
          onExamNameChange={setExamName}
          onInstanceChange={(alias, instanceId) =>
            setInstanceSelections((current) => ({ ...current, [alias]: instanceId }))
          }
          onSpeechChange={(role, next) =>
            setSpeechChoices((current) => (current ? { ...current, [role]: next } : current))
          }
          onStart={() => void start()}
          canStart={canStart}
        />
      ) : null}

      {phase === 'running' || phase === 'failed' ? (
        <ProgressStage
          failed={phase === 'failed'}
          handle={handle}
          onClose={close}
          onRetry={() => void start(true)}
        />
      ) : null}

      {phase === 'result' && result ? (
        <ResultStage
          added={added}
          adding={adding}
          error={error}
          examName={examName.trim()}
          exported={exported}
          exporting={exporting}
          result={result}
          onAdd={() => void addToLibrary()}
          onClose={close}
          onExport={() => void exportFile()}
        />
      ) : null}

      <ConfirmModal
        confirmLabel={phase === 'running' ? '取消生成并离开' : '放弃结果并离开'}
        danger
        message={
          phase === 'running'
            ? '离开后会取消当前生成任务，并释放已经完成的临时音频。'
            : '这份试卷尚未加入试卷库或导出文件，离开后本次生成结果将丢失。'
        }
        open={navigationGuard.navigationPending}
        title={phase === 'running' ? '取消正在进行的试卷生成？' : '放弃尚未保存的试卷？'}
        onCancel={navigationGuard.cancelNavigation}
        onConfirm={confirmLeave}
      />
    </main>
  )
}

function GenerationSteps({ phase }: { phase: GenerationPhase }): JSX.Element {
  const active = phase === 'settings' ? 0 : phase === 'result' ? 2 : 1
  return (
    <ol aria-label="试卷生成阶段" className={styles.steps}>
      {['生成设置', '生成过程', '生成结果'].map((label, index) => (
        <li
          aria-current={index === active ? 'step' : undefined}
          data-complete={index < active || undefined}
          key={label}
        >
          <span>{index < active ? <Check aria-hidden="true" /> : index + 1}</span>
          <strong>{label}</strong>
        </li>
      ))}
    </ol>
  )
}

interface SettingsStageProps {
  document: TemplateDocument
  examName: string
  instances: InstanceOptions
  instanceSelections: Record<string, string>
  interfaceNames: Record<string, string>
  requiresSpeech: boolean
  speechChoices: SpeechChoices | null
  speechOptions: readonly SpeechGenerationSelection[]
  error: string | null
  canStart: boolean
  onExamNameChange(value: string): void
  onInstanceChange(alias: string, instanceId: string): void
  onSpeechChange(role: SpeechRole, choice: SpeechChoice): void
  onStart(): void
}

function SettingsStage(props: SettingsStageProps): JSX.Element {
  return (
    <div className={styles.settingsStage}>
      <div className={styles.settingsContent}>
        <section className={styles.settingSection} aria-labelledby="exam-basic-heading">
          <div className={styles.sectionHeading}>
            <span>01</span>
            <div>
              <h2 id="exam-basic-heading">试卷信息</h2>
              <p>{props.document.content.name}</p>
            </div>
          </div>
          <label className={styles.field}>
            <span>试卷名称</span>
            <input
              aria-label="试卷名称"
              autoFocus
              value={props.examName}
              onChange={(event) => props.onExamNameChange(event.target.value)}
            />
          </label>
        </section>

        <section className={styles.settingSection} aria-labelledby="exam-groups-heading">
          <div className={styles.sectionHeading}>
            <span>02</span>
            <div>
              <h2 id="exam-groups-heading">题组选择</h2>
              <p>{props.document.content.interfaces.length} 项内容</p>
            </div>
          </div>
          {props.document.content.interfaces.length === 0 ? (
            <div className={styles.emptySetting}>此模板不需要选择题组</div>
          ) : (
            <div className={styles.groupFields}>
              {props.document.content.interfaces.map((requirement) => (
                <label className={styles.field} key={requirement.alias}>
                  <span>{props.interfaceNames[requirement.interfaceId] ?? '未知题型'}</span>
                  <select
                    aria-label={`题型“${props.interfaceNames[requirement.interfaceId] ?? requirement.alias}”题组`}
                    value={props.instanceSelections[requirement.alias] ?? ''}
                    onChange={(event) =>
                      props.onInstanceChange(requirement.alias, event.target.value)
                    }
                  >
                    <option value="">请选择题组</option>
                    {(props.instances[requirement.alias] ?? []).map((instance) => (
                      <option key={instance.instanceId} value={instance.instanceId}>
                        {instance.name || '未命名题组'}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
        </section>

        <section className={styles.settingSection} aria-labelledby="exam-speech-heading">
          <div className={styles.sectionHeading}>
            <span>03</span>
            <div>
              <h2 id="exam-speech-heading">语音设置</h2>
              <p>{props.requiresSpeech ? '3 组必选音色' : '无需处理'}</p>
            </div>
          </div>
          {!props.requiresSpeech ? (
            <div className={styles.noSpeech}>
              <CheckCircle2 aria-hidden="true" />
              <span>此模板无需合成语音</span>
            </div>
          ) : props.speechChoices && props.speechOptions.length > 0 ? (
            <div className={styles.voiceGrid}>
              {SPEECH_ROLES.map(({ role, label }) => (
                <SpeechChoiceFields
                  choice={props.speechChoices?.[role] as SpeechChoice}
                  key={role}
                  label={label}
                  options={props.speechOptions}
                  onChange={(next) => props.onSpeechChange(role, next)}
                />
              ))}
            </div>
          ) : (
            <div className={styles.errorNotice} role="alert">
              <AlertCircle aria-hidden="true" />
              <span>没有可用的语音提供商、模型和音色，请先在设置中完成配置。</span>
            </div>
          )}
        </section>

        {props.error ? (
          <div className={styles.errorNotice} role="alert">
            {props.error}
          </div>
        ) : null}
      </div>
      <footer className={styles.stageFooter}>
        <div>
          <strong>{props.document.content.name}</strong>
          <span>Revision {props.document.revision}</span>
        </div>
        <Button
          icon={FileArchive}
          variant="primary"
          disabled={!props.canStart}
          onClick={props.onStart}
        >
          开始生成
        </Button>
      </footer>
    </div>
  )
}

function SpeechChoiceFields({
  choice,
  label,
  options,
  onChange
}: {
  choice: SpeechChoice
  label: string
  options: readonly SpeechGenerationSelection[]
  onChange(choice: SpeechChoice): void
}): JSX.Element {
  const providers = uniqueBy(options, (option) => option.providerConfigId)
  const models = uniqueBy(
    options.filter((option) => option.providerConfigId === choice.providerConfigId),
    (option) => option.modelId
  )
  const voices = uniqueBy(
    options.filter(
      (option) =>
        option.providerConfigId === choice.providerConfigId && option.modelId === choice.modelId
    ),
    (option) => option.voiceId
  )
  return (
    <fieldset className={styles.voiceCard}>
      <legend>
        <Volume2 aria-hidden="true" />
        {label}
      </legend>
      <label className={styles.compactField}>
        <span>提供商</span>
        <select
          aria-label={`${label}提供商`}
          value={choice.providerConfigId}
          onChange={(event) => {
            const first = options.find((option) => option.providerConfigId === event.target.value)
            onChange({
              providerConfigId: event.target.value,
              modelId: first?.modelId ?? '',
              voiceId: first?.voiceId ?? ''
            })
          }}
        >
          <option value="">请选择提供商</option>
          {providers.map((option) => (
            <option key={option.providerConfigId} value={option.providerConfigId}>
              {option.providerName}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.compactField}>
        <span>模型</span>
        <select
          aria-label={`${label}模型`}
          value={choice.modelId}
          onChange={(event) => {
            const first = options.find(
              (option) =>
                option.providerConfigId === choice.providerConfigId &&
                option.modelId === event.target.value
            )
            onChange({ ...choice, modelId: event.target.value, voiceId: first?.voiceId ?? '' })
          }}
        >
          <option value="">请选择模型</option>
          {models.map((option) => (
            <option key={option.modelId} value={option.modelId}>
              {option.modelId}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.compactField}>
        <span>音色</span>
        <select
          aria-label={`${label}音色`}
          value={choice.voiceId}
          onChange={(event) => onChange({ ...choice, voiceId: event.target.value })}
        >
          <option value="">请选择音色</option>
          {voices.map((option) => (
            <option key={option.voiceId} value={option.voiceId}>
              {option.voiceId}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  )
}

function ProgressStage({
  failed,
  handle,
  onClose,
  onRetry
}: {
  failed: boolean
  handle: TaskProgressHandle<ExamGenerationResult> | null
  onClose(): void
  onRetry(): void
}): JSX.Element {
  return (
    <section className={styles.progressStage} aria-labelledby="generation-progress-heading">
      <div className={styles.progressHeading}>
        <span className={styles.phaseIcon} data-failed={failed || undefined}>
          {failed ? <AlertCircle aria-hidden="true" /> : <LoaderCircle aria-hidden="true" />}
        </span>
        <div>
          <h2 id="generation-progress-heading">{failed ? '生成已中断' : '正在生成试卷'}</h2>
          <p>{failed ? '已完成的语音会在重试时继续复用' : '任务将按列表顺序执行'}</p>
        </div>
      </div>
      {handle ? <GenerationTaskProgress handle={handle} /> : null}
      {failed ? (
        <div className={styles.progressActions}>
          <Button onClick={onClose}>关闭</Button>
          <Button icon={RefreshCw} variant="primary" onClick={onRetry}>
            从中断位置重试
          </Button>
        </div>
      ) : null}
    </section>
  )
}

function GenerationTaskProgress({
  handle
}: {
  handle: TaskProgressHandle<ExamGenerationResult>
}): JSX.Element {
  const snapshot = useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot)
  return <TaskProgress label="试卷生成任务" items={snapshot.items} />
}

function ResultStage({
  added,
  adding,
  error,
  examName,
  exported,
  exporting,
  result,
  onAdd,
  onClose,
  onExport
}: {
  added: boolean
  adding: boolean
  error: string | null
  examName: string
  exported: boolean
  exporting: boolean
  result: Extract<ExamGenerationResult, { status: 'completed' }>
  onAdd(): void
  onClose(): void
  onExport(): void
}): JSX.Element {
  const pageCount = result.examPackage.examData.player.pages.length
  const resourceCount = Object.keys(result.examPackage.examData.resources).length
  return (
    <section className={styles.resultStage} aria-labelledby="generation-result-heading">
      <div className={styles.successMark}>
        <Check aria-hidden="true" />
      </div>
      <span className={styles.resultEyebrow}>试卷生成完成</span>
      <h2 id="generation-result-heading">{examName}</h2>
      <dl className={styles.resultFacts}>
        <div>
          <dt>页面</dt>
          <dd>{pageCount}</dd>
        </div>
        <div>
          <dt>资源</dt>
          <dd>{resourceCount}</dd>
        </div>
        <div>
          <dt>试卷包</dt>
          <dd>{formatBytes(result.archive.byteLength)}</dd>
        </div>
      </dl>
      {error ? (
        <div className={styles.errorNotice} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.resultActions}>
        <Button icon={X} onClick={onClose}>
          关闭
        </Button>
        <Button icon={Download} disabled={exporting} onClick={onExport}>
          {exporting ? '正在导出' : exported ? '再次导出文件' : '导出文件'}
        </Button>
        <Button
          icon={added ? Check : Library}
          variant="primary"
          disabled={adding || added}
          onClick={onAdd}
        >
          {adding ? '正在加入' : added ? '已加入试卷库' : '加入试卷库'}
        </Button>
      </div>
    </section>
  )
}

function initialSpeechChoices(options: readonly SpeechGenerationSelection[]): SpeechChoices | null {
  const first = options[0]
  if (!first) return null
  const choice = {
    providerConfigId: first.providerConfigId,
    modelId: first.modelId,
    voiceId: first.voiceId
  }
  return {
    default: { ...choice },
    man: { ...choice },
    woman: { ...choice }
  }
}

function completeSpeechChoice(
  choice: SpeechChoice,
  options: readonly SpeechGenerationSelection[]
): boolean {
  return options.some(
    (option) =>
      option.providerConfigId === choice.providerConfigId &&
      option.modelId === choice.modelId &&
      option.voiceId === choice.voiceId
  )
}

function containsSpeech(document: TemplateDocument): boolean {
  const frames = [document.content.root, ...document.resources.functions.map((item) => item.body)]
  const visit = (node: (typeof document.content.root)['children'][number]): boolean => {
    if (node.type === 'page') return node.timeline.some((step) => step.type === 'play')
    if (node.type === 'frame') return node.children.some(visit)
    return false
  }
  return frames.some((frame) => frame.children.some(visit))
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}
