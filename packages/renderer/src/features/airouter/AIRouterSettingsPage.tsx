import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  AIRouterModelConfig,
  AIRouterProviderConfigSummary,
  AIRouterProviderType
} from '@ls101/airouter'
import {
  AudioLines,
  Check,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  LockKeyhole,
  MessageSquareText,
  Mic,
  Plus,
  Save,
  TestTube2,
  Trash2,
  X,
  type LucideIcon
} from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { toast } from '../../components/ui/toast'
import { airouterApplication, type AIRouterApplication } from './AIRouterApplication'
import styles from './AIRouterSettingsPage.module.css'

interface ProviderDraft {
  id?: string
  name: string
  type: AIRouterProviderType
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  models: AIRouterModelConfig[]
}

type FeedbackScope = 'api-key' | 'models' | 'test' | 'editor'

interface OperationFeedbackValue {
  kind: 'success' | 'error'
  text: string
}

const providerLabels: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic'
}

const defaultBaseUrls: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}

const sectionBasePath = '/settings/ai-router'
const sections = [
  { id: 'text', label: '文本生成', icon: MessageSquareText },
  { id: 'speech-synthesis', label: '语音合成', icon: AudioLines },
  { id: 'speech-recognition', label: '语音识别', icon: Mic }
] as const

export function AIRouterSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const location = useLocation()

  return (
    <div className={styles.routerPage}>
      <nav aria-label="AI 引擎设置分类" className={styles.tabs} role="tablist">
        {sections.map((section) => {
          const Icon = section.icon
          const active =
            location.pathname === `${sectionBasePath}/${section.id}` ||
            (section.id === 'text' && location.pathname === sectionBasePath)
          return (
            <Link
              aria-selected={active}
              className={styles.tab}
              data-active={active || undefined}
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

      <Routes>
        <Route index element={<Navigate replace to="text" />} />
        <Route path="text" element={<AIRouterTextSettingsPage application={application} />} />
        <Route
          path="speech-synthesis"
          element={
            <AIRouterPlaceholder
              icon={AudioLines}
              title="语音合成"
              description="语音合成模型的 Provider、模型和连接测试将在这里配置。"
            />
          }
        />
        <Route
          path="speech-recognition"
          element={
            <AIRouterPlaceholder
              icon={Mic}
              title="语音识别"
              description="语音识别模型的 Provider、模型和连接测试将在这里配置。"
            />
          }
        />
        <Route path="*" element={<Navigate replace to="text" />} />
      </Routes>
    </div>
  )
}

export function AIRouterTextSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterProviderConfigSummary[] | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIRouterProviderConfigSummary | null>(null)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [apiKeyBaseline, setApiKeyBaseline] = useState('')
  const [feedback, setFeedback] = useState<Partial<Record<FeedbackScope, OperationFeedbackValue>>>(
    {}
  )

  useEffect(() => {
    let active = true
    void application
      .listConfigs()
      .then((values) => {
        if (!active) return
        setConfigs(values)
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
    return () => {
      active = false
    }
  }, [application])

  const editorOpen = Boolean(draft)
  useEffect(() => {
    if (!editorOpen) return
    const previousOverflow = document.body.style.overflow
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) setDraft(null)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [busy, editorOpen])

  const enabledModels = useMemo(() => draft?.models.filter((model) => model.enabled) ?? [], [draft])

  const selectedTestModelId = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')

  const persistedConfig = draft?.id ? configs?.find((config) => config.id === draft.id) : undefined
  const draftModified = draft
    ? isDraftModified(draft, persistedConfig, apiKeyBaseline, apiKeyLoaded)
    : false

  const run = async (
    label: string,
    action: () => Promise<void>,
    feedbackScope?: FeedbackScope
  ): Promise<void> => {
    setBusy(label)
    if (feedbackScope) {
      setFeedback((current) => ({ ...current, [feedbackScope]: undefined }))
    } else {
      setError(null)
    }
    try {
      await action()
    } catch (reason) {
      const text = errorMessage(reason)
      if (feedbackScope) {
        setFeedback((current) => ({
          ...current,
          [feedbackScope]: { kind: 'error', text }
        }))
      } else {
        setError(text)
      }
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
    setError(null)
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
    setError(null)
    setApiKeyVisible(false)
    setApiKeyLoaded(false)
    setApiKeyBaseline('')
    setFeedback({})
  }

  if (!configs) {
    return <div className={styles.status}>{error ?? '正在加载 AI 引擎设置...'}</div>
  }

  return (
    <SettingsContent>
      {!draft && error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
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
                    <span>{providerLabels[config.type]}</span>
                    <span>
                      {config.models.filter((model) => model.enabled).length} 个已启用模型
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
        <div
          className={styles.editorBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditor()
          }}
        >
          <section
            aria-labelledby="provider-editor-title"
            aria-modal="true"
            className={styles.editorDialog}
            role="dialog"
          >
            <header className={styles.editorHeader}>
              <div>
                <span className={styles.editorEyebrow}>
                  {draft.id ? '编辑 Provider' : '添加 Provider'}
                </span>
                <h2 id="provider-editor-title">{draft.name.trim() || '未命名 Provider'}</h2>
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
                <SettingsRow label="Provider 类型">
                  {draft.id ? (
                    <span className={styles.providerTypeControl}>
                      <input
                        aria-label="Provider 类型"
                        className={styles.input}
                        disabled
                        type="text"
                        value={providerLabels[draft.type]}
                      />
                      <span className={styles.providerTypeLock} title="Provider 类型不可修改">
                        <LockKeyhole aria-hidden="true" />
                      </span>
                    </span>
                  ) : (
                    <select
                      aria-label="Provider 类型"
                      className={styles.input}
                      disabled={Boolean(busy)}
                      onChange={(event) => {
                        const type = event.target.value as AIRouterProviderType
                        setDraft({ ...draft, type, baseUrl: defaultBaseUrls[type] })
                      }}
                      value={draft.type}
                    >
                      <option value="openai-compatible">OpenAI Compatible</option>
                      <option value="anthropic">Anthropic</option>
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
                    onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
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
                    <OperationFeedback value={feedback['api-key']} />
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
                              .map(
                                (model) =>
                                  existing.get(model.id) ?? { id: model.id, enabled: false }
                              )
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
                <OperationFeedback className={styles.modelFeedback} value={feedback.models} />
                {draft.models.length ? (
                  <div className={styles.modelList}>
                    {draft.models.map((model) => (
                      <div className={styles.modelItem} key={model.id}>
                        <label className={styles.modelToggle}>
                          <input
                            checked={model.enabled}
                            disabled={Boolean(busy)}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                models: draft.models.map((candidate) =>
                                  candidate.id === model.id
                                    ? { ...candidate, enabled: event.target.checked }
                                    : candidate
                                )
                              })
                            }
                            type="checkbox"
                          />
                          <span>{model.id}</span>
                        </label>
                        <button
                          aria-label={`移除模型 ${model.id}`}
                          className={styles.removeModel}
                          disabled={Boolean(busy)}
                          onClick={() =>
                            setDraft({
                              ...draft,
                              models: draft.models.filter((candidate) => candidate.id !== model.id)
                            })
                          }
                          title="移除模型"
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </div>
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
                  <select
                    aria-label="测试模型"
                    className={styles.inputWide}
                    disabled={!enabledModels.length || Boolean(busy)}
                    onChange={(event) => setTestModelId(event.target.value)}
                    value={selectedTestModelId}
                  >
                    {!enabledModels.length ? <option value="">没有已启用模型</option> : null}
                    {enabledModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.id}
                      </option>
                    ))}
                  </select>
                </SettingsRow>
                <div className={styles.sectionActions}>
                  <OperationFeedback value={feedback.test} />
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
              <OperationFeedback value={feedback.editor} />
              <div className={styles.editorFooterActions}>
                <Button variant="ghost" disabled={Boolean(busy)} onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={!draftModified || Boolean(busy)}
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
        </div>
      ) : null}

      <ConfirmModal
        danger
        confirmLabel="删除配置"
        message={`将同时删除“${deleteTarget?.name ?? ''}”的普通配置和加密密钥。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target) return
          void run('delete', async () => {
            await application.deleteConfig(target.id)
            const next = configs.filter((config) => config.id !== target.id)
            setConfigs(next)
            setDraft(null)
            toast.success(`已删除“${target.name}”`)
          })
        }}
        open={Boolean(deleteTarget)}
        title="删除 Provider 配置？"
      />
    </SettingsContent>
  )
}

function AIRouterPlaceholder({
  icon: Icon,
  title,
  description
}: {
  icon: LucideIcon
  title: string
  description: string
}): JSX.Element {
  return (
    <section className={styles.placeholder}>
      <div className={styles.placeholderIcon}>
        <Icon aria-hidden="true" />
      </div>
      <div className={styles.placeholderText}>
        <span className={styles.placeholderBadge}>临时占位</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </section>
  )
}

function OperationFeedback({
  value,
  className
}: {
  value: OperationFeedbackValue | undefined
  className?: string
}): JSX.Element | null {
  if (!value) return null
  return (
    <div
      className={[styles.operationFeedback, className].filter(Boolean).join(' ')}
      data-error={value.kind === 'error' || undefined}
      role={value.kind === 'error' ? 'alert' : 'status'}
    >
      {value.kind === 'success' ? <Check aria-hidden="true" /> : null}
      <span>{value.text}</span>
    </div>
  )
}

function createDraft(): ProviderDraft {
  return {
    name: '',
    type: 'openai-compatible',
    baseUrl: defaultBaseUrls['openai-compatible'],
    apiKey: '',
    hasApiKey: false,
    models: []
  }
}

function draftFromConfig(config: AIRouterProviderConfigSummary): ProviderDraft {
  return {
    ...config,
    apiKey: '',
    models: config.models.map((model) => ({ ...model }))
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
    draft.baseUrl !== persisted.baseUrl ||
    draft.models.length !== persisted.models.length
  ) {
    return true
  }
  return draft.models.some((model, index) => {
    const savedModel = persisted.models[index]
    return !savedModel || model.id !== savedModel.id || model.enabled !== savedModel.enabled
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
    baseUrl: draft.baseUrl,
    models: draft.models,
    apiKey: !clearApiKey && draft.apiKey !== apiKeyBaseline ? draft.apiKey : undefined,
    clearApiKey
  }
}

function addManualModel(draft: ProviderDraft, value: string): ProviderDraft {
  const id = value.trim()
  if (!id || draft.models.some((model) => model.id === id)) return draft
  return { ...draft, models: [...draft.models, { id, enabled: true }] }
}

function upsert(
  configs: AIRouterProviderConfigSummary[],
  saved: AIRouterProviderConfigSummary
): AIRouterProviderConfigSummary[] {
  const index = configs.findIndex((config) => config.id === saved.id)
  if (index < 0) return [...configs, saved]
  return configs.map((config) => (config.id === saved.id ? saved : config))
}

function errorMessage(reason: unknown): string {
  if (!(reason instanceof Error)) return 'AI 引擎设置操作失败'
  return reason.message.replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
}
