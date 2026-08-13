import type { TextExpression, ValueExpression, ValueType } from '@ls101/template-editor'
import {
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX,
  type KeyboardEvent
} from 'react'
import { Braces, Variable } from 'lucide-react'
import styles from './TemplateVariableInput.module.css'
import {
  parseTextExpression,
  textExpressionInputValue,
  variableRefName,
  type TemplateVariableCandidate
} from './TemplateVariableInputModel'

type TextVariableInputProps = {
  mode: 'text'
  value: TextExpression
  candidates: readonly TemplateVariableCandidate[]
  ariaLabel: string
  placeholder?: string
  multiline?: boolean
  disabled?: boolean
  className?: string
  onChange(value: TextExpression): void
}

type ValueVariableInputProps<T extends ValueType> = {
  mode: 'value'
  valueType: T
  value: ValueExpression<T>
  candidates: readonly TemplateVariableCandidate[]
  ariaLabel: string
  placeholder?: string
  inputMode?: 'decimal' | 'text'
  min?: number
  disabled?: boolean
  className?: string
  onChange(value: ValueExpression<T>): void
}

type TemplateVariableInputProps =
  | TextVariableInputProps
  | ValueVariableInputProps<'string'>
  | ValueVariableInputProps<'number'>
  | ValueVariableInputProps<'file'>

interface CompletionState {
  start: number
  query: string
  blocked: boolean
}

const COMPLETION_QUERY_PATTERN = /^[a-zA-Z0-9_.-]*$/

export function TemplateVariableInput(props: TemplateVariableInputProps): JSX.Element {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const externalValue = expressionInputValue(props)
  const [draftState, setDraftState] = useState({ value: externalValue, externalValue })
  const draft = draftState.externalValue === externalValue ? draftState.value : externalValue
  const [completion, setCompletion] = useState<CompletionState | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)

  const expectedType = props.mode === 'text' ? 'string' : props.valueType
  const isMultiline =
    props.mode === 'text' || (props.mode === 'value' && props.valueType === 'string')
  const matchingCandidates = useMemo(() => {
    if (!completion || completion.blocked) return []
    const query = completion.query.toLocaleLowerCase()
    return props.candidates.filter((candidate) => {
      if (candidate.type !== expectedType) return false
      if (!query) return true
      const qualifiedName = variableRefName(candidate.ref).toLocaleLowerCase()
      const variableName =
        candidate.ref.scope === 'local' ? candidate.ref.name : candidate.ref.varName
      return qualifiedName.startsWith(query) || variableName.toLocaleLowerCase().startsWith(query)
    })
  }, [completion, expectedType, props.candidates])

  const showCompletion = completion !== null
  const resolvedActiveIndex = Math.min(activeIndex, Math.max(0, matchingCandidates.length - 1))
  const emptyMessage = completion?.blocked ? '请先清空输入框' : '无可用变量'

  const emitDraft = (next: string): void => {
    if (props.mode === 'text') {
      props.onChange(parseTextExpression(next))
      return
    }
    if (next === '') {
      if (props.valueType === 'file') {
        props.onChange({ type: 'file', source: 'literal', value: '' })
      }
      return
    }
    if (props.valueType === 'number') {
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed >= (props.min ?? 0)) {
        props.onChange({ type: 'number', source: 'literal', value: parsed })
      }
      return
    }
    if (props.valueType === 'file') {
      props.onChange({ type: 'file', source: 'literal', value: next })
      return
    }
    props.onChange({ type: 'string', source: 'literal', value: next })
  }

  const updateCompletion = (next: string, caret: number): void => {
    const trigger = findCompletionTrigger(next, caret)
    setCompletion(trigger)
    setActiveIndex(0)
  }

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    const next = event.currentTarget.value
    const caret = event.currentTarget.selectionStart ?? next.length

    if (props.mode === 'value' && draft !== '' && next[caret - 1] === '@') {
      setCompletion({ start: 0, query: '', blocked: true })
      return
    }

    setDraftState({ value: next, externalValue })
    emitDraft(next)
    updateCompletion(next, caret)
  }

  const selectCandidate = (candidate: TemplateVariableCandidate): void => {
    if (!completion || completion.blocked) return
    const token = `[@${variableRefName(candidate.ref)}]`

    if (props.mode === 'text') {
      const input = inputRef.current
      const caret = input?.selectionStart ?? draft.length
      const next = `${draft.slice(0, completion.start)}${token}${draft.slice(caret)}`
      setDraftState({ value: next, externalValue })
      props.onChange(parseTextExpression(next))
      setCompletion(null)
      focusAt(input, completion.start + token.length)
      return
    }

    setDraftState({ value: token, externalValue })
    const ref = structuredClone(candidate.ref)
    if (props.valueType === 'number') {
      props.onChange({ type: 'number', source: 'variable', ref })
    } else if (props.valueType === 'file') {
      props.onChange({ type: 'file', source: 'variable', ref })
    } else {
      props.onChange({ type: 'string', source: 'variable', ref })
    }
    setCompletion(null)
    focusAt(inputRef.current, token.length)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (props.mode === 'value' && event.key === '@' && draft !== '') {
      event.preventDefault()
      setCompletion({ start: 0, query: '', blocked: true })
      return
    }

    if (!completion) return
    if (event.key === 'Escape') {
      event.preventDefault()
      setCompletion(null)
      return
    }
    if (matchingCandidates.length === 0 || completion.blocked) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % matchingCandidates.length)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex(
        (current) => (current - 1 + matchingCandidates.length) % matchingCandidates.length
      )
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      const candidate = matchingCandidates[resolvedActiveIndex]
      if (candidate) selectCandidate(candidate)
    }
  }

  const inputAttributes = {
    'aria-activedescendant':
      showCompletion && matchingCandidates.length > 0
        ? `${listId}-option-${resolvedActiveIndex}`
        : undefined,
    'aria-autocomplete': 'list' as const,
    'aria-controls': showCompletion ? listId : undefined,
    'aria-expanded': showCompletion,
    'aria-label': props.ariaLabel,
    autoComplete: 'off',
    className: styles.input,
    disabled: props.disabled,
    placeholder: props.placeholder,
    role: 'combobox',
    value: draft,
    onBlur: () => setCompletion(null),
    onChange: handleChange,
    onKeyDown: handleKeyDown
  }

  return (
    <div className={`${styles.root}${props.className ? ` ${props.className}` : ''}`}>
      {isMultiline ? (
        <textarea
          {...inputAttributes}
          ref={(element) => {
            inputRef.current = element
          }}
          rows={props.mode === 'text' ? 3 : 2}
        />
      ) : (
        <input
          {...inputAttributes}
          inputMode={props.mode === 'value' ? props.inputMode : undefined}
          ref={(element) => {
            inputRef.current = element
          }}
        />
      )}

      {showCompletion ? (
        <div className={styles.completion} id={listId} role="listbox">
          {matchingCandidates.length > 0 && !completion.blocked ? (
            matchingCandidates.map((candidate, index) => (
              <button
                aria-selected={index === resolvedActiveIndex}
                className={styles.option}
                id={`${listId}-option-${index}`}
                key={candidate.key}
                role="option"
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  selectCandidate(candidate)
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <Variable aria-hidden="true" />
                <span className={styles.optionIdentity}>
                  <strong>{candidate.label}</strong>
                  <small>{candidate.sourceLabel}</small>
                </span>
              </button>
            ))
          ) : (
            <div aria-disabled="true" className={styles.emptyOption} role="option">
              <Braces aria-hidden="true" />
              <span>{emptyMessage}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function expressionInputValue(props: TemplateVariableInputProps): string {
  if (props.mode === 'text') return textExpressionInputValue(props.value)
  if (props.value.source === 'literal') return String(props.value.value)
  return `[@${variableRefName(props.value.ref)}]`
}

function findCompletionTrigger(value: string, caret: number): CompletionState | null {
  const start = value.lastIndexOf('@', caret - 1)
  if (start < 0) return null
  const query = value.slice(start + 1, caret)
  if (!COMPLETION_QUERY_PATTERN.test(query)) return null
  return { start, query, blocked: false }
}

function focusAt(input: HTMLInputElement | HTMLTextAreaElement | null, position: number): void {
  queueMicrotask(() => {
    input?.focus()
    input?.setSelectionRange(position, position)
  })
}
