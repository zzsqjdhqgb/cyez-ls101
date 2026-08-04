import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type JSX } from 'react'
import { imageClipboard } from '@ls101/clipboard/renderer'
import type { TaskProgressHandle, TaskProgressItem } from '@ls101/core-types'
import { fileDialog } from '@ls101/file-dialog/renderer'
import type {
  FieldLeaf,
  InterfaceAIGenerationResult,
  InterfaceDef,
  InterfaceImageProviderOption,
  InterfaceImageProviderSelection,
  InterfaceInstanceDetails,
  InstanceDataError
} from '@ls101/interface-editor'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Braces,
  Check,
  ClipboardPaste,
  Circle,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Save,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AIModelSelect,
  type AIModelOption,
  type AIModelSelection
} from '../../components/ai/AIModelSelect'
import { AIImageProviderSelect } from '../../components/ai/AIImageProviderSelect'
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

interface PendingImage {
  name: string
  data: Uint8Array
  previewUrl: string
}

type AuxiliaryPanel = 'json' | 'ai' | null

export function InterfaceInstanceEditorPage(): JSX.Element {
  const application = useInterfaceApplication()
  const navigate = useNavigate()
  const { interfaceId = '', instanceId = '' } = useParams()
  const [definition, setDefinition] = useState<InterfaceDef | null>(null)
  const [details, setDetails] = useState<InterfaceInstanceDetails | null>(null)
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>({})
  const [imagePrompts, setImagePrompts] = useState<Record<string, string>>({})
  const [pendingImages, setPendingImages] = useState<Record<string, PendingImage | null>>({})
  const [json, setJson] = useState('')
  const [panel, setPanel] = useState<AuxiliaryPanel>(null)
  const [jsonErrors, setJsonErrors] = useState<readonly InstanceDataError[]>([])
  const [modelOptions, setModelOptions] = useState<readonly AIModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<AIModelSelection | null>(null)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [imageProviderOptions, setImageProviderOptions] = useState<
    readonly InterfaceImageProviderOption[]
  >([])
  const [selectedImageProvider, setSelectedImageProvider] =
    useState<InterfaceImageProviderSelection | null>(null)
  const [imageProvidersLoading, setImageProvidersLoading] = useState(true)
  const [imageProvidersError, setImageProvidersError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generatingImage, setGeneratingImage] = useState<string | null>(null)
  const [generation, setGeneration] = useState<GenerationSession | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const modelLoadId = useRef(0)
  const imageProviderLoadId = useRef(0)
  const imageGenerationController = useRef<AbortController | null>(null)
  const previewUrls = useRef(new Set<string>())

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
        setImagePrompts(instance?.instance.imagePrompts ?? {})
      })
      .catch((reason: unknown) => {
        if (active) setError(errorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      modelLoadId.current += 1
    }
  }, [application, interfaceId, instanceId])

  useEffect(() => {
    const loadId = ++imageProviderLoadId.current
    const listProviders = application.instances.listImageGenerationProviders
    if (!listProviders) return
    void listProviders()
      .then((providers) => {
        if (loadId !== imageProviderLoadId.current) return
        setImageProviderOptions(providers)
        setSelectedImageProvider((current) =>
          current && findImageProvider(providers, current)
            ? current
            : providers[0]
              ? providerSelectionOf(providers[0])
              : null
        )
      })
      .catch((reason: unknown) => {
        if (loadId !== imageProviderLoadId.current) return
        setImageProviderOptions([])
        setSelectedImageProvider(null)
        setImageProvidersError(errorMessage(reason))
      })
      .finally(() => {
        if (loadId === imageProviderLoadId.current) setImageProvidersLoading(false)
      })
    return () => {
      imageProviderLoadId.current += 1
    }
  }, [application])

  useEffect(
    () => () => {
      for (const url of previewUrls.current) URL.revokeObjectURL(url)
      previewUrls.current.clear()
    },
    []
  )

  useEffect(() => () => imageGenerationController.current?.abort(), [])

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

  const updateImagePrompt = (varName: string, value: string): void => {
    setImagePrompts((current) => ({ ...current, [varName]: value }))
    setDirty(true)
  }

  const removeImage = (varName: string): void => {
    setPendingImages((current) => {
      const selected = current[varName]
      if (selected) {
        URL.revokeObjectURL(selected.previewUrl)
        previewUrls.current.delete(selected.previewUrl)
      }
      return { ...current, [varName]: null }
    })
    setDirty(true)
  }

  const discardAllPendingImages = (): void => {
    for (const selected of Object.values(pendingImages)) {
      if (!selected) continue
      URL.revokeObjectURL(selected.previewUrl)
      previewUrls.current.delete(selected.previewUrl)
    }
    setPendingImages({})
  }

  const stageImage = (varName: string, name: string, data: Uint8Array): void => {
    const previewUrl = URL.createObjectURL(new Blob([new Uint8Array(data)]))
    previewUrls.current.add(previewUrl)
    setPendingImages((current) => {
      const previous = current[varName]
      if (previous) {
        URL.revokeObjectURL(previous.previewUrl)
        previewUrls.current.delete(previous.previewUrl)
      }
      return {
        ...current,
        [varName]: { name, data: new Uint8Array(data), previewUrl }
      }
    })
    setDirty(true)
  }

  const chooseImageFile = async (varName: string): Promise<void> => {
    setError(null)
    try {
      const selected = await fileDialog.readBinary({
        title: '选择图片',
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
      })
      if (selected) stageImage(varName, selected.name, selected.data)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const chooseClipboardImage = async (varName: string): Promise<void> => {
    setError(null)
    try {
      const data = await imageClipboard.readImage()
      if (!data) {
        toast.info('剪贴板中没有图片')
        return
      }
      stageImage(varName, '剪贴板图片.png', data)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  const generateFieldImage = async (varName: string): Promise<void> => {
    const prompt = imagePrompts[varName]?.trim()
    if (!prompt) {
      toast.info('请先填写图片提示词')
      return
    }
    if (!selectedImageProvider) {
      toast.info('请先选择图像 Provider')
      return
    }
    setGeneratingImage(varName)
    setError(null)
    const controller = new AbortController()
    imageGenerationController.current = controller
    try {
      const data = await application.instances.generateImage(prompt, {
        signal: controller.signal,
        provider: selectedImageProvider
      })
      stageImage(varName, 'AI 生成图片', data)
      toast.success('图片已生成，请保存题组')
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
        setError(errorMessage(reason))
      }
    } finally {
      if (imageGenerationController.current === controller) {
        imageGenerationController.current = null
      }
      setGeneratingImage(null)
    }
  }

  const loadModels = async (): Promise<void> => {
    const loadId = ++modelLoadId.current
    setModelsLoading(true)
    setModelsError(null)
    try {
      const models = await application.instances.listAIGenerationModels()
      if (loadId !== modelLoadId.current) return
      setModelOptions(models)
      setSelectedModel((current) =>
        current &&
        models.some(
          (model) => model.providerId === current.providerId && model.modelId === current.modelId
        )
          ? current
          : models[0]
            ? { providerId: models[0].providerId, modelId: models[0].modelId }
            : null
      )
    } catch (reason) {
      if (loadId !== modelLoadId.current) return
      setModelOptions([])
      setSelectedModel(null)
      setModelsError(errorMessage(reason))
    } finally {
      if (loadId === modelLoadId.current) setModelsLoading(false)
    }
  }

  const toggleAIPanel = (): void => {
    if (panel === 'ai') {
      modelLoadId.current += 1
      setGeneration(null)
      setPanel(null)
      return
    }
    setPanel('ai')
    void loadModels()
  }

  const startGeneration = async (): Promise<void> => {
    if (!selectedModel) return
    if (hasImageFields && !selectedImageProvider) {
      setError('请先选择图像 Provider')
      return
    }
    setGeneration({ handle: null, result: null, startError: null })
    setError(null)
    setJsonErrors([])
    try {
      const handle = await application.instances.startAIGeneration(interfaceId, instanceId, {
        model: selectedModel,
        ...(hasImageFields && selectedImageProvider ? { imageProvider: selectedImageProvider } : {})
      })
      setGeneration({ handle, result: null, startError: null })
      const result = await handle.completion
      setGeneration((current) => (current ? { ...current, result } : current))
      if (result.status === 'completed') {
        discardAllPendingImages()
        setDetails(result.instance)
        setValues(result.instance.instance.values)
        setImagePrompts(result.instance.instance.imagePrompts ?? {})
        setDirty(false)
        toast.success('AI 生成内容已保存')
      } else if (result.status === 'invalid-response') {
        setJson(result.rawOutput)
        setJsonErrors(result.errors)
      } else if (result.status === 'cancelled') toast.info('已取消 AI 生成')
    } catch (reason) {
      const message = errorMessage(reason)
      setGeneration((current) => (current ? { ...current, startError: message } : current))
    }
  }

  const save = async (): Promise<void> => {
    if (!details) return
    setSaving(true)
    setError(null)
    try {
      const imageFiles = Object.fromEntries(
        Object.entries(pendingImages).map(([varName, selected]) => [
          varName,
          selected?.data ?? null
        ])
      )
      const saved = await application.instances.save(interfaceId, instanceId, {
        name,
        values,
        imagePrompts,
        imageFiles
      })
      discardAllPendingImages()
      setDetails(saved)
      setValues(saved.instance.values)
      setImagePrompts(saved.instance.imagePrompts ?? {})
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
      discardAllPendingImages()
      setDetails(result.instance)
      setValues(result.instance.instance.values)
      setImagePrompts(result.instance.instance.imagePrompts ?? {})
      setDirty(false)
      setPanel(null)
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

  const generationFinished = generation ? isGenerationFinished(generation) : false
  const generationRunning = generation !== null && !generationFinished
  const busy = saving || generationRunning || generatingImage !== null
  const hasImageFields = leaves.some(({ leaf }) => leaf.type === 'image')

  const finishGeneration = (): void => {
    const openJson = generation?.result?.status === 'invalid-response'
    setGeneration(null)
    setPanel(openJson ? 'json' : null)
  }

  if (loading) return <div className={shared.loading}>正在加载题组...</div>

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton
            disabled={generationRunning}
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
          <Button
            icon={Braces}
            disabled={saving || generationRunning}
            onClick={() => {
              setGeneration(null)
              setPanel((current) => (current === 'json' ? null : 'json'))
            }}
          >
            JSON
          </Button>
          <Button
            icon={generationRunning ? LoaderCircle : Bot}
            disabled={!details || saving || generationRunning || dirty}
            title={dirty ? '请先保存当前修改' : undefined}
            onClick={toggleAIPanel}
          >
            {generationRunning ? '生成中' : 'AI 生成'}
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
          label={`调整题组字段与${panel === 'ai' ? ' AI' : ' JSON'}面板宽度`}
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
              {leaves.map(({ key, leaf, path }) => {
                const imageEdited = Object.hasOwn(pendingImages, leaf.varName)
                const existingImageUrl = details.assetUrls[values[leaf.varName] ?? '']
                return (
                  <section className={styles.valueField} key={path.join('.')}>
                    <span className={styles.valueHeading}>
                      <span>
                        {leaf.type === 'image' ? <ImageIcon aria-hidden="true" /> : null}
                        <strong>{key}</strong>
                        <code>[@{leaf.varName}]</code>
                      </span>
                      <small>{path.slice(0, -1).join(' / ')}</small>
                    </span>
                    <span className={styles.description}>{leaf.description}</span>
                    {leaf.type === 'image' ? (
                      <ImageValueInput
                        disabled={busy}
                        existingUrl={imageEdited ? undefined : existingImageUrl}
                        fieldName={key}
                        pending={pendingImages[leaf.varName] ?? undefined}
                        prompt={imagePrompts[leaf.varName] ?? ''}
                        promptPlaceholder={leaf.example}
                        onChooseClipboard={() => void chooseClipboardImage(leaf.varName)}
                        onChooseFile={() => void chooseImageFile(leaf.varName)}
                        onCancelGenerate={() => imageGenerationController.current?.abort()}
                        onGenerate={() => void generateFieldImage(leaf.varName)}
                        onPromptChange={(value) => updateImagePrompt(leaf.varName, value)}
                        onRemove={() => removeImage(leaf.varName)}
                        generating={generatingImage === leaf.varName}
                        imageProviderOptions={imageProviderOptions}
                        imageProvider={selectedImageProvider}
                        imageProvidersLoading={imageProvidersLoading}
                        imageProvidersError={imageProvidersError}
                        onSelectImageProvider={setSelectedImageProvider}
                      />
                    ) : (
                      <textarea
                        aria-label={`${key} 内容`}
                        rows={5}
                        disabled={busy}
                        value={values[leaf.varName] ?? ''}
                        onChange={(event) => updateValue(leaf.varName, event.target.value)}
                        placeholder={leaf.example}
                      />
                    )}
                  </section>
                )
              })}
            </div>
          </section>

          {panel === 'json' ? (
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
                <Button variant="ghost" disabled={busy} onClick={() => setPanel(null)}>
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
          ) : panel === 'ai' ? (
            <AIGenerationPane
              dirty={dirty}
              modelsError={modelsError}
              modelsLoading={modelsLoading}
              modelOptions={modelOptions}
              imageProviderOptions={imageProviderOptions}
              selectedImageProvider={selectedImageProvider}
              imageProvidersLoading={imageProvidersLoading}
              imageProvidersError={imageProvidersError}
              hasImageFields={hasImageFields}
              selectedModel={selectedModel}
              session={generation}
              onCancel={() => generation?.handle?.cancel()}
              onClose={() => setPanel(null)}
              onFinish={finishGeneration}
              onRefresh={() => void loadModels()}
              onRetry={() => void startGeneration()}
              onSelectModel={setSelectedModel}
              onSelectImageProvider={setSelectedImageProvider}
              onStart={() => void startGeneration()}
            />
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

function ImageValueInput({
  disabled,
  existingUrl,
  fieldName,
  pending,
  prompt,
  promptPlaceholder,
  generating,
  onCancelGenerate,
  onChooseClipboard,
  onChooseFile,
  onGenerate,
  imageProviderOptions,
  imageProvider,
  imageProvidersLoading,
  imageProvidersError,
  onSelectImageProvider,
  onPromptChange,
  onRemove
}: {
  disabled: boolean
  existingUrl?: string
  fieldName: string
  pending?: PendingImage
  prompt: string
  promptPlaceholder: string
  generating: boolean
  onCancelGenerate(): void
  onChooseClipboard(): void
  onChooseFile(): void
  onGenerate(): void
  imageProviderOptions: readonly InterfaceImageProviderOption[]
  imageProvider: InterfaceImageProviderSelection | null
  imageProvidersLoading: boolean
  imageProvidersError: string | null
  onSelectImageProvider(value: InterfaceImageProviderSelection | null): void
  onPromptChange(value: string): void
  onRemove(): void
}): JSX.Element {
  const previewUrl = pending?.previewUrl ?? existingUrl

  return (
    <div className={styles.imageInput}>
      <label className={styles.imagePrompt}>
        <span>提示词</span>
        <textarea
          aria-label={`${fieldName}图片提示词`}
          rows={3}
          disabled={disabled}
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={promptPlaceholder}
        />
      </label>
      <div className={styles.imageAssetInput}>
        <span className={styles.imageInputLabel}>图片</span>
        <div className={styles.imagePicker}>
          <div className={styles.imagePreview} data-empty={!previewUrl}>
            {previewUrl ? (
              <img alt={`${fieldName}预览`} src={previewUrl} />
            ) : (
              <span>
                <ImageIcon aria-hidden="true" />
                尚未选择图片
              </span>
            )}
          </div>
          <div className={styles.imageProviderSelect}>
            <AIImageProviderSelect
              disabled={disabled || generating}
              error={imageProvidersError}
              label={`${fieldName}图像 Provider`}
              loading={imageProvidersLoading}
              options={imageProviderOptions}
              showLabel={false}
              value={imageProvider}
              onChange={onSelectImageProvider}
            />
          </div>
          <div className={styles.imagePickerFooter}>
            <span>{pending?.name ?? (existingUrl ? '已保存图片' : 'PNG、JPEG、GIF 或 WebP')}</span>
            <div>
              <Button icon={FolderOpen} size="small" disabled={disabled} onClick={onChooseFile}>
                选择文件
              </Button>
              <Button
                icon={generating ? X : WandSparkles}
                size="small"
                disabled={
                  generating
                    ? false
                    : disabled ||
                      !prompt.trim() ||
                      !imageProvider ||
                      imageProvidersLoading ||
                      Boolean(imageProvidersError)
                }
                onClick={generating ? onCancelGenerate : onGenerate}
              >
                {generating ? '取消生成' : '生成图片'}
              </Button>
              <Button
                icon={ClipboardPaste}
                size="small"
                disabled={disabled}
                onClick={onChooseClipboard}
              >
                从剪贴板读取
              </Button>
              {previewUrl ? (
                <IconButton
                  disabled={disabled}
                  icon={Trash2}
                  label="移除图片"
                  variant="danger"
                  onClick={onRemove}
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AIGenerationPane({
  dirty,
  modelsError,
  modelsLoading,
  modelOptions,
  imageProviderOptions,
  selectedImageProvider,
  imageProvidersLoading,
  imageProvidersError,
  hasImageFields,
  selectedModel,
  session,
  onCancel,
  onClose,
  onFinish,
  onRefresh,
  onRetry,
  onSelectModel,
  onSelectImageProvider,
  onStart
}: {
  dirty: boolean
  modelsError: string | null
  modelsLoading: boolean
  modelOptions: readonly AIModelOption[]
  imageProviderOptions: readonly InterfaceImageProviderOption[]
  selectedImageProvider: InterfaceImageProviderSelection | null
  imageProvidersLoading: boolean
  imageProvidersError: string | null
  hasImageFields: boolean
  selectedModel: AIModelSelection | null
  session: GenerationSession | null
  onCancel(): void
  onClose(): void
  onFinish(): void
  onRefresh(): void
  onRetry(): void
  onSelectModel(value: AIModelSelection | null): void
  onSelectImageProvider(value: InterfaceImageProviderSelection | null): void
  onStart(): void
}): JSX.Element {
  const finished = session ? isGenerationFinished(session) : false

  return (
    <aside className={styles.aiPane} aria-label="AI 生成">
      <header className={styles.aiHeader}>
        <span className={styles.generationIcon}>
          <Bot aria-hidden="true" />
        </span>
        <div>
          <h2>AI 生成</h2>
          <span>{session ? (finished ? '生成任务已结束' : '正在生成题组') : '生成设置'}</span>
        </div>
      </header>

      <div className={styles.aiBody}>
        <AIModelSelect
          disabled={session !== null && !finished}
          error={modelsError}
          label="生成模型"
          loading={modelsLoading}
          options={modelOptions}
          value={selectedModel}
          onChange={onSelectModel}
          onRefresh={onRefresh}
        />
        {hasImageFields ? (
          <AIImageProviderSelect
            disabled={session !== null && !finished}
            error={imageProvidersError}
            label="图像 Provider"
            loading={imageProvidersLoading}
            options={imageProviderOptions}
            value={selectedImageProvider}
            onChange={onSelectImageProvider}
          />
        ) : null}
        {session ? (
          <div className={styles.generationContent}>
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
        ) : null}
      </div>

      <footer className={styles.aiActions}>
        {!session ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              icon={Bot}
              variant="primary"
              disabled={
                !selectedModel ||
                (hasImageFields && !selectedImageProvider) ||
                modelsLoading ||
                Boolean(modelsError) ||
                (hasImageFields && Boolean(imageProvidersError)) ||
                dirty
              }
              onClick={onStart}
            >
              开始生成
            </Button>
          </>
        ) : finished ? (
          <>
            <Button
              icon={RefreshCw}
              disabled={
                !selectedModel ||
                (hasImageFields && !selectedImageProvider) ||
                modelsLoading ||
                Boolean(modelsError) ||
                (hasImageFields && Boolean(imageProvidersError)) ||
                dirty
              }
              onClick={onRetry}
            >
              重新生成
            </Button>
            <Button icon={Check} variant="primary" onClick={onFinish}>
              完成
            </Button>
          </>
        ) : (
          <Button icon={X} disabled={!session.handle} variant="ghost" onClick={onCancel}>
            取消生成
          </Button>
        )}
      </footer>
    </aside>
  )
}

function isGenerationFinished(session: GenerationSession): boolean {
  return session.result !== null || session.startError !== null
}

function providerSelectionOf(
  option: InterfaceImageProviderOption
): InterfaceImageProviderSelection {
  return {
    providerId: option.providerId,
    ...(option.modelId ? { modelId: option.modelId } : {})
  }
}

function findImageProvider(
  options: readonly InterfaceImageProviderOption[],
  selection: InterfaceImageProviderSelection
): InterfaceImageProviderOption | undefined {
  return options.find(
    (option) => option.providerId === selection.providerId && option.modelId === selection.modelId
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
