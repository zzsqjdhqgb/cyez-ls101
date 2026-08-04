import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  AIRouterImageGenerationSettings,
  AIRouterImageProviderConfigInput,
  AIRouterImageProviderConfigSummary,
  AIRouterModelConfig
} from '@ls101/airouter'
import {
  Check,
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
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { toast } from '../../components/ui/toast'
import { airouterApplication, type AIRouterApplication } from './AIRouterApplication'
import styles from './AIRouterSettingsPage.module.css'

export function AIRouterImageSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterImageProviderConfigSummary[] | null>(null)
  const [settings, setSettings] = useState<AIRouterImageGenerationSettings | null>(null)
  const [draft, setDraft] = useState<ImageProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyBaseline, setApiKeyBaseline] = useState('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AIRouterImageProviderConfigSummary | null>(null)
  const [testPreview, setTestPreview] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([application.listImageConfigs(), application.getImageSettings()])
      .then(([nextConfigs, nextSettings]) => {
        if (!active) return
        setConfigs(nextConfigs)
        setSettings(nextSettings)
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
    return () => {
      active = false
    }
  }, [application])

  useEffect(
    () => () => {
      if (testPreview) URL.revokeObjectURL(testPreview)
    },
    [testPreview]
  )

  const enabledModels = useMemo(() => draft?.models.filter((model) => model.enabled) ?? [], [draft])
  const selectedProviderModel =
    settings?.mode === 'provider'
      ? modelSelectionValue(settings.providerConfigId, settings.modelId)
      : ''
  const selectedTestModel = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')

  const run = async (operation: string, action: () => Promise<void>): Promise<void> => {
    setBusy(operation)
    setError(null)
    setFeedback(null)
    try {
      await action()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  if (!configs || !settings)
    return <div className={styles.status}>{error ?? '正在加载图像生成设置...'}</div>

  const saveSettings = (next: AIRouterImageGenerationSettings): void => {
    void run('settings', async () => {
      const saved = await application.saveImageSettings(next)
      setSettings(saved)
      setFeedback('已保存图像生成模式')
    })
  }

  const closeEditor = (): void => {
    if (busy) return
    if (testPreview) URL.revokeObjectURL(testPreview)
    setTestPreview(null)
    setDraft(null)
    setManualModel('')
    setTestModelId('')
    setApiKeyVisible(false)
    setApiKeyBaseline('')
    setApiKeyLoaded(false)
  }

  const saveDraft = (): void => {
    if (!draft) return
    void run('save', async () => {
      const clearApiKey = apiKeyLoaded && draft.hasApiKey && !draft.apiKey
      const saved = await application.saveImageConfig({
        id: draft.id,
        name: draft.name,
        type: 'openai-compatible',
        baseUrl: draft.baseUrl,
        models: draft.models,
        apiKey: !clearApiKey && draft.apiKey !== apiKeyBaseline ? draft.apiKey : undefined,
        clearApiKey
      })
      setConfigs((current) => upsert(current ?? [], saved))
      setDraft(fromConfig(saved))
      setApiKeyBaseline('')
      setApiKeyLoaded(false)
      setApiKeyVisible(false)
      toast.success(`已保存“${saved.name}”`)
    })
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
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <SettingsSection title="生成方式" description="图像生成与文本生成使用独立的 Provider 配置。">
        <SettingsRow
          label="当前模式"
          description="手动模式会弹出窗口，复制提示词后导入本地文件或剪贴板图片。"
        >
          <div className={styles.imageModeToggle} role="group" aria-label="图像生成模式">
            <button
              type="button"
              aria-pressed={settings.mode === 'manual'}
              data-active={settings.mode === 'manual' || undefined}
              onClick={() => saveSettings({ mode: 'manual' })}
            >
              手动生成
            </button>
            <button
              type="button"
              aria-pressed={settings.mode === 'provider'}
              data-active={settings.mode === 'provider' || undefined}
              disabled={!configs.some((config) => config.models.some((model) => model.enabled))}
              onClick={() => {
                const first = firstImageModel(configs)
                if (first) saveSettings({ mode: 'provider', ...first })
              }}
            >
              API Provider
            </button>
          </div>
        </SettingsRow>
        {settings.mode === 'provider' ? (
          <SettingsRow label="默认模型" description="业务调用未指定模型时使用此模型。">
            <select
              aria-label="默认图像模型"
              className={styles.inputWide}
              disabled={Boolean(busy)}
              value={selectedProviderModel}
              onChange={(event) => {
                const [providerConfigId, modelId] = JSON.parse(event.target.value) as [
                  string,
                  string
                ]
                if (providerConfigId && modelId)
                  saveSettings({ mode: 'provider', providerConfigId, modelId })
              }}
            >
              {configs.flatMap((config) =>
                config.models
                  .filter((model) => model.enabled)
                  .map((model) => (
                    <option
                      key={`${config.id}:${model.id}`}
                      value={modelSelectionValue(config.id, model.id)}
                    >
                      {config.name} / {model.id}
                    </option>
                  ))
              )}
            </select>
          </SettingsRow>
        ) : null}
        {feedback ? (
          <div className={styles.operationFeedback}>
            <Check aria-hidden="true" />
            <span>{feedback}</span>
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="图像 Provider"
        description="单独管理图像生成服务，不复用文本 Provider。"
      >
        <div className={styles.providerToolbar}>
          <span>共 {configs.length} 个 Provider</span>
          <Button icon={Plus} variant="primary" onClick={() => setDraft(createDraft())}>
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
                onClick={() => setDraft(fromConfig(config))}
              >
                <span className={styles.providerText}>
                  <span className={styles.providerName}>{config.name}</span>
                  <span className={styles.providerMeta}>
                    <span>OpenAI Compatible</span>
                    <span>
                      {config.models.filter((model) => model.enabled).length} 个已启用模型
                    </span>
                    <span>{config.hasApiKey ? '已配置密钥' : '未配置密钥'}</span>
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
        <div className={styles.editorBackdrop} role="presentation">
          <section
            className={styles.editorDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="image-provider-title"
          >
            <header className={styles.editorHeader}>
              <div>
                <span className={styles.editorEyebrow}>
                  {draft.id ? '编辑图像 Provider' : '添加图像 Provider'}
                </span>
                <h2 id="image-provider-title">{draft.name.trim() || '未命名 Provider'}</h2>
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
                description="图像 Provider 的 API Key 使用独立加密存储。"
              >
                <SettingsRow label="配置名称">
                  <input
                    aria-label="图像配置名称"
                    className={styles.input}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </SettingsRow>
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
                            void run('api-key', async () => {
                              const apiKey =
                                (await application.readImageApiKey(draft.id as string)) ?? ''
                              setDraft((current) => (current ? { ...current, apiKey } : current))
                              setApiKeyBaseline(apiKey)
                              setApiKeyLoaded(true)
                              setApiKeyVisible(true)
                            })
                        }}
                      >
                        {apiKeyVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                </SettingsRow>
              </SettingsSection>
              <SettingsSection
                title="图像模型"
                description="从服务获取模型列表，或手动添加模型 ID。"
              >
                <div className={styles.modelToolbar}>
                  <Button
                    icon={Download}
                    disabled={Boolean(busy)}
                    onClick={() =>
                      void run('models', async () => {
                        const discovered = await application.listImageModels(
                          toInput(draft, apiKeyBaseline, apiKeyLoaded)
                        )
                        const existing = new Map(draft.models.map((model) => [model.id, model]))
                        setDraft({
                          ...draft,
                          models: discovered
                            .map(
                              (model) => existing.get(model.id) ?? { id: model.id, enabled: false }
                            )
                            .concat(
                              draft.models.filter(
                                (model) => !discovered.some((item) => item.id === model.id)
                              )
                            )
                        })
                        setFeedback(`获取到 ${discovered.length} 个模型`)
                      })
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
                              models: draft.models.filter((candidate) => candidate.id !== model.id)
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
                      void run('test', async () => {
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
                        setFeedback('连接成功，测试图片已生成')
                      })
                    }
                  >
                    测试连接
                  </Button>
                </div>
                {testPreview ? (
                  <img className={styles.imageTestPreview} alt="测试生成图片" src={testPreview} />
                ) : null}
              </SettingsSection>
            </div>
            <footer className={styles.editorFooter}>
              <div>
                {draft.id ? (
                  <Button
                    icon={Trash2}
                    variant="danger"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      setDeleteTarget(configs.find((config) => config.id === draft.id) ?? null)
                    }
                  >
                    删除 Provider
                  </Button>
                ) : null}
              </div>
              <div className={styles.editorFooterActions}>
                <Button variant="ghost" onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={!draftModified || Boolean(busy)}
                  onClick={saveDraft}
                >
                  保存 Provider
                </Button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
      <ConfirmModal
        danger
        confirmLabel="删除配置"
        message={`将删除“${deleteTarget?.name ?? ''}”的图像配置和加密密钥。`}
        open={Boolean(deleteTarget)}
        title="删除图像 Provider 配置？"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          const target = deleteTarget
          setDeleteTarget(null)
          if (!target) return
          void run('delete', async () => {
            await application.deleteImageConfig(target.id)
            setConfigs((current) => (current ?? []).filter((config) => config.id !== target.id))
            if (settings.mode === 'provider' && settings.providerConfigId === target.id)
              setSettings(await application.getImageSettings())
            closeEditor()
            toast.success(`已删除“${target.name}”`)
          })
        }}
      />
    </SettingsContent>
  )
}

function createDraft(): ImageProviderDraft {
  return {
    name: '',
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
    type: 'openai-compatible',
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

function firstImageModel(
  configs: readonly AIRouterImageProviderConfigSummary[]
): { providerConfigId: string; modelId: string } | null {
  for (const config of configs) {
    const model = config.models.find((candidate) => candidate.enabled)
    if (model) return { providerConfigId: config.id, modelId: model.id }
  }
  return null
}

function modelSelectionValue(providerConfigId: string, modelId: string): string {
  return JSON.stringify([providerConfigId, modelId])
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : '图像生成设置操作失败'
}

interface ImageProviderDraft {
  id?: string
  name: string
  baseUrl: string
  apiKey: string
  hasApiKey: boolean
  models: AIRouterModelConfig[]
}
