import type {
  InterfaceImageProviderOption,
  InterfaceImageProviderSelection
} from '@ls101/interface-editor'
import type { JSX } from 'react'
import { AIModelSelect, type AIModelOption, type AIModelSelection } from './AIModelSelect'

const MANUAL_MODEL_ID = ''

export function AIImageProviderSelect({
  label,
  options,
  value,
  loading = false,
  error = null,
  disabled = false,
  showLabel = true,
  onChange,
  onRefresh
}: {
  label: string
  options: readonly InterfaceImageProviderOption[]
  value: InterfaceImageProviderSelection | null
  loading?: boolean
  error?: string | null
  disabled?: boolean
  showLabel?: boolean
  onChange(value: InterfaceImageProviderSelection | null): void
  onRefresh?(): void
}): JSX.Element {
  const modelOptions: AIModelOption[] = options.map((option) => ({
    providerId: option.providerId,
    providerName: option.providerName,
    modelId: option.modelId ?? MANUAL_MODEL_ID,
    modelName: option.modelId ? option.modelName : '手动导入'
  }))
  const modelValue: AIModelSelection | null = value
    ? { providerId: value.providerId, modelId: value.modelId ?? MANUAL_MODEL_ID }
    : null

  return (
    <AIModelSelect
      disabled={disabled}
      error={error}
      label={label}
      loading={loading}
      options={modelOptions}
      showLabel={showLabel}
      value={modelValue}
      onChange={(next) =>
        onChange(
          next
            ? {
                providerId: next.providerId,
                ...(next.modelId === MANUAL_MODEL_ID ? {} : { modelId: next.modelId })
              }
            : null
        )
      }
      onRefresh={onRefresh}
    />
  )
}
