import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type {
  AIRouterModelConfig,
  AIRouterSpeechRecognitionModelPackageSummary,
  AIRouterSpeechRecognitionProviderConfigInput,
  AIRouterSpeechRecognitionProviderConfigSummary,
  AIRouterSpeechRecognitionProviderKind,
  AIRouterSpeechRecognitionProviderType
} from '@ls101/airouter'
import {
  Box,
  ChevronRight,
  Download,
  FolderOpen,
  Mic,
  Plus,
  Save,
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

interface RecognitionDraft {
  id?: string
  name: string
  kind: AIRouterSpeechRecognitionProviderKind
  type: AIRouterSpeechRecognitionProviderType
  baseUrl: string
  modelPackageId: string
  modelPackageVersion: string
  models: AIRouterModelConfig[]
  apiKey: string
  hasApiKey: boolean
}

type FeedbackScope = 'package' | 'models' | 'editor' | 'delete-provider' | 'delete-package'

const providerLabels: Record<AIRouterSpeechRecognitionProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  'qwen3-asr': 'Qwen3 ASR (CPU)'
}

export function AIRouterSpeechRecognitionSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterSpeechRecognitionProviderConfigSummary[] | null>(
    null
  )
  const [packages, setPackages] = useState<AIRouterSpeechRecognitionModelPackageSummary[] | null>(
    null
  )
  const [draft, setDraft] = useState<RecognitionDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Partial<Record<FeedbackScope, AIRouterFeedbackValue>>>(
    {}
  )
  const [deleteProvider, setDeleteProvider] =
    useState<AIRouterSpeechRecognitionProviderConfigSummary | null>(null)
  const [deletePackage, setDeletePackage] =
    useState<AIRouterSpeechRecognitionModelPackageSummary | null>(null)
  const loadRequest = useRef(0)

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++loadRequest.current
    setLoadError(null)
    try {
      const [nextConfigs, nextPackages] = await Promise.all([
        application.listSpeechRecognitionConfigs(),
        application.listSpeechRecognitionPackages()
      ])
      if (requestId !== loadRequest.current) return
      setConfigs(nextConfigs)
      setPackages(nextPackages)
    } catch (error) {
      if (requestId !== loadRequest.current) return
      setLoadError(formatAIRouterError(error, '无法加载语音识别设置'))
    }
  }, [application])

  useEffect(() => {
    void load()
    return () => {
      loadRequest.current += 1
    }
  }, [load])

  const run = async (
    operation: string,
    scope: FeedbackScope,
    action: () => Promise<void>
  ): Promise<void> => {
    setBusy(operation)
    setFeedback((current) => ({ ...current, [scope]: undefined }))
    try {
      await action()
    } catch (error) {
      setFeedback((current) => ({
        ...current,
        [scope]: { kind: 'error', text: formatAIRouterError(error, '语音识别设置操作失败') }
      }))
    } finally {
      setBusy(null)
    }
  }

  if (!configs || !packages) {
    return loadError ? (
      <AIRouterPageError
        message={loadError}
        onRetry={() => void load()}
        retrying={false}
        title="无法加载语音识别设置"
      />
    ) : (
      <AIRouterPageLoading message="正在加载语音识别设置..." />
    )
  }

  const localPackages =
    draft?.kind === 'local' ? packages.filter((item) => item.runtime.engine === draft.type) : []
  const selectedPackage = localPackages.find(
    (item) =>
      item.package.id === draft?.modelPackageId &&
      item.package.version === draft.modelPackageVersion
  )

  const importPackage = async (): Promise<void> => {
    const result = await application.importSpeechRecognitionPackage()
    if (!result) return
    const nextPackages = await application.listSpeechRecognitionPackages()
    setPackages(nextPackages)
    setDraft((current) =>
      current?.kind === 'local' && current.type === result.package.runtime.engine
        ? selectPackage(current, result.package)
        : current
    )
    toast.success(`已导入“${result.package.package.name}”`)
  }

  return (
    <SettingsContent>
      <SettingsSection
        title="语音识别 Provider"
        description="管理在线转写服务和使用本地模型包的离线识别运行时。"
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
                onClick={() => setDraft(fromConfig(config))}
                type="button"
              >
                <span className={styles.providerText}>
                  <span className={styles.providerName}>{config.name}</span>
                  <span className={styles.providerMeta}>
                    <span>{providerLabels[config.type]}</span>
                    <span>{config.kind === 'local' ? '本地' : '在线'}</span>
                    <span>{config.models.filter((model) => model.enabled).length} 个模型</span>
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className={styles.providerArrow} />
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.emptyProviders}>
            <Mic aria-hidden="true" />
            <span>尚未添加语音识别 Provider</span>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="ASR 模型包"
        description="导入本地识别运行时所需的 ZIP 模型包；相同资源会按哈希复用。"
      >
        <div className={styles.providerToolbar}>
          <span>已安装 {packages.length} 个模型包</span>
          <Button
            icon={Upload}
            variant="primary"
            disabled={Boolean(busy)}
            onClick={() => void run('import-package', 'package', importPackage)}
          >
            导入模型包
          </Button>
        </div>
        <AIRouterOperationFeedback value={feedback.package} />
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
                      <span>{formatBytes(modelPackage.totalBytes)}</span>
                      {references.length ? (
                        <span>{references.length} 个 Provider 使用中</span>
                      ) : null}
                    </span>
                  </span>
                  <button
                    aria-label={`删除模型包 ${modelPackage.package.name}`}
                    className={styles.removeModel}
                    disabled={Boolean(references.length) || Boolean(busy)}
                    onClick={() => setDeletePackage(modelPackage)}
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
            <span>尚未导入本地 ASR 模型包</span>
          </div>
        )}
      </SettingsSection>

      {draft ? (
        <Modal
          open
          overlayClassName={styles.editorBackdrop}
          onOpenChange={(open) => {
            if (!open && !busy) setDraft(null)
          }}
        >
          <section className={styles.editorDialog}>
            <header className={styles.editorHeader}>
              <div>
                <ModalDescription asChild>
                  <span className={styles.editorEyebrow}>
                    {draft.id ? '编辑语音识别 Provider' : '添加语音识别 Provider'}
                  </span>
                </ModalDescription>
                <ModalTitle asChild>
                  <h2>{draft.name.trim() || '未命名 Provider'}</h2>
                </ModalTitle>
              </div>
              <button
                aria-label="关闭语音识别 Provider 编辑器"
                className={styles.closeEditor}
                disabled={Boolean(busy)}
                onClick={() => setDraft(null)}
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </header>
            <div className={styles.editorBody}>
              <SettingsSection title="基础配置">
                <SettingsRow label="配置名称">
                  <input
                    aria-label="语音识别配置名称"
                    autoFocus
                    className={styles.input}
                    disabled={Boolean(busy)}
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </SettingsRow>
                <SettingsRow label="运行方式">
                  <select
                    aria-label="语音识别运行方式"
                    className={styles.input}
                    disabled={Boolean(draft.id) || Boolean(busy)}
                    value={draft.kind}
                    onChange={(event) => {
                      const kind = event.target.value as AIRouterSpeechRecognitionProviderKind
                      setDraft({
                        ...draft,
                        kind,
                        type: kind === 'online' ? 'openai-compatible' : 'qwen3-asr',
                        baseUrl: kind === 'online' ? 'https://api.openai.com/v1' : '',
                        modelPackageId: '',
                        modelPackageVersion: '',
                        models: [],
                        apiKey: '',
                        hasApiKey: false
                      })
                    }}
                  >
                    <option value="online">在线 Provider</option>
                    <option value="local">本地 Provider</option>
                  </select>
                </SettingsRow>
                <SettingsRow label="Provider 类型">
                  <select
                    aria-label="语音识别 Provider 类型"
                    className={styles.input}
                    disabled
                    value={draft.type}
                  >
                    <option value={draft.type}>{providerLabels[draft.type]}</option>
                  </select>
                </SettingsRow>
                {draft.kind === 'online' ? (
                  <>
                    <SettingsRow label="Base URL">
                      <input
                        aria-label="语音识别 Base URL"
                        className={styles.inputWide}
                        disabled={Boolean(busy)}
                        value={draft.baseUrl}
                        onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })}
                      />
                    </SettingsRow>
                    <SettingsRow
                      label="API Key"
                      description={
                        draft.hasApiKey
                          ? '已安全保存；留空可继续使用原密钥。'
                          : '本地无鉴权兼容服务可以留空。'
                      }
                    >
                      <input
                        aria-label="语音识别 API Key"
                        autoComplete="new-password"
                        className={styles.inputWide}
                        disabled={Boolean(busy)}
                        placeholder={draft.hasApiKey ? '已安全保存' : '输入 API Key'}
                        type="password"
                        value={draft.apiKey}
                        onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
                      />
                    </SettingsRow>
                  </>
                ) : null}
              </SettingsSection>

              {draft.kind === 'local' ? (
                <SettingsSection
                  title="模型包"
                  description="选择与 Qwen3 ASR 本地运行时兼容的模型包。"
                >
                  {localPackages.length ? (
                    <SettingsRow label="已安装模型包">
                      <select
                        aria-label="本地 ASR 模型包"
                        className={styles.inputWide}
                        disabled={Boolean(busy)}
                        value={
                          selectedPackage
                            ? packageKey(
                                selectedPackage.package.id,
                                selectedPackage.package.version
                              )
                            : ''
                        }
                        onChange={(event) => {
                          const item = localPackages.find(
                            (candidate) =>
                              packageKey(candidate.package.id, candidate.package.version) ===
                              event.target.value
                          )
                          if (item) setDraft(selectPackage(draft, item))
                        }}
                      >
                        <option value="">选择模型包</option>
                        {localPackages.map((item) => (
                          <option
                            key={packageKey(item.package.id, item.package.version)}
                            value={packageKey(item.package.id, item.package.version)}
                          >
                            {item.package.name} v{item.package.version}
                          </option>
                        ))}
                      </select>
                    </SettingsRow>
                  ) : (
                    <div className={styles.localPackagePrompt}>
                      <FolderOpen aria-hidden="true" />
                      <span>请先导入 Qwen3 ASR 模型包</span>
                      <Button
                        icon={Upload}
                        disabled={Boolean(busy)}
                        onClick={() => void run('import-package', 'package', importPackage)}
                      >
                        导入模型包
                      </Button>
                    </div>
                  )}
                </SettingsSection>
              ) : (
                <SettingsSection
                  title="Model ID"
                  description="从兼容服务获取模型列表，或手动添加模型 ID。"
                >
                  <div className={styles.modelToolbar}>
                    <Button
                      icon={Download}
                      disabled={Boolean(busy)}
                      onClick={() =>
                        void run('models', 'models', async () => {
                          const discovered = await application.listSpeechRecognitionModels(
                            toInput(draft)
                          )
                          setDraft({
                            ...draft,
                            models: mergeModels(
                              draft.models,
                              discovered.map((item) => ({
                                id: item.modelId,
                                enabled: false,
                                metadata: { name: item.modelName }
                              }))
                            )
                          })
                          setFeedback((current) => ({
                            ...current,
                            models: { kind: 'success', text: `获取到 ${discovered.length} 个模型` }
                          }))
                        })
                      }
                    >
                      获取模型列表
                    </Button>
                    <div className={styles.addModel}>
                      <input
                        aria-label="手动语音识别模型 ID"
                        className={styles.input}
                        disabled={Boolean(busy)}
                        value={manualModel}
                        onChange={(event) => setManualModel(event.target.value)}
                      />
                      <Button
                        icon={Plus}
                        size="small"
                        disabled={!manualModel.trim() || Boolean(busy)}
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
                </SettingsSection>
              )}

              {draft.kind === 'online' || selectedPackage ? (
                <SettingsSection
                  title="启用模型"
                  description="只有已启用模型会出现在考试和批改配置中。"
                >
                  <ModelList
                    models={draft.models}
                    removable={draft.kind === 'online'}
                    names={selectedPackage?.models ?? []}
                    onChange={(models) => setDraft({ ...draft, models })}
                  />
                </SettingsSection>
              ) : null}
              <AIRouterOperationFeedback value={feedback.editor} />
            </div>
            <footer className={styles.editorFooter}>
              {draft.id ? (
                <Button
                  icon={Trash2}
                  variant="danger"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    setDeleteProvider(configs.find((item) => item.id === draft.id) ?? null)
                  }
                >
                  删除 Provider
                </Button>
              ) : (
                <span />
              )}
              <div className={styles.editorActions}>
                <Button disabled={Boolean(busy)} onClick={() => setDraft(null)}>
                  取消
                </Button>
                <Button
                  icon={Save}
                  variant="primary"
                  disabled={
                    Boolean(busy) ||
                    !draft.name.trim() ||
                    !draft.models.some((model) => model.enabled) ||
                    (draft.kind === 'local' && !selectedPackage)
                  }
                  onClick={() =>
                    void run('save', 'editor', async () => {
                      const saved = await application.saveSpeechRecognitionConfig(toInput(draft))
                      setConfigs((current) => upsert(current ?? [], saved))
                      setDraft(fromConfig(saved))
                      toast.success(`已保存“${saved.name}”`)
                    })
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
        open={Boolean(deleteProvider)}
        title="删除语音识别 Provider？"
        message={`将删除“${deleteProvider?.name ?? ''}”及其独立保存的 API Key。`}
        danger
        busy={busy === 'delete-provider'}
        closeOnConfirm={false}
        confirmLabel="删除 Provider"
        error={
          feedback['delete-provider']?.kind === 'error' ? feedback['delete-provider'].text : null
        }
        onCancel={() => setDeleteProvider(null)}
        onConfirm={() => {
          const target = deleteProvider
          if (!target) return
          void run('delete-provider', 'delete-provider', async () => {
            await application.deleteSpeechRecognitionConfig(target.id)
            setConfigs((current) => (current ?? []).filter((item) => item.id !== target.id))
            setDeleteProvider(null)
            setDraft(null)
            toast.success(`已删除“${target.name}”`)
          })
        }}
      />
      <ConfirmModal
        open={Boolean(deletePackage)}
        title="删除 ASR 模型包？"
        message={`将删除“${deletePackage?.package.name ?? ''}”及未被其他模型包引用的资源。`}
        danger
        busy={busy === 'delete-package'}
        closeOnConfirm={false}
        confirmLabel="删除模型包"
        error={
          feedback['delete-package']?.kind === 'error' ? feedback['delete-package'].text : null
        }
        onCancel={() => setDeletePackage(null)}
        onConfirm={() => {
          const target = deletePackage
          if (!target) return
          void run('delete-package', 'delete-package', async () => {
            await application.deleteSpeechRecognitionPackage(
              target.package.id,
              target.package.version
            )
            setPackages((current) =>
              (current ?? []).filter(
                (item) =>
                  packageKey(item.package.id, item.package.version) !==
                  packageKey(target.package.id, target.package.version)
              )
            )
            setDeletePackage(null)
            toast.success(`已删除“${target.package.name}”`)
          })
        }}
      />
    </SettingsContent>
  )
}

function ModelList({
  models,
  names,
  removable,
  onChange
}: {
  models: AIRouterModelConfig[]
  names: ReadonlyArray<{ id: string; name: string }>
  removable: boolean
  onChange(models: AIRouterModelConfig[]): void
}): JSX.Element {
  if (!models.length) return <p className={styles.emptyModels}>尚未添加模型。</p>
  return (
    <div className={styles.modelList}>
      {models.map((model) => (
        <div className={styles.modelItem} key={model.id}>
          <label className={styles.modelToggle}>
            <input
              checked={model.enabled}
              type="checkbox"
              onChange={(event) =>
                onChange(
                  models.map((item) =>
                    item.id === model.id ? { ...item, enabled: event.target.checked } : item
                  )
                )
              }
            />
            <span>{optionName(model.id, names)}</span>
          </label>
          {removable ? (
            <button
              aria-label={`移除语音识别模型 ${model.id}`}
              className={styles.removeModel}
              onClick={() => onChange(models.filter((item) => item.id !== model.id))}
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

function createDraft(): RecognitionDraft {
  return {
    name: '',
    kind: 'online',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    modelPackageId: '',
    modelPackageVersion: '',
    models: [],
    apiKey: '',
    hasApiKey: false
  }
}
function fromConfig(config: AIRouterSpeechRecognitionProviderConfigSummary): RecognitionDraft {
  return { ...config, models: config.models.map((model) => ({ ...model })), apiKey: '' }
}
function toInput(draft: RecognitionDraft): AIRouterSpeechRecognitionProviderConfigInput {
  return {
    id: draft.id,
    name: draft.name,
    kind: draft.kind,
    type: draft.type,
    baseUrl: draft.kind === 'online' ? draft.baseUrl : undefined,
    modelPackageId: draft.kind === 'local' ? draft.modelPackageId : undefined,
    modelPackageVersion: draft.kind === 'local' ? draft.modelPackageVersion : undefined,
    models: draft.models,
    apiKey: draft.kind === 'online' && draft.apiKey ? draft.apiKey : undefined
  }
}
function selectPackage(
  draft: RecognitionDraft,
  modelPackage: AIRouterSpeechRecognitionModelPackageSummary
): RecognitionDraft {
  const same =
    draft.modelPackageId === modelPackage.package.id &&
    draft.modelPackageVersion === modelPackage.package.version
  return {
    ...draft,
    modelPackageId: modelPackage.package.id,
    modelPackageVersion: modelPackage.package.version,
    models: modelPackage.models.map((model) => ({
      id: model.id,
      enabled: same ? (draft.models.find((item) => item.id === model.id)?.enabled ?? true) : true,
      metadata: { name: model.name }
    }))
  }
}
function mergeModels(
  current: AIRouterModelConfig[],
  discovered: AIRouterModelConfig[]
): AIRouterModelConfig[] {
  return [
    ...discovered.map((model) => current.find((item) => item.id === model.id) ?? model),
    ...current.filter((model) => !discovered.some((item) => item.id === model.id))
  ]
}
function upsert(
  configs: AIRouterSpeechRecognitionProviderConfigSummary[],
  saved: AIRouterSpeechRecognitionProviderConfigSummary
): AIRouterSpeechRecognitionProviderConfigSummary[] {
  return configs.some((item) => item.id === saved.id)
    ? configs.map((item) => (item.id === saved.id ? saved : item))
    : [...configs, saved]
}
function packageKey(id: string, version: string): string {
  return `${id}@${version}`
}
function optionName(id: string, options: ReadonlyArray<{ id: string; name: string }>): string {
  const name = options.find((item) => item.id === id)?.name
  return name && name !== id ? `${name} (${id})` : id
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}
