import { useId, type JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import { IconButton } from '../ui/IconButton'
import styles from './AIModelSelect.module.css'

export interface AIModelSelection {
  providerId: string
  modelId: string
}

export interface AIModelOption extends AIModelSelection {
  providerName: string
  modelName?: string
}

interface AIModelSelectProps {
  label: string
  options: readonly AIModelOption[]
  value: AIModelSelection | null
  loading?: boolean
  error?: string | null
  disabled?: boolean
  showLabel?: boolean
  onChange(value: AIModelSelection | null): void
  onRefresh?(): void
}

export function AIModelSelect({
  label,
  options,
  value,
  loading = false,
  error = null,
  disabled = false,
  showLabel = true,
  onChange,
  onRefresh
}: AIModelSelectProps): JSX.Element {
  const selectId = useId()
  const selectedIndex = options.findIndex(
    (option) => option.providerId === value?.providerId && option.modelId === value.modelId
  )
  const providers = groupByProvider(options)

  return (
    <div className={styles.field}>
      {showLabel ? <label htmlFor={selectId}>{label}</label> : null}
      <div className={styles.control}>
        <select
          aria-label={showLabel ? undefined : label}
          aria-invalid={Boolean(error) || undefined}
          disabled={disabled || loading || options.length === 0}
          id={selectId}
          onChange={(event) => {
            const index = Number(event.target.value)
            const option = Number.isInteger(index) ? options[index] : undefined
            onChange(option ? { providerId: option.providerId, modelId: option.modelId } : null)
          }}
          value={selectedIndex < 0 ? '' : String(selectedIndex)}
        >
          {loading ? <option value="">正在读取模型...</option> : null}
          {!loading && !options.length ? (
            <option value="">{error ? '模型加载失败' : '没有已启用模型'}</option>
          ) : null}
          {providers.map((provider) => (
            <optgroup key={provider.id} label={provider.name}>
              {provider.options.map(({ option, index }) => (
                <option key={`${option.providerId}/${option.modelId}`} value={index}>
                  {modelLabel(option)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {onRefresh ? (
          <IconButton
            disabled={disabled || loading}
            icon={RefreshCw}
            label={`刷新${label}`}
            size="small"
            onClick={onRefresh}
          />
        ) : null}
      </div>
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}

function groupByProvider(options: readonly AIModelOption[]): Array<{
  id: string
  name: string
  options: Array<{ option: AIModelOption; index: number }>
}> {
  const groups = new Map<
    string,
    { id: string; name: string; options: Array<{ option: AIModelOption; index: number }> }
  >()
  options.forEach((option, index) => {
    const current = groups.get(option.providerId)
    if (current) current.options.push({ option, index })
    else {
      groups.set(option.providerId, {
        id: option.providerId,
        name: option.providerName,
        options: [{ option, index }]
      })
    }
  })
  return [...groups.values()]
}

function modelLabel(option: AIModelOption): string {
  return option.modelName && option.modelName !== option.modelId
    ? `${option.modelName} (${option.modelId})`
    : option.modelId
}
