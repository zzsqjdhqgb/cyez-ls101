import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  AIRouterModelConfig,
  AIRouterProviderConfigSummary,
  AIRouterProviderType
} from '@ls101/airouter'
import { Check, Download, Plus, Save, TestTube2, Trash2 } from 'lucide-react'
import {
  SettingsContent,
  SettingsRow,
  SettingsSection
} from '../../components/settings/SettingsContent'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { airouterApplication, type AIRouterApplication } from './AIRouterApplication'
import styles from './AIRouterSettingsPage.module.css'

interface ProviderDraft {
  id?: string
  name: string
  type: AIRouterProviderType
  baseUrl: string
  apiKey: string
  clearApiKey: boolean
  hasApiKey: boolean
  models: AIRouterModelConfig[]
}

const providerLabels: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'OpenAI Compatible',
  anthropic: 'Anthropic'
}

const defaultBaseUrls: Record<AIRouterProviderType, string> = {
  'openai-compatible': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}

export function AIRouterSettingsPage({
  application = airouterApplication
}: {
  application?: AIRouterApplication
}): JSX.Element {
  const [configs, setConfigs] = useState<AIRouterProviderConfigSummary[] | null>(null)
  const [draft, setDraft] = useState<ProviderDraft | null>(null)
  const [manualModel, setManualModel] = useState('')
  const [testModelId, setTestModelId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AIRouterProviderConfigSummary | null>(null)

  useEffect(() => {
    let active = true
    void application
      .listConfigs()
      .then((values) => {
        if (!active) return
        setConfigs(values)
        setDraft(values.length ? draftFromConfig(values[0]) : createDraft())
      })
      .catch((reason: unknown) => active && setError(errorMessage(reason)))
    return () => {
      active = false
    }
  }, [application])

  const enabledModels = useMemo(() => draft?.models.filter((model) => model.enabled) ?? [], [draft])

  const selectedTestModelId = enabledModels.some((model) => model.id === testModelId)
    ? testModelId
    : (enabledModels[0]?.id ?? '')

  const run = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label)
    setError(null)
    setMessage(null)
    try {
      await action()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setBusy(null)
    }
  }

  const saveDraft = async (): Promise<AIRouterProviderConfigSummary> => {
    if (!draft) throw new Error('没有可保存的 Provider 配置')
    const saved = await application.saveConfig({
      id: draft.id,
      name: draft.name,
      type: draft.type,
      baseUrl: draft.baseUrl,
      models: draft.models,
      apiKey: draft.apiKey || undefined,
      clearApiKey: draft.clearApiKey
    })
    setConfigs((current) => upsert(current ?? [], saved))
    setDraft(draftFromConfig(saved))
    return saved
  }

  if (!configs || !draft) {
    return <div className={styles.status}>{error ?? '正在加载 AI Router 设置...'}</div>
  }

  return (
    <SettingsContent>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className={styles.success}>
          <Check aria-hidden="true" />
          {message}
        </div>
      ) : null}

      <SettingsSection title="Provider 配置" description="同一种 Provider 可以添加多套独立配置。">
        <div className={styles.providerList}>
          {configs.map((config) => (
            <button
              className={styles.providerItem}
              data-active={draft.id === config.id || undefined}
              key={config.id}
              onClick={() => {
                setDraft(draftFromConfig(config))
                setMessage(null)
                setError(null)
              }}
              type="button"
            >
              <span className={styles.providerName}>{config.name}</span>
              <span className={styles.providerMeta}>
                {providerLabels[config.type]} ·{' '}
                {config.models.filter((model) => model.enabled).length} 个模型
              </span>
            </button>
          ))}
          <Button icon={Plus} onClick={() => setDraft(createDraft())}>
            添加 Provider
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title={draft.id ? '编辑配置' : '新建配置'}
        description="API Key 使用 Windows 系统加密存储，页面不会读取或回显原值。"
      >
        <SettingsRow label="配置名称" description="用于在模型选择器中区分不同账号或服务地址。">
          <input
            aria-label="配置名称"
            className={styles.input}
            disabled={Boolean(busy)}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="例如：学校 OpenAI"
            value={draft.name}
          />
        </SettingsRow>
        <SettingsRow label="Provider 类型">
          <select
            aria-label="Provider 类型"
            className={styles.input}
            disabled={Boolean(busy) || Boolean(draft.id)}
            onChange={(event) => {
              const type = event.target.value as AIRouterProviderType
              setDraft({ ...draft, type, baseUrl: defaultBaseUrls[type] })
            }}
            value={draft.type}
          >
            <option value="openai-compatible">OpenAI Compatible</option>
            <option value="anthropic">Anthropic</option>
          </select>
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
        <SettingsRow
          label="API Key"
          description={
            draft.hasApiKey ? '已保存密钥；留空将保留原值。' : '本地无鉴权服务可以留空。'
          }
        >
          <div className={styles.secretControl}>
            <input
              aria-label="API Key"
              autoComplete="new-password"
              className={styles.inputWide}
              disabled={Boolean(busy) || draft.clearApiKey}
              onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })}
              placeholder={draft.hasApiKey ? '已安全保存' : '输入 API Key'}
              type="password"
              value={draft.apiKey}
            />
            {draft.hasApiKey ? (
              <label className={styles.inlineCheck}>
                <input
                  checked={draft.clearApiKey}
                  disabled={Boolean(busy)}
                  onChange={(event) => setDraft({ ...draft, clearApiKey: event.target.checked })}
                  type="checkbox"
                />
                清除密钥
              </label>
            ) : null}
          </div>
        </SettingsRow>
        <div className={styles.sectionActions}>
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
              删除
            </Button>
          ) : null}
          <Button
            icon={Save}
            variant="primary"
            disabled={Boolean(busy)}
            onClick={() =>
              void run('save', async () => {
                const saved = await saveDraft()
                setMessage(`已保存“${saved.name}”`)
              })
            }
          >
            保存配置
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="可用模型"
        description="从服务获取模型列表，或手动添加未出现在列表中的模型 ID。"
      >
        <div className={styles.modelToolbar}>
          <Button
            icon={Download}
            disabled={Boolean(busy)}
            onClick={() =>
              void run('models', async () => {
                const saved = await saveDraft()
                const discovered = await application.listModels(saved.id)
                const existing = new Map(saved.models.map((model) => [model.id, model]))
                setDraft({
                  ...draftFromConfig(saved),
                  models: discovered
                    .map((model) => existing.get(model.id) ?? { id: model.id, enabled: false })
                    .concat(
                      saved.models.filter(
                        (model) => !discovered.some((item) => item.id === model.id)
                      )
                    )
                })
                setMessage(`获取到 ${discovered.length} 个模型，请选择需要启用的模型`)
              })
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
        <div className={styles.sectionActions}>
          <Button
            icon={Save}
            disabled={Boolean(busy)}
            onClick={() =>
              void run('save-models', async () => {
                await saveDraft()
                setMessage('模型启用状态已保存')
              })
            }
          >
            保存模型设置
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="连接测试"
        description="发送固定的短请求，验证密钥、地址、模型和生成权限。"
      >
        <SettingsRow label="测试模型" description="只能测试当前配置中已经启用的模型。">
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
          <Button
            icon={TestTube2}
            variant="primary"
            disabled={!selectedTestModelId || Boolean(busy)}
            onClick={() =>
              void run('test', async () => {
                const saved = await saveDraft()
                const result = await application.testConnection(saved.id, selectedTestModelId)
                setMessage(`连接成功，模型回复：${result.text || '（空响应）'}`)
              })
            }
          >
            {busy === 'test' ? '正在测试...' : '测试连接'}
          </Button>
        </div>
      </SettingsSection>

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
            setDraft(next.length ? draftFromConfig(next[0]) : createDraft())
            setMessage(`已删除“${target.name}”`)
          })
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
    baseUrl: defaultBaseUrls['openai-compatible'],
    apiKey: '',
    clearApiKey: false,
    hasApiKey: false,
    models: []
  }
}

function draftFromConfig(config: AIRouterProviderConfigSummary): ProviderDraft {
  return {
    ...config,
    apiKey: '',
    clearApiKey: false,
    models: config.models.map((model) => ({ ...model }))
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
  return reason instanceof Error ? reason.message : 'AI Router 设置操作失败'
}
