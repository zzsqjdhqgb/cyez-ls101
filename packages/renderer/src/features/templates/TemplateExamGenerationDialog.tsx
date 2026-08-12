import { useEffect, useMemo, useState, type JSX } from 'react'
import type { TemplateApplication, TemplateDocument, TemplateNode } from '@ls101/template-editor'
import { AlertCircle, FileArchive, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { toast } from '../../components/ui/toast'
import {
  generateExamArchive,
  listSpeechGenerationSelections,
  type SpeechGenerationSelection
} from './TemplateExamGeneration'
import styles from './TemplateExamGenerationDialog.module.css'

interface TemplateExamGenerationDialogProps {
  application: TemplateApplication
  document: TemplateDocument
  open: boolean
  onOpenChange(open: boolean): void
}

type InstanceOptions = Record<
  string,
  Awaited<ReturnType<TemplateApplication['browser']['listInterfaceInstances']>>
>

export function TemplateExamGenerationDialog({
  application,
  document,
  open,
  onOpenChange
}: TemplateExamGenerationDialogProps): JSX.Element {
  const requirements = document.content.interfaces
  const [instances, setInstances] = useState<InstanceOptions>({})
  const [instanceSelections, setInstanceSelections] = useState<Record<string, string>>({})
  const [speechOptions, setSpeechOptions] = useState<SpeechGenerationSelection[]>([])
  const [providerId, setProviderId] = useState('')
  const [modelId, setModelId] = useState('')
  const [defaultVoiceId, setDefaultVoiceId] = useState('')
  const [manVoiceId, setManVoiceId] = useState('')
  const [womanVoiceId, setWomanVoiceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all([
      Promise.all(
        requirements.map(
          async (requirement) =>
            [
              requirement.alias,
              await application.browser.listInterfaceInstances(requirement.interfaceId)
            ] as const
        )
      ),
      listSpeechGenerationSelections()
    ])
      .then(([instanceEntries, speech]) => {
        if (!active) return
        const nextInstances = Object.fromEntries(instanceEntries)
        setInstances(nextInstances)
        setInstanceSelections(
          Object.fromEntries(
            requirements.map((requirement) => [
              requirement.alias,
              nextInstances[requirement.alias]?.[0]?.instanceId ?? ''
            ])
          )
        )
        setSpeechOptions(speech)
        setError(null)
        const first = speech[0]
        setProviderId(first?.providerConfigId ?? '')
        setModelId(first?.modelId ?? '')
        setDefaultVoiceId(first?.voiceId ?? '')
        setManVoiceId('')
        setWomanVoiceId('')
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
  }, [application, open, requirements])

  const providers = useMemo(
    () => uniqueBy(speechOptions, (option) => option.providerConfigId),
    [speechOptions]
  )
  const models = useMemo(
    () =>
      uniqueBy(
        speechOptions.filter((option) => option.providerConfigId === providerId),
        (option) => option.modelId
      ),
    [providerId, speechOptions]
  )
  const voices = useMemo(
    () =>
      uniqueBy(
        speechOptions.filter(
          (option) => option.providerConfigId === providerId && option.modelId === modelId
        ),
        (option) => option.voiceId
      ),
    [modelId, providerId, speechOptions]
  )
  const speechTarget = (voiceId: string): SpeechGenerationSelection | undefined =>
    speechOptions.find(
      (option) =>
        option.providerConfigId === providerId &&
        option.modelId === modelId &&
        option.voiceId === voiceId
    )
  const defaultSpeech = speechTarget(defaultVoiceId)
  const manSpeech = speechTarget(manVoiceId)
  const womanSpeech = speechTarget(womanVoiceId)
  const requiresSpeech = containsSpeechAction(document.content.root)
  const missingInstances = requirements.some(
    (requirement) => !instanceSelections[requirement.alias]
  )
  const speechSelectionMissing = requiresSpeech && !defaultSpeech
  const canGenerate = !loading && !generating && !missingInstances && !speechSelectionMissing

  const selectProvider = (value: string): void => {
    const first = speechOptions.find((option) => option.providerConfigId === value)
    setProviderId(value)
    setModelId(first?.modelId ?? '')
    setDefaultVoiceId(first?.voiceId ?? '')
    setManVoiceId('')
    setWomanVoiceId('')
  }

  const selectModel = (value: string): void => {
    const first = speechOptions.find(
      (option) => option.providerConfigId === providerId && option.modelId === value
    )
    setModelId(value)
    setDefaultVoiceId(first?.voiceId ?? '')
    setManVoiceId('')
    setWomanVoiceId('')
  }

  const generate = async (): Promise<void> => {
    if (!canGenerate) return
    console.info('[Template Exam Generation Dialog] generation started')
    setGenerating(true)
    setError(null)
    try {
      const status = await generateExamArchive({
        application,
        templateId: document.templateId,
        templateName: document.content.name,
        bindings: requirements.map((requirement) => ({
          alias: requirement.alias,
          interfaceId: requirement.interfaceId,
          instanceId: instanceSelections[requirement.alias]
        })),
        speech: defaultSpeech
          ? {
              default: defaultSpeech,
              ...(manSpeech ? { man: manSpeech } : {}),
              ...(womanSpeech ? { woman: womanSpeech } : {})
            }
          : undefined
      })
      if (status === 'exported') {
        console.info('[Template Exam Generation Dialog] generation exported')
        toast.success('试卷已生成')
        onOpenChange(false)
      } else {
        console.info('[Template Exam Generation Dialog] generation cancelled')
      }
    } catch (reason) {
      console.error(`[Template Exam Generation Dialog] generation failed: ${errorMessage(reason)}`)
      setError(errorMessage(reason))
    } finally {
      console.info('[Template Exam Generation Dialog] generation state released')
      setGenerating(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !generating && onOpenChange(next)}
      overlayClassName={styles.backdrop}
    >
      <section className={styles.dialog} aria-label="生成试卷">
        <header className={styles.header}>
          <div>
            <ModalDescription asChild>
              <span>选择本次生成使用的数据和语音</span>
            </ModalDescription>
            <ModalTitle asChild>
              <h2>生成试卷</h2>
            </ModalTitle>
          </div>
          <IconButton
            icon={X}
            label="关闭生成试卷"
            disabled={generating}
            onClick={() => onOpenChange(false)}
          />
        </header>

        <div className={styles.body}>
          {loading ? <p className={styles.status}>正在加载生成配置...</p> : null}
          {!loading ? (
            <>
              {requirements.length > 0 ? (
                <fieldset className={styles.group}>
                  <legend>Interface 实例</legend>
                  {requirements.map((requirement) => (
                    <label key={requirement.alias}>
                      <span>{requirement.alias}</span>
                      <select
                        aria-label={`Interface ${requirement.alias} 实例`}
                        disabled={generating}
                        value={instanceSelections[requirement.alias] ?? ''}
                        onChange={(event) =>
                          setInstanceSelections((current) => ({
                            ...current,
                            [requirement.alias]: event.target.value
                          }))
                        }
                      >
                        <option value="">请选择实例</option>
                        {(instances[requirement.alias] ?? []).map((instance) => (
                          <option key={instance.instanceId} value={instance.instanceId}>
                            {instance.name || '未命名实例'}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </fieldset>
              ) : null}

              <fieldset className={styles.group}>
                <legend>TTS 配置</legend>
                <label>
                  <span>Provider</span>
                  <select
                    aria-label="TTS Provider"
                    disabled={generating}
                    value={providerId}
                    onChange={(event) => selectProvider(event.target.value)}
                  >
                    <option value="">请选择 Provider</option>
                    {providers.map((option) => (
                      <option key={option.providerConfigId} value={option.providerConfigId}>
                        {option.providerName}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Model</span>
                  <select
                    aria-label="TTS Model"
                    disabled={generating || !providerId}
                    value={modelId}
                    onChange={(event) => selectModel(event.target.value)}
                  >
                    <option value="">请选择 Model</option>
                    {models.map((option) => (
                      <option key={option.modelId} value={option.modelId}>
                        {option.modelId}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>默认音色</span>
                  <select
                    aria-label="TTS 默认音色"
                    disabled={generating || !modelId}
                    value={defaultVoiceId}
                    onChange={(event) => setDefaultVoiceId(event.target.value)}
                  >
                    <option value="">请选择默认音色</option>
                    {voices.map((option) => (
                      <option key={option.voiceId} value={option.voiceId}>
                        {option.voiceId}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>男声音色</span>
                  <select
                    aria-label="TTS 男声音色"
                    disabled={generating || !modelId}
                    value={manVoiceId}
                    onChange={(event) => setManVoiceId(event.target.value)}
                  >
                    <option value="">跟随默认音色</option>
                    {voices.map((option) => (
                      <option key={option.voiceId} value={option.voiceId}>
                        {option.voiceId}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>女声音色</span>
                  <select
                    aria-label="TTS 女声音色"
                    disabled={generating || !modelId}
                    value={womanVoiceId}
                    onChange={(event) => setWomanVoiceId(event.target.value)}
                  >
                    <option value="">跟随默认音色</option>
                    {voices.map((option) => (
                      <option key={option.voiceId} value={option.voiceId}>
                        {option.voiceId}
                      </option>
                    ))}
                  </select>
                </label>
              </fieldset>

              {speechOptions.length === 0 ? (
                <div className={styles.notice} role="alert">
                  <AlertCircle aria-hidden="true" />
                  <span>没有可用的 TTS 配置；不含 TTS 播放动作的模板仍可生成。</span>
                </div>
              ) : null}
              {speechSelectionMissing ? (
                <div className={styles.notice} role="alert">
                  <AlertCircle aria-hidden="true" />
                  <span>模板包含 TTS 播放动作，请先保存并选择一个默认音色。</span>
                </div>
              ) : null}
              {requirements.some(
                (requirement) => (instances[requirement.alias] ?? []).length === 0
              ) ? (
                <div className={styles.notice} role="alert">
                  <AlertCircle aria-hidden="true" />
                  <span>至少一个 Interface 没有可用实例，无法生成试卷。</span>
                </div>
              ) : null}
            </>
          ) : null}
          {error ? (
            <pre className={styles.error} role="alert">
              {error}
            </pre>
          ) : null}
        </div>

        <footer className={styles.footer}>
          <Button disabled={generating} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            icon={FileArchive}
            variant="primary"
            disabled={!canGenerate}
            onClick={() => void generate()}
          >
            {generating ? '正在生成' : '生成并导出'}
          </Button>
        </footer>
      </section>
    </Modal>
  )
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  return [...new Map(values.map((value) => [key(value), value])).values()]
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function containsSpeechAction(node: TemplateNode): boolean {
  if (!node) return false
  if (node.type === 'page') {
    return node.timeline.some((step) => step.type === 'play')
  }
  if (node.type === 'frame') return node.children.some(containsSpeechAction)
  return false
}
