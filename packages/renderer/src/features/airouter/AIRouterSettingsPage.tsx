import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX
} from 'react'
import type {
  AIRouterModelConfig,
  AIRouterModelOption,
  AIRouterProviderConfigSummary,
  AIRouterProviderType,
  AIRouterReasoningConfig,
  AIRouterReasoningEffort,
  AIRouterReasoningOption
} from '@ls101/airouter'
import {
  AudioLines,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  LockKeyhole,
  MessageSquareText,
  Mic,
  Brain,
  Plus,
  Save,
  TestTube2,
  Trash2,
  X
} from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import {
  AIModelSelect,
  type AIModelOption,
  type AIModelSelection
} from '../../components/ai/AIModelSelect'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { toast } from '../../components/ui/toast'
import { airouterApplication, type AIRouterApplication } from './AIRouterApplication'
import {
  AIRouterOperationFeedback,
  AIRouterPageError,
  AIRouterPageLoading,
  type AIRouterFeedbackValue
} from './AIRouterFeedback'
import { formatAIRouterError } from './airouterError'
import { AIRouterImageSettingsPage } from './AIRouterImageSettingsPage'
import { AIRouterSpeechSettingsPage } from './AIRouterSpeechSettingsPage'
import { AIRouterSpeechRecognitionSettingsPage } from './AIRouterSpeechRecognitionSettingsPage'
import { AIRouterPronunciationSettingsPage } from './AIRouterPronunciationSettingsPage'
import styles from './AIRouterSettingsPage.module.css'

interface ProviderDraft {
  id?: string
  name: string
  type: AIRouterProviderType
  catalogProviderId: string
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  models: AIRouterModelConfig[]
}

type FeedbackScope = 'api-key' | 'models' | 'test' | 'editor' | 'delete'

const providerLabels: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic'
}

const defaultBaseUrls: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}

interface ProviderPreset {
  id: string
  name: string
  type: AIRouterProviderType
  baseUrl: string
  catalogProviderId: string
}

const providerPresets: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    catalogProviderId: 'openai'
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    catalogProviderId: 'anthropic'
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    catalogProviderId: 'openrouter'
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    catalogProviderId: 'deepseek'
  },
  {
    id: 'zhipuai',
    name: 'Zhipu AI',
    type: 'openai-compatible',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    catalogProviderId: 'zhipuai'
  },
  {
    id: 'moonshotai',
    name: 'Moonshot AI',
    type: 'openai-compatible',
    baseUrl: 'https://api.moonshot.ai/v1',
    catalogProviderId: 'moonshotai'
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    type: 'openai-compatible',
    baseUrl: 'https://api.siliconflow.com/v1',
    catalogProviderId: 'siliconflow'
  },
  {
    id: 'groq',
    name: 'Groq',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    catalogProviderId: 'groq'
  },
  {
    id: 'xai',
    name: 'xAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.x.ai/v1',
    catalogProviderId: 'xai'
  },
  {
    id: 'fireworks-ai',
    name: 'Fireworks AI',
    type: 'openai-compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    catalogProviderId: 'fireworks-ai'
  },
  {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    catalogProviderId: 'lmstudio'
  },
  {
    id: 'custom-openai',
    name: '自定义 OpenAI Compatible',
    type: 'openai-compatible',
    baseUrl: '',
    catalogProviderId: ''
  },
  {
    id: 'custom-anthropic',
    name: '自定义 Anthropic',
    type: 'anthropic',
    baseUrl: '',
    catalogProviderId: ''
  }
]

const sectionBasePath = '/settings/ai-router'
const sections = [
  { id: 'text', label: '文本生成', icon: MessageSquareText },
  { id: 'image', label: '图像生成', icon: ImageIcon },
  { id: 'speech-synthesis', label: '语音合成', icon: AudioLines },
  { id: 'speech-recognition', label: '语音识别', icon: Mic },
  { id: 'pronunciation', label: 'AI 语音评测', icon: Brain }
] as const

export function AIRouterSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const location = useLocation()
  const tabsRef = useRef<HTMLElement>(null)
  const activeSectionId =
    sections.find(
      (section) =>
        location.pathname === `${sectionBasePath}/${section.id}` ||
        (section.id === 'text' && location.pathname === sectionBasePath)
    )?.id ?? 'text'
  const [tabIndicator, setTabIndicator] = useState({ x: 0, width: 0, ready: false })

  useLayoutEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const activeTab = tabs.querySelector<HTMLElement>('[data-active]')
    if (!activeTab) return

    const updateIndicator = (): void => {
      const x = Math.round(activeTab.offsetLeft)
      const width = Math.round(activeTab.offsetWidth)
      setTabIndicator((current) =>
        current.x === x && current.width === width && current.ready
          ? current
          : { x, width, ready: true }
      )
    }

    updateIndicator()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(updateIndicator)
    observer.observe(tabs)
    observer.observe(activeTab)
    return () => observer.disconnect()
  }, [activeSectionId])

  return (
    <div className={styles.routerPage}>
      <nav ref={tabsRef} aria-label="AI 引擎设置分类" className={styles.tabs} role="tablist">
        <span
          aria-hidden="true"
          className={styles.tabIndicator}
          data-ready={tabIndicator.ready || undefined}
          style={
            {
              '--airouter-tab-x': `${tabIndicator.x}px`,
              '--airouter-tab-width': `${tabIndicator.width}px`
            } as CSSProperties
          }
        />
        {sections.map((section) => {
          const Icon = section.icon
          const active = section.id === activeSectionId
          return (
            <Link
              aria-controls={`ai-router-panel-${section.id}`}
              aria-selected={active}
              className={styles.tab}
              data-active={active || undefined}
              id={`ai-router-tab-${section.id}`}
              key={section.id}
              role="tab"
              to={`${sectionBasePath}/${section.id}`}
            >
              <Icon aria-hidden="true" />
              <span>{section.label}</span>
            </Link>
          )
        })}
      </nav>

      <div
        aria-labelledby={`ai-router-tab-${activeSectionId}`}
        className={styles.sectionContent}
        id={`ai-router-panel-${activeSectionId}`}
        key={activeSectionId}
        role="tabpanel"
      >
        <Routes>
          <Route index element={<Navigate replace to="text" />} />
          <Route path="text" element={<AIRouterTextSettingsPage application={application} />} />
          <Route path="image" element={<AIRouterImageSettingsPage application={application} />} />
          <Route
            path="speech-synthesis"
            element={<AIRouterSpeechSettingsPage application={application} />}
          />
          <Route
            path="speech-recognition"
            element={<AIRouterSpeechRecognitionSettingsPage application={application} />}
          />
          <Route
            path="pronunciation"
            element={<AIRouterPronunciationSettingsPage application={application} />}
          />
          <Route path="*" element={<Navigate replace to="text" />} />
        </Routes>
      </div>
    </div>
  )
}

export function AIRouterTextSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterProviderConfigSummary[] | null>(null)
  const loadRequest = useRef(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIRouterProviderConfigSummary | null>(null)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [apiKeyBaseline, setApiKeyBaseline] = useState('')
  const [feedback, setFeedback] = useState<Partial<Record<FeedbackScope, AIRouterFeedbackValue>>>(
    {}
  )

  const loadConfigs = useCallback(async (): Promise<void> => {
    const requestId = loadRequest.current + 1
    loadRequest.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const values = await application.listConfigs()
      if (requestId !== loadRequest.current) return
      setConfigs(values)
    } catch (reason) {
      if (requestId !== loadRequest.current) return
      setConfigs(null)
      setLoadError(formatAIRouterError(reason, '无法加载文本 Provider 设置'))
    } finally {
      if (requestId === loadRequest.current) setLoading(false)
    }
  }, [application])

  useEffect(() => {
    void loadConfigs()
    return () => {
      loadRequest.current += 1
    }
  }, [loadConfigs])

  const enabledModels = useMemo(() => draft?.models.filter((model) => model.enabled) ?? [], [draft])

  const selectedTestModelId = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')
  const testModelProviderId = draft?.id ?? 'unsaved-provider'
  const testModelOptions: AIModelOption[] = enabledModels.map((model) => ({
    providerId: testModelProviderId,
    providerName: draft?.name.trim() || '当前 Provider',
    modelId: model.id
  }))
  const selectedTestModel: AIModelSelection | null = selectedTestModelId
    ? { providerId: testModelProviderId, modelId: selectedTestModelId }
    : null

  const persistedConfig = draft?.id ? configs?.find((config) => config.id === draft.id) : undefined
  const draftModified = draft
    ? isDraftModified(draft, persistedConfig, apiKeyBaseline, apiKeyLoaded)
    : false

  const run = async (
    label: string,
    action: () => Promise<void>,
    feedbackScope: FeedbackScope
  ): Promise<void> => {
    setBusy(label)
    setFeedback((current) => ({ ...current, [feedbackScope]: undefined }))
    try {
      await action()
    } catch (reason) {
      setFeedback((current) => ({
        ...current,
        [feedbackScope]: {
          kind: 'error',
          text: formatAIRouterError(reason, 'AI 引擎设置操作失败')
        }
      }))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async (): Promise<AIRouterProviderConfigSummary> => {
    if (!draft) throw new Error('没有可保存的 Provider 配置')
    const saved = await application.saveConfig(toConfigInput(draft, apiKeyBaseline, apiKeyLoaded))
    setConfigs((current) => upsert(current ?? [], saved))
    setDraft(draftFromConfig(saved))
    setApiKeyVisible(false)
    setApiKeyLoaded(false)
    setApiKeyBaseline('')
    setFeedback({})
    return saved
  }

  const openEditor = (nextDraft: ProviderDraft): void => {
    setDraft(nextDraft)
    setManualModel('')
    setTestModelId('')
    setApiKeyVisible(false)
    setApiKeyLoaded(false)
    setApiKeyBaseline('')
    setFeedback({})
  }

  const closeEditor = (): void => {
    if (busy) return
    setDraft(null)
    setManualModel('')
    setTestModelId('')
    setApiKeyVisible(false)
    setApiKeyLoaded(false)
    setApiKeyBaseline('')
    setFeedback({})
  }

  if (!configs) {
    return loadError ? (
      <AIRouterPageError
        message={loadError}
        onRetry={() => void loadConfigs()}
        retrying={loading}
        title="无法加载文本 Provider 设置"
      />
    ) : (
      <AIRouterPageLoading message="正在加载 AI 引擎设置..." />
    )
  }

  return (
    <SettingsContent>
      <SettingsSection title="Provider" description="管理文本生成所使用的 Provider 配置。">
        <div className={styles.providerToolbar}>
          <span>共 {configs.length} 个 Provider</span>
          <Button icon={Plus} variant="primary" onClick={() => openEditor(createDraft())}>
            添加 Provider
          </Button>
        </div>
        {configs.length ? (
          <div className={styles.providerList}>
            {configs.map((config) => (
              <button
                className={styles.providerItem}
                key={config.id}
                onClick={() => openEditor(draftFromConfig(config))}
                type="button"
              >
                <span className={styles.providerText}>
                  <span className={styles.providerName}>{config.name}</span>
                  <span className={styles.providerMeta}>
                    <span>{providerPresetName(config)}</span>
                    <span>
                      {config.models.filter((model: AIRouterModelConfig) => model.enabled).length}{' '}
                      个已启用模型
                    </span>
                    <span>{config.hasApiKey ? '已配置密钥' : '未配置密钥'}</span>
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className={styles.providerArrow} />
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyProviders}>
            <MessageSquareText aria-hidden="true" />
            <span>尚未添加文本生成 Provider</span>
          </div>
        )}
      </SettingsSection>

      {draft ? (
        <Modal
          onOpenChange={(nextOpen) => {
            if (!nextOpen) closeEditor()
          }}
          open
          overlayClassName={styles.editorBackdrop}
        >
          <section className={styles.editorDialog}>
            <header className={styles.editorHeader}>
              <div>
                <ModalDescription asChild>
                  <span className={styles.editorEyebrow}>
                    {draft.id ? '编辑 Provider' : '添加 Provider'}
                  </span>
                </ModalDescription>
                <ModalTitle asChild>
                  <h2>{draft.name.trim() || '未命名 Provider'}</h2>
                </ModalTitle>
              </div>
              <button
                aria-label="关闭 Provider 编辑器"
                className={styles.closeEditor}
                disabled={Boolean(busy)}
                onClick={closeEditor}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>

            <div className={styles.editorBody}>
              <SettingsSection
                title="基础配置"
                description="API Key 使用系统加密存储；点击眼睛可查看已保存密钥。"
              >
                <SettingsRow
                  label="配置名称"
                  description="用于在模型选择器中区分不同账号或服务地址。"
                >
                  <input
                    aria-label="配置名称"
                    autoFocus
                    className={styles.input}
                    disabled={Boolean(busy)}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="例如：学校 OpenAI"
                    value={draft.name}
                  />
                </SettingsRow>
                <SettingsRow
                  label="Provider"
                  description="预设会自动配置兼容协议、Base URL 和 models.dev 模型目录。"
                >
                  {draft.id ? (
                    <span className={styles.providerTypeControl}>
                      <input
                        aria-label="Provider"
                        className={styles.input}
                        disabled
                        type="text"
                        value={providerPresetName(draft)}
                      />
                      <span className={styles.providerTypeLock} title="Provider 不可修改">
                        <LockKeyhole aria-hidden="true" />
                      </span>
                    </span>
                  ) : (
                    <select
                      aria-label="Provider"
                      className={styles.input}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        const preset = providerPresets.find(({ id }) => id === event.target.value)
                        if (!preset) return
                        setDraft({
                          ...draft,
                          type: preset.type,
                          baseUrl: preset.baseUrl || defaultBaseUrls[preset.type],
                          catalogProviderId: preset.catalogProviderId
                        })
                      }}
                      value={providerPresetId(draft)}
                    >
                      {providerPresets.map((preset) => (
                        <option key={preset.id} value={preset.id}>
                          {preset.name}
                        </option>
                      ))}
                    </select>
                  )}
                </SettingsRow>
                <SettingsRow
                  label="Base URL"
                  description="OpenAI Compatible 可填写兼容服务或本地服务地址。"
                >
                  <input
                    aria-label="Base URL"
                    className={styles.inputWide}
                    disabled={Boolean(busy)}
                    onChange={(event) => {
                      const baseUrl = event.target.value
                      const preset = providerPresets.find(
                        (candidate) =>
                          candidate.type === draft.type &&
                          candidate.baseUrl === baseUrl.replace(/\/$/, '')
                      )
                      setDraft({
                        ...draft,
                        baseUrl,
                        catalogProviderId: preset?.catalogProviderId ?? ''
                      })
                    }}
                    value={draft.baseUrl}
                  />
                </SettingsRow>
                <SettingsRow label="API Key" description="本地无鉴权服务可以留空。">
                  <div className={styles.secretControl}>
                    <div className={styles.secretInputWrap}>
                      <input
                        aria-label="API Key"
                        autoComplete="new-password"
                        className={styles.inputWide}
                        disabled={Boolean(busy)}
                        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                        placeholder={draft.hasApiKey ? '已安全保存' : '输入 API Key'}
                        type={apiKeyVisible ? 'text' : 'password'}
                        value={draft.apiKey}
                      />
                      <button
                        aria-label={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        className={styles.secretVisibility}
                        disabled={Boolean(busy)}
                        onClick={() => {
                          if (apiKeyVisible) {
                            setApiKeyVisible(false)
                            return
                          }
                          if (!draft.id || !draft.hasApiKey || apiKeyLoaded || draft.apiKey) {
                            setApiKeyVisible(true)
                            return
                          }
                          const id = draft.id
                          void run(
                            'api-key',
                            async () => {
                              const apiKey = (await application.readApiKey(id)) ?? ''
                              setDraft((current) =>
                                current && current.id === id ? { ...current, apiKey } : current
                              )
                              setApiKeyBaseline(apiKey)
                              setApiKeyLoaded(true)
                              setApiKeyVisible(true)
                            },
                            'api-key'
                          )
                        }}
                        title={apiKeyVisible ? '隐藏 API Key' : '显示 API Key'}
                        type="button"
                      >
                        {apiKeyVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                    <AIRouterOperationFeedback value={feedback['api-key']} />
                  </div>
                </SettingsRow>
              </SettingsSection>

              <SettingsSection
                title="Model ID"
                description="从服务获取模型列表，或手动添加未出现在列表中的 Model ID。"
              >
                <div className={styles.modelToolbar}>
                  <Button
                    icon={Download}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run(
                        'models',
                        async () => {
                          const discovered = await application.listModels(
                            toConfigInput(draft, apiKeyBaseline, apiKeyLoaded)
                          )
                          const existing = new Map(draft.models.map((model) => [model.id, model]))
                          setDraft({
                            ...draft,
                            models: discovered
                              .map((model) => mergeDiscoveredModel(existing.get(model.id), model))
                              .concat(
                                draft.models.filter(
                                  (model) => !discovered.some((item) => item.id === model.id)
                                )
                              )
                          })
                          setFeedback((current) => ({
                            ...current,
                            models: {
                              kind: 'success',
                              text: `获取到 ${discovered.length} 个模型`
                            }
                          }))
                        },
                        'models'
                      )
                    }
                  >
                    获取模型列表
                  </Button>
                  <div className={styles.addModel}>
                    <input
                      aria-label="手动模型 ID"
                      className={styles.input}
                      disabled={Boolean(busy)}
                      onChange={(event) => setManualModel(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          setDraft(addManualModel(draft, manualModel))
                          setManualModel('')
                        }
                      }}
                      placeholder="手动输入 model id"
                      value={manualModel}
                    />
                    <Button
                      size="small"
                      icon={Plus}
                      disabled={!manualModel.trim() || Boolean(busy)}
                      onClick={() => {
                        setDraft(addManualModel(draft, manualModel))
                        setManualModel('')
                      }}
                    >
                      添加
                    </Button>
                  </div>
                </div>
                <AIRouterOperationFeedback
                  className={styles.modelFeedback}
                  value={feedback.models}
                />
                {draft.models.length ? (
                  <div className={styles.modelList}>
                    {draft.models.map((model) => (
                      <ModelSettings
                        busy={Boolean(busy)}
                        key={model.id}
                        model={model}
                        providerType={draft.type}
                        onChange={(next) =>
                          setDraft({
                            ...draft,
                            models: draft.models.map((candidate) =>
                              candidate.id === model.id ? next : candidate
                            )
                          })
                        }
                        onRemove={() =>
                          setDraft({
                            ...draft,
                            models: draft.models.filter((candidate) => candidate.id !== model.id)
                          })
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <p className={styles.emptyModels}>尚未添加模型。</p>
                )}
              </SettingsSection>

              <SettingsSection
                title="连接测试"
                description="发送固定的短请求，验证密钥、地址、模型和生成权限。"
              >
                <SettingsRow label="测试模型" description="只能测试当前已启用的模型。">
                  <AIModelSelect
                    disabled={Boolean(busy)}
                    label="测试模型"
                    options={testModelOptions}
                    showLabel={false}
                    value={selectedTestModel}
                    onChange={(selection) => setTestModelId(selection?.modelId ?? '')}
                  />
                </SettingsRow>
                <div className={styles.sectionActions}>
                  <AIRouterOperationFeedback value={feedback.test} />
                  <Button
                    icon={TestTube2}
                    disabled={!selectedTestModelId || Boolean(busy)}
                    onClick={() =>
                      void run(
                        'test',
                        async () => {
                          const result = await application.testConnection(
                            toConfigInput(draft, apiKeyBaseline, apiKeyLoaded),
                            selectedTestModelId
                          )
                          setFeedback((current) => ({
                            ...current,
                            test: {
                              kind: 'success',
                              text: `连接成功，模型回复：${result.text || '（空响应）'}`
                            }
                          }))
                        },
                        'test'
                      )
                    }
                  >
                    {busy === 'test' ? '正在测试...' : '测试连接'}
                  </Button>
                </div>
              </SettingsSection>
            </div>

            <footer className={styles.editorFooter}>
              <div>
                {draft.id ? (
                  <Button
                    icon={Trash2}
                    variant="danger"
                    disabled={Boolean(busy)}
                    onClick={() => {
                      const target = configs.find((config) => config.id === draft.id)
                      if (target) setDeleteTarget(target)
                    }}
                  >
                    删除 Provider
                  </Button>
                ) : null}
              </div>
              <AIRouterOperationFeedback value={feedback.editor} />
              <div className={styles.editorFooterActions}>
                <Button variant="ghost" disabled={Boolean(busy)} onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={!draft.name.trim() || !draftModified || Boolean(busy)}
                  onClick={() =>
                    void run(
                      'save',
                      async () => {
                        const saved = await saveDraft()
                        toast.success(`已保存“${saved.name}”`)
                      },
                      'editor'
                    )
                  }
                >
                  {busy === 'save' ? '正在保存...' : '保存 Provider'}
                </Button>
              </div>
            </footer>
          </section>
        </Modal>
      ) : null}

      <ConfirmModal
        busy={busy === 'delete'}
        closeOnConfirm={false}
        danger
        confirmLabel="删除配置"
        error={feedback.delete?.kind === 'error' ? feedback.delete.text : null}
        message={`将同时删除“${deleteTarget?.name ?? ''}”的普通配置和加密密钥。`}
        onCancel={() => {
          setDeleteTarget(null)
          setFeedback((current) => ({ ...current, delete: undefined }))
        }}
        onConfirm={() => {
          const target = deleteTarget
          if (!target) return
          void run(
            'delete',
            async () => {
              await application.deleteConfig(target.id)
              const next = configs.filter((config) => config.id !== target.id)
              setConfigs(next)
              setDraft(null)
              setDeleteTarget(null)
              setFeedback({})
              toast.success(`已删除“${target.name}”`)
            },
            'delete'
          )
        }}
        open={Boolean(deleteTarget)}
        title="删除 Provider 配置？"
      />
    </SettingsContent>
  )
}

function createDraft(): ProviderDraft {
  return {
    name: '',
    type: 'openai-compatible',
    catalogProviderId: 'openai',
    baseUrl: defaultBaseUrls['openai-compatible'],
    apiKey: '',
    hasApiKey: false,
    models: []
  }
}

function draftFromConfig(config: AIRouterProviderConfigSummary): ProviderDraft {
  return {
    ...config,
    catalogProviderId: config.catalogProviderId || '',
    apiKey: '',
    models: config.models.map((model: AIRouterModelConfig) => ({ ...model }))
  }
}

function isDraftModified(
  draft: ProviderDraft,
  persisted: AIRouterProviderConfigSummary | undefined,
  apiKeyBaseline: string,
  apiKeyLoaded: boolean
): boolean {
  if (
    !persisted ||
    draft.apiKey !== apiKeyBaseline ||
    (apiKeyLoaded && draft.hasApiKey && !draft.apiKey)
  ) {
    return true
  }
  if (
    draft.name !== persisted.name ||
    draft.type !== persisted.type ||
    draft.catalogProviderId !== (persisted.catalogProviderId || '') ||
    draft.baseUrl !== persisted.baseUrl ||
    draft.models.length !== persisted.models.length
  ) {
    return true
  }
  return draft.models.some((model, index) => {
    const savedModel = persisted.models[index]
    return !savedModel || JSON.stringify(model) !== JSON.stringify(savedModel)
  })
}

function toConfigInput(
  draft: ProviderDraft,
  apiKeyBaseline: string,
  apiKeyLoaded: boolean
): import('@ls101/airouter').AIRouterProviderConfigInput {
  const clearApiKey = apiKeyLoaded && draft.hasApiKey && !draft.apiKey
  return {
    id: draft.id,
    name: draft.name,
    type: draft.type,
    catalogProviderId: draft.catalogProviderId,
    baseUrl: draft.baseUrl,
    models: draft.models,
    apiKey: !clearApiKey && draft.apiKey !== apiKeyBaseline ? draft.apiKey : undefined,
    clearApiKey
  }
}

function addManualModel(draft: ProviderDraft, value: string): ProviderDraft {
  const id = value.trim()
  if (!id || draft.models.some((model) => model.id === id)) return draft
  return {
    ...draft,
    models: [...draft.models, { id, enabled: true, maxOutputTokens: 128 * 1024 }]
  }
}

function ModelSettings({
  model,
  providerType,
  busy,
  onChange,
  onRemove
}: {
  model: AIRouterModelConfig
  providerType: AIRouterProviderType
  busy: boolean
  onChange(model: AIRouterModelConfig): void
  onRemove(): void
}): JSX.Element {
  const metadata = model.metadata
  const options = metadata?.reasoningOptions ?? []
  const maxOutput = metadata?.outputLimit
  const reasoningModes = reasoningModeOptions(options, providerType, metadata?.reasoning === true)
  const selectedMode = reasoningMode(model.reasoning)
  return (
    <details className={styles.modelDetailsItem}>
      <summary className={styles.modelSummary}>
        <span className={styles.modelToggle}>
          <input
            aria-label={model.id}
            checked={model.enabled}
            disabled={busy}
            onChange={(event) => onChange({ ...model, enabled: event.target.checked })}
            onClick={(event) => event.stopPropagation()}
            type="checkbox"
          />
          <span className={styles.modelIdentity}>
            <strong>{metadata?.name || model.id}</strong>
            {metadata?.name ? <small>{model.id}</small> : null}
            <small>{modelSummary(model)}</small>
          </span>
        </span>
        <button
          aria-label={`移除模型 ${model.id}`}
          className={styles.removeModel}
          disabled={busy}
          onClick={(event) => {
            event.preventDefault()
            onRemove()
          }}
          title="移除模型"
          type="button"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </summary>
      <div className={styles.modelSettings}>
        <label className={styles.modelField}>
          <span>最大输出</span>
          <span className={styles.numberWithUnit}>
            <input
              aria-label={`${model.id} 最大输出`}
              disabled={busy}
              max={maxOutput}
              min={1}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isInteger(value) && value > 0) {
                  onChange({
                    ...model,
                    maxOutputTokens: maxOutput ? Math.min(value, maxOutput) : value
                  })
                }
              }}
              type="number"
              value={model.maxOutputTokens ?? defaultModelOutput(model)}
            />
            <small>tokens{maxOutput ? ` / 官方上限 ${formatTokens(maxOutput)}` : ''}</small>
          </span>
        </label>
        {metadata?.reasoning === false ? (
          <p className={styles.modelNotice}>该模型不支持推理。</p>
        ) : reasoningModes.length ? (
          <>
            <label className={styles.modelField}>
              <span>推理模式</span>
              <select
                aria-label={`${model.id} 推理模式`}
                disabled={busy}
                onChange={(event) =>
                  onChange({
                    ...model,
                    reasoning: initialReasoning(event.target.value, options)
                  })
                }
                value={selectedMode}
              >
                <option value="default">Provider 默认</option>
                {reasoningModes.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>
            {model.reasoning?.type === 'effort' ? (
              <label className={styles.modelField}>
                <span>推理强度</span>
                <select
                  aria-label={`${model.id} 推理强度`}
                  disabled={busy}
                  onChange={(event) =>
                    onChange({
                      ...model,
                      reasoning: {
                        type: 'effort',
                        effort: event.target.value as AIRouterReasoningEffort
                      }
                    })
                  }
                  value={model.reasoning.effort}
                >
                  {effortValues(options).map((effort) => (
                    <option key={effort} value={effort}>
                      {effortLabel(effort)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {model.reasoning?.type === 'budget_tokens' ? (
              <label className={styles.modelField}>
                <span>推理预算</span>
                <span className={styles.numberWithUnit}>
                  <input
                    aria-label={`${model.id} 推理预算`}
                    disabled={busy}
                    min={budgetOption(options)?.min ?? 1}
                    max={budgetOption(options)?.max}
                    onChange={(event) =>
                      onChange({
                        ...model,
                        reasoning: {
                          type: 'budget_tokens',
                          budgetTokens: Number(event.target.value)
                        }
                      })
                    }
                    type="number"
                    value={model.reasoning.budgetTokens}
                  />
                  <small>tokens</small>
                </span>
              </label>
            ) : null}
          </>
        ) : metadata?.reasoning ? (
          <p className={styles.modelNotice}>
            支持推理，但 models.dev 未提供可调参数；使用 Provider 默认设置。
          </p>
        ) : (
          <p className={styles.modelNotice}>暂无 models.dev 推理能力数据。</p>
        )}
      </div>
    </details>
  )
}

function mergeDiscoveredModel(
  existing: AIRouterModelConfig | undefined,
  discovered: AIRouterModelOption
): AIRouterModelConfig {
  const metadata = {
    name: discovered.name,
    contextLimit: discovered.contextLimit,
    outputLimit: discovered.outputLimit,
    reasoning: discovered.reasoning,
    reasoningOptions: discovered.reasoningOptions,
    structuredOutput: discovered.structuredOutput,
    attachment: discovered.attachment
  }
  const cleanMetadata = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined)
  )
  const next = existing ?? { id: discovered.id, enabled: false }
  return {
    ...next,
    maxOutputTokens: Math.min(
      next.maxOutputTokens ?? 128 * 1024,
      discovered.outputLimit ?? 128 * 1024
    ),
    ...(Object.keys(cleanMetadata).length ? { metadata: cleanMetadata } : {})
  }
}

function providerPresetId(
  draft: Pick<ProviderDraft, 'type' | 'baseUrl' | 'catalogProviderId'>
): string {
  return (
    providerPresets.find(
      (preset) =>
        preset.type === draft.type &&
        preset.catalogProviderId === draft.catalogProviderId &&
        preset.baseUrl === draft.baseUrl.replace(/\/$/, '')
    )?.id ?? (draft.type === 'anthropic' ? 'custom-anthropic' : 'custom-openai')
  )
}

function providerPresetName(
  draft: Pick<ProviderDraft, 'type' | 'baseUrl' | 'catalogProviderId'>
): string {
  const id = providerPresetId(draft)
  return providerPresets.find((preset) => preset.id === id)?.name ?? providerLabels[draft.type]
}

function defaultModelOutput(model: AIRouterModelConfig): number {
  return Math.min(128 * 1024, model.metadata?.outputLimit ?? 128 * 1024)
}

function modelSummary(model: AIRouterModelConfig): string {
  const values = [`输出 ${formatTokens(model.maxOutputTokens ?? defaultModelOutput(model))}`]
  if (model.metadata?.contextLimit)
    values.unshift(`上下文 ${formatTokens(model.metadata.contextLimit)}`)
  if (model.metadata?.reasoning) values.push('推理')
  if (model.metadata?.structuredOutput) values.push('结构化输出')
  return values.join(' · ')
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

function reasoningMode(reasoning?: AIRouterReasoningConfig): string {
  if (!reasoning) return 'default'
  if (reasoning.type === 'effort' || reasoning.type === 'budget_tokens') return reasoning.type
  return reasoning.type
}

function reasoningModeOptions(
  options: AIRouterReasoningOption[],
  providerType: AIRouterProviderType,
  reasoningSupported: boolean
): Array<{ value: string; label: string }> {
  const modes: Array<{ value: string; label: string }> = []
  const hasToggle = options.some((option) => option.type === 'toggle')
  const hasEffort = options.some((option) => option.type === 'effort')
  const hasBudget = options.some((option) => option.type === 'budget_tokens')
  if (
    hasToggle ||
    (reasoningSupported && !hasEffort && (providerType !== 'anthropic' || !hasBudget)) ||
    (providerType !== 'anthropic' && hasBudget && !hasEffort)
  ) {
    modes.push({ value: 'enabled', label: '开启' }, { value: 'disabled', label: '关闭' })
  }
  if (hasEffort) {
    modes.push({ value: 'effort', label: '按强度' })
  }
  if (providerType === 'anthropic' && hasBudget) {
    modes.push({ value: 'budget_tokens', label: '按 token 预算' })
  }
  return modes
}

function initialReasoning(
  value: string,
  options: AIRouterReasoningOption[]
): AIRouterReasoningConfig | undefined {
  if (value === 'default') return undefined
  if (value === 'enabled' || value === 'disabled') return { type: value }
  if (value === 'effort') return { type: 'effort', effort: effortValues(options)[0] ?? 'medium' }
  if (value === 'budget_tokens') {
    return { type: 'budget_tokens', budgetTokens: budgetOption(options)?.min ?? 1024 }
  }
  return undefined
}

function effortValues(options: AIRouterReasoningOption[]): AIRouterReasoningEffort[] {
  const option = options.find((candidate) => candidate.type === 'effort')
  return option?.type === 'effort' ? option.values : []
}

function budgetOption(
  options: AIRouterReasoningOption[]
): Extract<AIRouterReasoningOption, { type: 'budget_tokens' }> | undefined {
  const option = options.find((candidate) => candidate.type === 'budget_tokens')
  return option?.type === 'budget_tokens' ? option : undefined
}

function effortLabel(effort: AIRouterReasoningEffort): string {
  return effort
}

function upsert(
  configs: AIRouterProviderConfigSummary[],
  saved: AIRouterProviderConfigSummary
): AIRouterProviderConfigSummary[] {
  const index = configs.findIndex((config) => config.id === saved.id)
  if (index < 0) return [...configs, saved]
  return configs.map((config) => (config.id === saved.id ? saved : config))
}
