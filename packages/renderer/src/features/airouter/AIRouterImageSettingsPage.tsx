import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AIRouterImageProviderConfigInput,
  AIRouterImageProviderConfigSummary,
  AIRouterImageProviderType,
  AIRouterModelConfig
} from '@ls101/airouter'
import {
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Plus,
  Save,
  TestTube2,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { toast } from '../../components/ui/toast'
import { airouterApplication, type AIRouterApplication } from './AIRouterApplication'
import {
  AIRouterOperationFeedback,
  AIRouterPageError,
  AIRouterPageLoading,
  type AIRouterFeedbackValue
} from './AIRouterFeedback'
import { formatAIRouterError } from './airouterError'
import {
  manualImageGenerationCoordinator,
  type ManualImageGenerationCoordinator
} from './ManualImageGeneration'
import styles from './AIRouterSettingsPage.module.css'

type ImageFeedbackScope = 'api-key' | 'models' | 'test' | 'editor' | 'delete'

export function AIRouterImageSettingsPage({
  application = airouterApplication,
  manualGenerator = manualImageGenerationCoordinator
}: {
  application?: AIRouterApplication
  manualGenerator?: ManualImageGenerationCoordinator
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterImageProviderConfigSummary[] | null>(null)
  const loadRequest = useRef(0)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<ImageProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<
    Partial<Record<ImageFeedbackScope, AIRouterFeedbackValue>>
  >({})
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyBaseline, setApiKeyBaseline] = useState('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AIRouterImageProviderConfigSummary | null>(null)
  const [testPreview, setTestPreview] = useState<string | null>(null)

  const loadConfigs = useCallback(async (): Promise<void> => {
    const requestId = loadRequest.current + 1
    loadRequest.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const nextConfigs = await application.listImageConfigs()
      if (requestId !== loadRequest.current) return
      setConfigs(nextConfigs)
    } catch (reason) {
      if (requestId !== loadRequest.current) return
      setConfigs(null)
      setLoadError(formatAIRouterError(reason, '无法加载图像 Provider 设置'))
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

  useEffect(
    () => () => {
      if (testPreview) URL.revokeObjectURL(testPreview)
    },
    [testPreview]
  )

  const enabledModels = useMemo(() => draft?.models.filter((model) => model.enabled) ?? [], [draft])
  const selectedTestModel = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')

  const run = async (
    operation: string,
    action: () => Promise<void>,
    feedbackScope: ImageFeedbackScope
  ): Promise<void> => {
    setBusy(operation)
    setFeedback((current) => ({ ...current, [feedbackScope]: undefined }))
    try {
      await action()
    } catch (reason) {
      setFeedback((current) => ({
        ...current,
        [feedbackScope]: {
          kind: 'error',
          text: formatAIRouterError(reason, '图像生成设置操作失败')
        }
      }))
    } finally {
      setBusy(null)
    }
  }

  if (!configs) {
    return loadError ? (
      <AIRouterPageError
        message={loadError}
        onRetry={() => void loadConfigs()}
        retrying={loading}
        title="无法加载图像 Provider 设置"
      />
    ) : (
      <AIRouterPageLoading message="正在加载图像 Provider..." />
    )
  }

  const resetEditorState = (): void => {
    if (testPreview) URL.revokeObjectURL(testPreview)
    setTestPreview(null)
    setManualModel('')
    setTestModelId('')
    setApiKeyVisible(false)
    setApiKeyBaseline('')
    setApiKeyLoaded(false)
    setFeedback({})
  }

  const openEditor = (nextDraft: ImageProviderDraft): void => {
    resetEditorState()
    setDraft(nextDraft)
  }

  const closeEditor = (): void => {
    if (busy) return
    setDraft(null)
    resetEditorState()
  }

  const saveDraft = (): void => {
    if (!draft) return
    void run(
      'save',
      async () => {
        const clearApiKey =
          draft.type === 'openai-compatible' && apiKeyLoaded && draft.hasApiKey && !draft.apiKey
        const saved = await application.saveImageConfig({
          id: draft.id,
          name: draft.name,
          type: draft.type,
          baseUrl: draft.baseUrl,
          models: draft.models,
          apiKey:
            draft.type === 'openai-compatible' && !clearApiKey && draft.apiKey !== apiKeyBaseline
              ? draft.apiKey
              : undefined,
          clearApiKey
        })
        setConfigs((current) => upsert(current ?? [], saved))
        setDraft(fromConfig(saved))
        setApiKeyBaseline('')
        setApiKeyLoaded(false)
        setApiKeyVisible(false)
        toast.success(`已保存“${saved.name}”`)
      },
      'editor'
    )
  }

  const draftModified = draft
    ? isModified(
        draft,
        configs.find((item) => item.id === draft.id),
        apiKeyBaseline,
        apiKeyLoaded
      )
    : false

  return (
    <SettingsContent>
      <SettingsSection
        title="图像 Provider"
        description="单独管理图像生成服务，不复用文本 Provider；具体调用时选择 Provider。"
      >
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
                type="button"
                onClick={() => openEditor(fromConfig(config))}
              >
                <span className={styles.providerText}>
                  <span className={styles.providerName}>{config.name}</span>
                  <span className={styles.providerMeta}>
                    <span>{providerTypeLabel(config.type)}</span>
                    {config.type === 'manual' ? (
                      <span>通过弹窗导入生成结果</span>
                    ) : (
                      <>
                        <span>
                          {config.models.filter((model) => model.enabled).length} 个已启用模型
                        </span>
                        <span>{config.hasApiKey ? '已配置密钥' : '未配置密钥'}</span>
                      </>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyProviders}>
            <ImageIcon aria-hidden="true" />
            <span>尚未添加图像 Provider</span>
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
                    {draft.id ? '编辑图像 Provider' : '添加图像 Provider'}
                  </span>
                </ModalDescription>
                <ModalTitle asChild>
                  <h2>{draft.name.trim() || '未命名 Provider'}</h2>
                </ModalTitle>
              </div>
              <button
                aria-label="关闭图像 Provider 编辑器"
                className={styles.closeEditor}
                type="button"
                onClick={closeEditor}
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className={styles.editorBody}>
              <SettingsSection
                title="基础配置"
                description={
                  draft.type === 'manual'
                    ? '手动 Provider 会通过全局弹窗完成图片导入。'
                    : '图像 Provider 的 API Key 使用独立加密存储。'
                }
              >
                <SettingsRow label="配置名称">
                  <input
                    aria-label="图像配置名称"
                    className={styles.input}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </SettingsRow>
                <SettingsRow label="Provider 类型">
                  {draft.id ? (
                    <input
                      aria-label="图像 Provider 类型"
                      className={styles.input}
                      disabled
                      value={providerTypeLabel(draft.type)}
                    />
                  ) : (
                    <select
                      aria-label="图像 Provider 类型"
                      className={styles.input}
                      value={draft.type}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          type: event.target.value as AIRouterImageProviderType
                        })
                      }
                    >
                      <option value="openai-compatible">OpenAI Compatible</option>
                      <option value="manual">手动生成</option>
                    </select>
                  )}
                </SettingsRow>
                {draft.type === 'openai-compatible' ? (
                  <>
                    <SettingsRow label="Base URL">
                      <input
                        aria-label="图像 Base URL"
                        className={styles.inputWide}
                        value={draft.baseUrl}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                    </SettingsRow>
                    <SettingsRow label="API Key">
                      <div className={styles.secretControl}>
                        <div className={styles.secretInputWrap}>
                          <input
                            aria-label="图像 API Key"
                            className={styles.inputWide}
                            type={apiKeyVisible ? 'text' : 'password'}
                            placeholder={draft.hasApiKey ? '已安全保存' : '输入 API Key'}
                            value={draft.apiKey}
                            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                          />
                          <button
                            aria-label={apiKeyVisible ? '隐藏图像 API Key' : '显示图像 API Key'}
                            className={styles.secretVisibility}
                            type="button"
                            onClick={() => {
                              if (!draft.id || !draft.hasApiKey || apiKeyLoaded || draft.apiKey)
                                setApiKeyVisible(!apiKeyVisible)
                              else
                                void run(
                                  'api-key',
                                  async () => {
                                    const apiKey =
                                      (await application.readImageApiKey(draft.id as string)) ?? ''
                                    setDraft((current) =>
                                      current ? { ...current, apiKey } : current
                                    )
                                    setApiKeyBaseline(apiKey)
                                    setApiKeyLoaded(true)
                                    setApiKeyVisible(true)
                                  },
                                  'api-key'
                                )
                            }}
                          >
                            {apiKeyVisible ? (
                              <EyeOff aria-hidden="true" />
                            ) : (
                              <Eye aria-hidden="true" />
                            )}
                          </button>
                        </div>
                        <AIRouterOperationFeedback value={feedback['api-key']} />
                      </div>
                    </SettingsRow>
                  </>
                ) : null}
              </SettingsSection>
              {draft.type === 'openai-compatible' ? (
                <SettingsSection
                  title="图像模型"
                  description="从服务获取模型列表，或手动添加模型 ID。"
                >
                  <div className={styles.modelToolbar}>
                    <Button
                      icon={Download}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run(
                          'models',
                          async () => {
                            const discovered = await application.listImageModels(
                              toInput(draft, apiKeyBaseline, apiKeyLoaded)
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
                        aria-label="手动图像模型 ID"
                        className={styles.input}
                        value={manualModel}
                        onChange={(event) => setManualModel(event.target.value)}
                      />
                      <Button
                        icon={Plus}
                        size="small"
                        disabled={!manualModel.trim()}
                        onClick={() => {
                          const id = manualModel.trim()
                          if (id && !draft.models.some((model) => model.id === id))
                            setDraft({ ...draft, models: [...draft.models, { id, enabled: true }] })
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
                        <div className={styles.modelItem} key={model.id}>
                          <label className={styles.modelToggle}>
                            <input
                              type="checkbox"
                              checked={model.enabled}
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
                            />
                            <span>{model.id}</span>
                          </label>
                          <button
                            aria-label={`移除图像模型 ${model.id}`}
                            className={styles.removeModel}
                            type="button"
                            onClick={() =>
                              setDraft({
                                ...draft,
                                models: draft.models.filter(
                                  (candidate) => candidate.id !== model.id
                                )
                              })
                            }
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
              ) : (
                <SettingsSection
                  title="测试生成"
                  description="打开手动导入窗口，导入一张测试图片以确认流程可用。"
                >
                  <div className={styles.sectionActions}>
                    <Button
                      icon={TestTube2}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run(
                          'test',
                          async () => {
                            const result = await manualGenerator.generate('一枚简洁的绿色圆形图标')
                            const url = URL.createObjectURL(
                              new Blob([new Uint8Array(result.data)], { type: result.mediaType })
                            )
                            setTestPreview((current) => {
                              if (current) URL.revokeObjectURL(current)
                              return url
                            })
                            setFeedback((current) => ({
                              ...current,
                              test: { kind: 'success', text: '测试图片已导入' }
                            }))
                          },
                          'test'
                        )
                      }
                    >
                      测试手动生成
                    </Button>
                    <AIRouterOperationFeedback value={feedback.test} />
                  </div>
                </SettingsSection>
              )}
              {draft.type === 'openai-compatible' ? (
                <SettingsSection
                  title="连接测试"
                  description="实际生成一张测试图片，可能产生 Provider 费用。"
                >
                  <SettingsRow label="测试模型">
                    <select
                      aria-label="测试图像模型"
                      className={styles.inputWide}
                      value={selectedTestModel}
                      onChange={(event) => setTestModelId(event.target.value)}
                    >
                      {!enabledModels.length ? <option value="">请先启用模型</option> : null}
                      {enabledModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.id}
                        </option>
                      ))}
                    </select>
                  </SettingsRow>
                  <div className={styles.sectionActions}>
                    <Button
                      icon={TestTube2}
                      disabled={!selectedTestModel || Boolean(busy)}
                      onClick={() =>
                        void run(
                          'test',
                          async () => {
                            const result = await application.testImageConnection(
                              toInput(draft, apiKeyBaseline, apiKeyLoaded),
                              selectedTestModel
                            )
                            const url = URL.createObjectURL(
                              new Blob([new Uint8Array(result.image.data)], {
                                type: result.image.mediaType
                              })
                            )
                            setTestPreview((current) => {
                              if (current) URL.revokeObjectURL(current)
                              return url
                            })
                            setFeedback((current) => ({
                              ...current,
                              test: { kind: 'success', text: '连接成功，测试图片已生成' }
                            }))
                          },
                          'test'
                        )
                      }
                    >
                      测试连接
                    </Button>
                    <AIRouterOperationFeedback value={feedback.test} />
                  </div>
                </SettingsSection>
              ) : null}
              {testPreview ? (
                <img className={styles.imageTestPreview} alt="测试生成图片" src={testPreview} />
              ) : null}
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
                      if (!target) return
                      setFeedback((current) => ({ ...current, delete: undefined }))
                      setDeleteTarget(target)
                    }}
                  >
                    删除 Provider
                  </Button>
                ) : null}
              </div>
              <AIRouterOperationFeedback value={feedback.editor} />
              <div className={styles.editorFooterActions}>
                <Button variant="ghost" onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={!draft.name.trim() || !draftModified || Boolean(busy)}
                  onClick={saveDraft}
                >
                  保存 Provider
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
        message={
          deleteTarget?.type === 'manual'
            ? `将删除“${deleteTarget.name}”的手动生成配置。`
            : `将删除“${deleteTarget?.name ?? ''}”的图像配置和加密密钥。`
        }
        open={Boolean(deleteTarget)}
        title="删除图像 Provider 配置？"
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
              await application.deleteImageConfig(target.id)
              const nextConfigs = await application.listImageConfigs()
              setConfigs(nextConfigs)
              setDraft(null)
              resetEditorState()
              setDeleteTarget(null)
              toast.success(`已删除“${target.name}”`)
            },
            'delete'
          )
        }}
      />
    </SettingsContent>
  )
}

function createDraft(): ImageProviderDraft {
  return {
    name: '',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    hasApiKey: false,
    models: []
  }
}

function fromConfig(config: AIRouterImageProviderConfigSummary): ImageProviderDraft {
  return { ...config, apiKey: '', models: config.models.map((model) => ({ ...model })) }
}

function toInput(
  draft: ImageProviderDraft,
  baseline: string,
  loaded: boolean
): AIRouterImageProviderConfigInput {
  const clearApiKey = loaded && draft.hasApiKey && !draft.apiKey
  return {
    id: draft.id,
    name: draft.name,
    type: draft.type,
    baseUrl: draft.baseUrl,
    models: draft.models,
    apiKey: !clearApiKey && draft.apiKey !== baseline ? draft.apiKey : undefined,
    clearApiKey
  }
}

function isModified(
  draft: ImageProviderDraft,
  saved: AIRouterImageProviderConfigSummary | undefined,
  baseline: string,
  loaded: boolean
): boolean {
  if (!saved || draft.apiKey !== baseline || (loaded && draft.hasApiKey && !draft.apiKey))
    return true
  return (
    draft.name !== saved.name ||
    draft.type !== saved.type ||
    draft.baseUrl !== saved.baseUrl ||
    JSON.stringify(draft.models) !== JSON.stringify(saved.models)
  )
}

function upsert(
  configs: AIRouterImageProviderConfigSummary[],
  saved: AIRouterImageProviderConfigSummary
): AIRouterImageProviderConfigSummary[] {
  const index = configs.findIndex((config) => config.id === saved.id)
  return index < 0
    ? [...configs, saved]
    : configs.map((config) => (config.id === saved.id ? saved : config))
}

function providerTypeLabel(type: AIRouterImageProviderType): string {
  return type === 'manual' ? '手动生成' : 'OpenAI Compatible'
}

interface ImageProviderDraft {
  id?: string
  name: string
  type: AIRouterImageProviderType
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  models: AIRouterModelConfig[]
}
