import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type {
  AIRouterModelConfig,
  AIRouterSpeechModelPackageSummary,
  AIRouterSpeechProviderConfigInput,
  AIRouterSpeechProviderConfigSummary,
  AIRouterSpeechProviderKind,
  AIRouterSpeechProviderType,
  AIRouterSpeechVoiceConfig
} from '@ls101/airouter'
import {
  AudioLines,
  Box,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Plus,
  Save,
  TestTube2,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
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
import styles from './AIRouterSettingsPage.module.css'

interface SpeechProviderDraft {
  id?: string
  name: string
  kind: AIRouterSpeechProviderKind
  type: AIRouterSpeechProviderType
  baseUrl: string
  modelPackageId: string
  modelPackageVersion: string
  models: AIRouterModelConfig[]
  voices: AIRouterSpeechVoiceConfig[]
  apiKey: string
  hasApiKey: boolean
}

type SpeechFeedbackScope =
  | 'api-key'
  | 'package'
  | 'models'
  | 'test'
  | 'editor'
  | 'delete-provider'
  | 'delete-package'

const providerLabels: Record<AIRouterSpeechProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  'pocket-tts': 'Pocket TTS (WASM)',
  'qwen-tts': 'Qwen TTS'
}

export function AIRouterSpeechSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterSpeechProviderConfigSummary[] | null>(null)
  const loadRequest = useRef(0)
  const [packages, setPackages] = useState<AIRouterSpeechModelPackageSummary[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState<SpeechProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [manualVoice, setManualVoice] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [testVoiceId, setTestVoiceId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<
    Partial<Record<SpeechFeedbackScope, AIRouterFeedbackValue>>
  >({})
  const [apiKeyVisible, setApiKeyVisible] = useState(false)
  const [apiKeyBaseline, setApiKeyBaseline] = useState('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [deleteProviderTarget, setDeleteProviderTarget] =
    useState<AIRouterSpeechProviderConfigSummary | null>(null)
  const [deletePackageTarget, setDeletePackageTarget] =
    useState<AIRouterSpeechModelPackageSummary | null>(null)
  const [testAudioUrl, setTestAudioUrl] = useState<string | null>(null)

  const loadSettings = useCallback(async (): Promise<void> => {
    const requestId = loadRequest.current + 1
    loadRequest.current = requestId
    setLoading(true)
    setLoadError(null)
    try {
      const [nextConfigs, nextPackages] = await Promise.all([
        application.listSpeechConfigs(),
        application.listSpeechPackages()
      ])
      if (requestId !== loadRequest.current) return
      setConfigs(nextConfigs)
      setPackages(nextPackages)
    } catch (reason) {
      if (requestId !== loadRequest.current) return
      setConfigs(null)
      setPackages(null)
      setLoadError(formatAIRouterError(reason, '无法加载语音合成设置'))
    } finally {
      if (requestId === loadRequest.current) setLoading(false)
    }
  }, [application])

  useEffect(() => {
    void loadSettings()
    return () => {
      loadRequest.current += 1
    }
  }, [loadSettings])

  useEffect(
    () => () => {
      if (testAudioUrl) URL.revokeObjectURL(testAudioUrl)
    },
    [testAudioUrl]
  )

  const localPackages =
    draft?.kind === 'local'
      ? (packages ?? []).filter((item) => item.runtime.engine === draft.type)
      : []
  const selectedPackage =
    draft?.kind === 'local'
      ? localPackages.find(
          (item) =>
            item.package.id === draft.modelPackageId &&
            item.package.version === draft.modelPackageVersion
        )
      : undefined
  const enabledModels = draft?.models.filter((model) => model.enabled) ?? []
  const enabledVoices = draft?.voices.filter((voice) => voice.enabled) ?? []
  const selectedTestModel = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')
  const selectedTestVoice = enabledVoices.some((voice) => voice.id === testVoiceId)
    ? testVoiceId
    : (enabledVoices[0]?.id ?? '')
  const persistedConfig = draft?.id ? configs?.find((config) => config.id === draft.id) : undefined
  const draftModified = draft
    ? isModified(draft, persistedConfig, apiKeyBaseline, apiKeyLoaded)
    : false

  const run = async (
    operation: string,
    action: () => Promise<void>,
    feedbackScope: SpeechFeedbackScope
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
          text: formatAIRouterError(reason, '语音合成设置操作失败')
        }
      }))
    } finally {
      setBusy(null)
    }
  }

  const resetEditorState = (): void => {
    if (testAudioUrl) URL.revokeObjectURL(testAudioUrl)
    setTestAudioUrl(null)
    setManualModel('')
    setManualVoice('')
    setTestModelId('')
    setTestVoiceId('')
    setApiKeyVisible(false)
    setApiKeyBaseline('')
    setApiKeyLoaded(false)
    setFeedback({})
  }

  const openEditor = (nextDraft: SpeechProviderDraft): void => {
    resetEditorState()
    setDraft(nextDraft)
  }

  const closeEditor = (): void => {
    if (busy) return
    setDraft(null)
    resetEditorState()
  }

  const selectPackage = (
    current: SpeechProviderDraft,
    modelPackage: AIRouterSpeechModelPackageSummary
  ): SpeechProviderDraft => {
    const samePackage =
      current.modelPackageId === modelPackage.package.id &&
      current.modelPackageVersion === modelPackage.package.version
    return {
      ...current,
      modelPackageId: modelPackage.package.id,
      modelPackageVersion: modelPackage.package.version,
      models: modelPackage.models.map((model) => ({
        id: model.id,
        enabled: samePackage
          ? (current.models.find((item) => item.id === model.id)?.enabled ?? true)
          : true
      })),
      voices: modelPackage.voices.map((voice) => ({
        id: voice.id,
        enabled: samePackage
          ? (current.voices.find((item) => item.id === voice.id)?.enabled ?? true)
          : true
      }))
    }
  }

  const importPackage = async (): Promise<void> => {
    const result = await application.importSpeechPackage()
    if (!result) return
    const nextPackages = await application.listSpeechPackages()
    setPackages(nextPackages)
    setDraft((current) => {
      if (!current || current.kind !== 'local' || current.type !== result.package.runtime.engine) {
        return current
      }
      return selectPackage(current, result.package)
    })
    toast.success(
      `已导入“${result.package.package.name}”，新增 ${result.storedAssetCount} 个资源，复用 ${result.reusedAssetCount} 个资源`
    )
  }

  if (!configs || !packages) {
    return loadError ? (
      <AIRouterPageError
        message={loadError}
        onRetry={() => void loadSettings()}
        retrying={loading}
        title="无法加载语音合成设置"
      />
    ) : (
      <AIRouterPageLoading message="正在加载语音合成设置..." />
    )
  }

  return (
    <SettingsContent>
      <SettingsSection
        title="语音 Provider"
        description="管理在线语音服务和使用本地模型包的离线语音运行时。"
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
                onClick={() => openEditor(fromConfig(config))}
                type="button"
              >
                <span className={styles.providerText}>
                  <span className={styles.providerName}>{config.name}</span>
                  <span className={styles.providerMeta}>
                    <span>{providerLabels[config.type]}</span>
                    <span>{config.kind === 'local' ? '本地' : '在线'}</span>
                    <span>{config.models.filter((model) => model.enabled).length} 个模型</span>
                    <span>{config.voices.filter((voice) => voice.enabled).length} 个音色</span>
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className={styles.providerArrow} />
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyProviders}>
            <AudioLines aria-hidden="true" />
            <span>尚未添加语音 Provider</span>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="TTS 模型包"
        description="导入本地语音运行时所需的 ZIP 模型包；相同资源会按哈希复用。"
      >
        <div className={styles.providerToolbar}>
          <span>已安装 {packages.length} 个模型包</span>
          <Button
            icon={Upload}
            variant="primary"
            disabled={Boolean(busy)}
            onClick={() => void run('import-package', importPackage, 'package')}
          >
            导入模型包
          </Button>
        </div>
        {!draft ? <AIRouterOperationFeedback value={feedback.package} /> : null}
        {packages.length ? (
          <div className={styles.packageList}>
            {packages.map((modelPackage) => {
              const references = configs.filter(
                (config) =>
                  config.modelPackageId === modelPackage.package.id &&
                  config.modelPackageVersion === modelPackage.package.version
              )
              return (
                <div
                  className={styles.packageItem}
                  key={packageKey(modelPackage.package.id, modelPackage.package.version)}
                >
                  <Box aria-hidden="true" className={styles.packageIcon} />
                  <span className={styles.packageText}>
                    <span className={styles.packageTitle}>
                      {modelPackage.package.name}
                      <span>v{modelPackage.package.version}</span>
                    </span>
                    <span className={styles.providerMeta}>
                      <span>{providerLabels[modelPackage.runtime.engine]}</span>
                      <span>{modelPackage.models.length} 个模型</span>
                      <span>{modelPackage.voices.length} 个音色</span>
                      <span>{formatBytes(modelPackage.totalBytes)}</span>
                      {references.length ? (
                        <span>{references.length} 个 Provider 使用中</span>
                      ) : null}
                    </span>
                    {modelPackage.package.description ? (
                      <span className={styles.packageDescription}>
                        {modelPackage.package.description}
                      </span>
                    ) : null}
                  </span>
                  <button
                    aria-label={`删除模型包 ${modelPackage.package.name}`}
                    className={styles.removeModel}
                    disabled={Boolean(references.length) || Boolean(busy)}
                    onClick={() => {
                      setFeedback((current) => ({ ...current, 'delete-package': undefined }))
                      setDeletePackageTarget(modelPackage)
                    }}
                    title={references.length ? '模型包正在被 Provider 使用' : '删除模型包'}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className={styles.packageEmpty}>
            <FolderOpen aria-hidden="true" />
            <span>尚未导入本地 TTS 模型包</span>
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
                    {draft.id ? '编辑语音 Provider' : '添加语音 Provider'}
                  </span>
                </ModalDescription>
                <ModalTitle asChild>
                  <h2>{draft.name.trim() || '未命名 Provider'}</h2>
                </ModalTitle>
              </div>
              <button
                aria-label="关闭语音 Provider 编辑器"
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
              <SettingsSection title="基础配置">
                <SettingsRow label="配置名称">
                  <input
                    aria-label="语音配置名称"
                    autoFocus
                    className={styles.input}
                    disabled={Boolean(busy)}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    placeholder="例如：本地英文语音"
                    value={draft.name}
                  />
                </SettingsRow>
                <SettingsRow label="运行方式">
                  <select
                    aria-label="语音运行方式"
                    className={styles.input}
                    disabled={Boolean(draft.id) || Boolean(busy)}
                    onChange={(event) => {
                      const kind = event.target.value as AIRouterSpeechProviderKind
                      setDraft({
                        ...draft,
                        kind,
                        type: kind === 'online' ? 'openai-compatible' : 'pocket-tts',
                        baseUrl: kind === 'online' ? 'https://api.openai.com/v1' : '',
                        modelPackageId: '',
                        modelPackageVersion: '',
                        models: [],
                        voices: [],
                        apiKey: '',
                        hasApiKey: false
                      })
                    }}
                    value={draft.kind}
                  >
                    <option value="online">在线 Provider</option>
                    <option value="local">本地 Provider</option>
                  </select>
                </SettingsRow>
                <SettingsRow label="Provider 类型">
                  <select
                    aria-label="语音 Provider 类型"
                    className={styles.input}
                    disabled={Boolean(draft.id) || Boolean(busy)}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        type: event.target.value as AIRouterSpeechProviderType,
                        modelPackageId: '',
                        modelPackageVersion: '',
                        models: [],
                        voices: []
                      })
                    }
                    value={draft.type}
                  >
                    {draft.kind === 'online' ? (
                      <option value="openai-compatible">OpenAI Compatible</option>
                    ) : (
                      <option value="pocket-tts">Pocket TTS (WASM)</option>
                    )}
                  </select>
                </SettingsRow>
                {draft.kind === 'online' ? (
                  <>
                    <SettingsRow label="Base URL">
                      <input
                        aria-label="语音 Base URL"
                        className={styles.inputWide}
                        disabled={Boolean(busy)}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                        value={draft.baseUrl}
                      />
                    </SettingsRow>
                    <SettingsRow label="API Key" description="本地无鉴权兼容服务可以留空。">
                      <div className={styles.secretControl}>
                        <div className={styles.secretInputWrap}>
                          <input
                            aria-label="语音 API Key"
                            autoComplete="new-password"
                            className={styles.inputWide}
                            disabled={Boolean(busy)}
                            onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                            placeholder={draft.hasApiKey ? '已安全保存' : '输入 API Key'}
                            type={apiKeyVisible ? 'text' : 'password'}
                            value={draft.apiKey}
                          />
                          <button
                            aria-label={apiKeyVisible ? '隐藏语音 API Key' : '显示语音 API Key'}
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
                                  const apiKey = (await application.readSpeechApiKey(id)) ?? ''
                                  setDraft((current) =>
                                    current?.id === id ? { ...current, apiKey } : current
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

              {draft.kind === 'local' ? (
                localPackages.length ? (
                  <>
                    <SettingsSection
                      title="模型包"
                      description="选择与当前本地运行时兼容的模型包。"
                    >
                      <SettingsRow label="已安装模型包">
                        <select
                          aria-label="本地 TTS 模型包"
                          className={styles.inputWide}
                          disabled={Boolean(busy)}
                          onChange={(event) => {
                            const modelPackage = localPackages.find(
                              (item) =>
                                packageKey(item.package.id, item.package.version) ===
                                event.target.value
                            )
                            if (modelPackage) setDraft(selectPackage(draft, modelPackage))
                          }}
                          value={
                            selectedPackage
                              ? packageKey(
                                  selectedPackage.package.id,
                                  selectedPackage.package.version
                                )
                              : ''
                          }
                        >
                          <option value="">选择模型包</option>
                          {localPackages.map((modelPackage) => (
                            <option
                              key={packageKey(
                                modelPackage.package.id,
                                modelPackage.package.version
                              )}
                              value={packageKey(
                                modelPackage.package.id,
                                modelPackage.package.version
                              )}
                            >
                              {modelPackage.package.name} v{modelPackage.package.version}
                            </option>
                          ))}
                        </select>
                      </SettingsRow>
                    </SettingsSection>
                    {selectedPackage ? (
                      <ModelVoiceSections
                        draft={draft}
                        modelPackage={selectedPackage}
                        setDraft={setDraft}
                      />
                    ) : (
                      <div className={styles.localPackagePrompt}>
                        <Box aria-hidden="true" />
                        <span>请选择一个模型包后配置模型和音色</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className={styles.localPackagePrompt}>
                    <FolderOpen aria-hidden="true" />
                    <strong>需要先导入 Pocket TTS 模型包</strong>
                    <span>当前没有与该本地 Provider 兼容的模型包。</span>
                    <Button
                      icon={Upload}
                      variant="primary"
                      disabled={Boolean(busy)}
                      onClick={() => void run('import-package', importPackage, 'package')}
                    >
                      导入模型包
                    </Button>
                    <AIRouterOperationFeedback value={feedback.package} />
                  </div>
                )
              ) : (
                <>
                  <SettingsSection
                    title="Model ID"
                    description="从兼容服务获取模型列表，或手动添加模型 ID。"
                  >
                    <div className={styles.modelToolbar}>
                      <Button
                        icon={Download}
                        disabled={Boolean(busy)}
                        onClick={() =>
                          void run(
                            'models',
                            async () => {
                              const discovered = await application.listSpeechModels(
                                toInput(draft, apiKeyBaseline, apiKeyLoaded)
                              )
                              const existing = new Map(
                                draft.models.map((model) => [model.id, model])
                              )
                              setDraft({
                                ...draft,
                                models: discovered
                                  .map(
                                    (model) =>
                                      existing.get(model.id) ?? { id: model.id, enabled: false }
                                  )
                                  .concat(
                                    draft.models.filter(
                                      (model) =>
                                        !discovered.some((candidate) => candidate.id === model.id)
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
                      <ManualEntry
                        ariaLabel="手动语音模型 ID"
                        disabled={Boolean(busy)}
                        value={manualModel}
                        onChange={setManualModel}
                        onAdd={() => {
                          const id = manualModel.trim()
                          if (id && !draft.models.some((model) => model.id === id)) {
                            setDraft({
                              ...draft,
                              models: [...draft.models, { id, enabled: true }]
                            })
                          }
                          setManualModel('')
                        }}
                      />
                    </div>
                    <AIRouterOperationFeedback
                      className={styles.modelFeedback}
                      value={feedback.models}
                    />
                    <ToggleList
                      empty="尚未添加模型。"
                      items={draft.models}
                      itemLabel={(id) => id}
                      removeLabel="移除语音模型"
                      onChange={(models) => setDraft({ ...draft, models })}
                    />
                  </SettingsSection>
                  <SettingsSection
                    title="Voice ID"
                    description="添加 OpenAI Compatible 服务支持的音色 ID。"
                  >
                    <div className={styles.modelToolbar}>
                      <span className={styles.modelToggle}>
                        已配置 {draft.voices.length} 个音色
                      </span>
                      <ManualEntry
                        ariaLabel="手动语音音色 ID"
                        disabled={Boolean(busy)}
                        value={manualVoice}
                        onChange={setManualVoice}
                        onAdd={() => {
                          const id = manualVoice.trim()
                          if (id && !draft.voices.some((voice) => voice.id === id)) {
                            setDraft({
                              ...draft,
                              voices: [...draft.voices, { id, enabled: true }]
                            })
                          }
                          setManualVoice('')
                        }}
                      />
                    </div>
                    <ToggleList
                      empty="尚未添加音色。"
                      items={draft.voices}
                      itemLabel={(id) => id}
                      removeLabel="移除语音音色"
                      onChange={(voices) => setDraft({ ...draft, voices })}
                    />
                  </SettingsSection>
                </>
              )}

              {enabledModels.length && enabledVoices.length ? (
                <SettingsSection
                  title="连接测试"
                  description="使用已启用的模型和音色合成一段测试语音。"
                >
                  <div className={styles.speechTestControls}>
                    <select
                      aria-label="测试语音模型"
                      className={styles.input}
                      disabled={Boolean(busy)}
                      onChange={(event) => setTestModelId(event.target.value)}
                      value={selectedTestModel}
                    >
                      {enabledModels.map((model) => (
                        <option key={model.id} value={model.id}>
                          {optionName(model.id, selectedPackage?.models)}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="测试语音音色"
                      className={styles.input}
                      disabled={Boolean(busy)}
                      onChange={(event) => setTestVoiceId(event.target.value)}
                      value={selectedTestVoice}
                    >
                      {enabledVoices.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {optionName(voice.id, selectedPackage?.voices)}
                        </option>
                      ))}
                    </select>
                    <Button
                      icon={TestTube2}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run(
                          'test',
                          async () => {
                            const result = await application.testSpeechConnection({
                              config: toInput(draft, apiKeyBaseline, apiKeyLoaded),
                              modelId: selectedTestModel,
                              voiceId: selectedTestVoice
                            })
                            const url = URL.createObjectURL(
                              new Blob([new Uint8Array(result.audio.data)], {
                                type: result.audio.mediaType
                              })
                            )
                            setTestAudioUrl((current) => {
                              if (current) URL.revokeObjectURL(current)
                              return url
                            })
                            setFeedback((current) => ({
                              ...current,
                              test: { kind: 'success', text: '测试语音合成成功' }
                            }))
                          },
                          'test'
                        )
                      }
                    >
                      测试合成
                    </Button>
                    <AIRouterOperationFeedback value={feedback.test} />
                  </div>
                  {testAudioUrl ? (
                    <audio className={styles.speechTestAudio} controls src={testAudioUrl} />
                  ) : null}
                </SettingsSection>
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
                      const config = configs.find((item) => item.id === draft.id)
                      if (!config) return
                      setFeedback((current) => ({ ...current, 'delete-provider': undefined }))
                      setDeleteProviderTarget(config)
                    }}
                  >
                    删除 Provider
                  </Button>
                ) : null}
              </div>
              <AIRouterOperationFeedback value={feedback.editor} />
              <div className={styles.editorFooterActions}>
                <Button disabled={Boolean(busy)} onClick={closeEditor}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={Boolean(busy) || !draft.name.trim() || !draftModified}
                  onClick={() =>
                    void run(
                      'save',
                      async () => {
                        const saved = await application.saveSpeechConfig(
                          toInput(draft, apiKeyBaseline, apiKeyLoaded)
                        )
                        setConfigs((current) => upsert(current ?? [], saved))
                        setDraft(fromConfig(saved))
                        setApiKeyVisible(false)
                        setApiKeyBaseline('')
                        setApiKeyLoaded(false)
                        toast.success(`已保存“${saved.name}”`)
                      },
                      'editor'
                    )
                  }
                >
                  保存 Provider
                </Button>
              </div>
            </footer>
          </section>
        </Modal>
      ) : null}

      <ConfirmModal
        busy={busy === 'delete-provider'}
        closeOnConfirm={false}
        danger
        confirmLabel="删除 Provider"
        error={
          feedback['delete-provider']?.kind === 'error' ? feedback['delete-provider'].text : null
        }
        message={`将删除“${deleteProviderTarget?.name ?? ''}”及其独立保存的 API Key。`}
        open={Boolean(deleteProviderTarget)}
        title="删除语音 Provider？"
        onCancel={() => {
          setDeleteProviderTarget(null)
          setFeedback((current) => ({ ...current, 'delete-provider': undefined }))
        }}
        onConfirm={() => {
          const target = deleteProviderTarget
          if (!target) return
          void run(
            'delete-provider',
            async () => {
              await application.deleteSpeechConfig(target.id)
              setConfigs((current) => (current ?? []).filter((item) => item.id !== target.id))
              setDraft(null)
              resetEditorState()
              setDeleteProviderTarget(null)
              toast.success(`已删除“${target.name}”`)
            },
            'delete-provider'
          )
        }}
      />
      <ConfirmModal
        busy={busy === 'delete-package'}
        closeOnConfirm={false}
        danger
        confirmLabel="删除模型包"
        error={
          feedback['delete-package']?.kind === 'error' ? feedback['delete-package'].text : null
        }
        message={`将删除“${deletePackageTarget?.package.name ?? ''}”及未被其他模型包引用的资源。`}
        open={Boolean(deletePackageTarget)}
        title="删除 TTS 模型包？"
        onCancel={() => {
          setDeletePackageTarget(null)
          setFeedback((current) => ({ ...current, 'delete-package': undefined }))
        }}
        onConfirm={() => {
          const target = deletePackageTarget
          if (!target) return
          void run(
            'delete-package',
            async () => {
              await application.deleteSpeechPackage(target.package.id, target.package.version)
              setPackages((current) =>
                (current ?? []).filter(
                  (item) =>
                    item.package.id !== target.package.id ||
                    item.package.version !== target.package.version
                )
              )
              setDeletePackageTarget(null)
              toast.success(`已删除“${target.package.name}”`)
            },
            'delete-package'
          )
        }}
      />
    </SettingsContent>
  )
}

function ModelVoiceSections({
  draft,
  modelPackage,
  setDraft
}: {
  draft: SpeechProviderDraft
  modelPackage: AIRouterSpeechModelPackageSummary
  setDraft: (draft: SpeechProviderDraft) => void
}): JSX.Element {
  return (
    <>
      <SettingsSection title="启用模型" description="选择这个 Provider 可以使用的模型。">
        <ToggleList
          empty="模型包中没有模型。"
          items={draft.models}
          itemLabel={(id) => optionName(id, modelPackage.models)}
          onChange={(models) => setDraft({ ...draft, models })}
        />
      </SettingsSection>
      <SettingsSection title="启用音色" description="模型包中的音色适用于包内全部模型。">
        <ToggleList
          empty="模型包中没有音色。"
          items={draft.voices}
          itemLabel={(id) => optionName(id, modelPackage.voices)}
          onChange={(voices) => setDraft({ ...draft, voices })}
        />
      </SettingsSection>
    </>
  )
}

function ManualEntry({
  ariaLabel,
  disabled,
  value,
  onChange,
  onAdd
}: {
  ariaLabel: string
  disabled: boolean
  value: string
  onChange: (value: string) => void
  onAdd: () => void
}): JSX.Element {
  return (
    <div className={styles.addModel}>
      <input
        aria-label={ariaLabel}
        className={styles.input}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
      <Button icon={Plus} size="small" disabled={disabled || !value.trim()} onClick={onAdd}>
        添加
      </Button>
    </div>
  )
}

function ToggleList<T extends { id: string; enabled: boolean }>({
  empty,
  items,
  itemLabel,
  removeLabel,
  onChange
}: {
  empty: string
  items: T[]
  itemLabel: (id: string) => string
  removeLabel?: string
  onChange: (items: T[]) => void
}): JSX.Element {
  if (!items.length) return <p className={styles.emptyModels}>{empty}</p>
  return (
    <div className={styles.modelList}>
      {items.map((item) => (
        <div className={styles.modelItem} key={item.id}>
          <label className={styles.modelToggle}>
            <input
              checked={item.enabled}
              onChange={(event) =>
                onChange(
                  items.map((candidate) =>
                    candidate.id === item.id
                      ? { ...candidate, enabled: event.target.checked }
                      : candidate
                  )
                )
              }
              type="checkbox"
            />
            <span>{itemLabel(item.id)}</span>
          </label>
          {removeLabel ? (
            <button
              aria-label={`${removeLabel} ${item.id}`}
              className={styles.removeModel}
              onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}
              type="button"
            >
              <Trash2 aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function createDraft(): SpeechProviderDraft {
  return {
    name: '',
    kind: 'online',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelPackageId: '',
    modelPackageVersion: '',
    models: [],
    voices: [],
    apiKey: '',
    hasApiKey: false
  }
}

function fromConfig(config: AIRouterSpeechProviderConfigSummary): SpeechProviderDraft {
  return {
    ...config,
    models: config.models.map((model) => ({ ...model })),
    voices: config.voices.map((voice) => ({ ...voice })),
    apiKey: ''
  }
}

function toInput(
  draft: SpeechProviderDraft,
  apiKeyBaseline: string,
  apiKeyLoaded: boolean
): AIRouterSpeechProviderConfigInput {
  const clearApiKey = draft.kind === 'online' && apiKeyLoaded && draft.hasApiKey && !draft.apiKey
  return {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    type: draft.type,
    baseUrl: draft.kind === 'online' ? draft.baseUrl : undefined,
    modelPackageId: draft.kind === 'local' ? draft.modelPackageId : undefined,
    modelPackageVersion: draft.kind === 'local' ? draft.modelPackageVersion : undefined,
    models: draft.models,
    voices: draft.voices,
    apiKey:
      draft.kind === 'online' && !clearApiKey && draft.apiKey !== apiKeyBaseline
        ? draft.apiKey
        : undefined,
    clearApiKey
  }
}

function isModified(
  draft: SpeechProviderDraft,
  saved: AIRouterSpeechProviderConfigSummary | undefined,
  apiKeyBaseline: string,
  apiKeyLoaded: boolean
): boolean {
  if (!saved) return true
  if (
    draft.kind === 'online' &&
    (draft.apiKey !== apiKeyBaseline || (apiKeyLoaded && draft.hasApiKey && !draft.apiKey))
  ) {
    return true
  }
  return (
    draft.name !== saved.name ||
    draft.kind !== saved.kind ||
    draft.type !== saved.type ||
    draft.baseUrl !== saved.baseUrl ||
    draft.modelPackageId !== saved.modelPackageId ||
    draft.modelPackageVersion !== saved.modelPackageVersion ||
    JSON.stringify(draft.models) !== JSON.stringify(saved.models) ||
    JSON.stringify(draft.voices) !== JSON.stringify(saved.voices)
  )
}

function upsert(
  configs: AIRouterSpeechProviderConfigSummary[],
  saved: AIRouterSpeechProviderConfigSummary
): AIRouterSpeechProviderConfigSummary[] {
  return configs.some((config) => config.id === saved.id)
    ? configs.map((config) => (config.id === saved.id ? saved : config))
    : [...configs, saved]
}

function packageKey(id: string, version: string): string {
  return `${id}@${version}`
}

function optionName(
  id: string,
  options: ReadonlyArray<{ id: string; name: string }> | undefined
): string {
  const name = options?.find((item) => item.id === id)?.name
  return name && name !== id ? `${name} (${id})` : id
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}
