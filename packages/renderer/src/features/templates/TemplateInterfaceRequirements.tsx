import { useEffect, useMemo, useState, type JSX } from 'react'
import type { InterfaceVarManifest } from '@ls101/core-types'
import type {
  TemplateApplication,
  TemplateDocumentOperation,
  TemplateInterfaceRequirement
} from '@ls101/template-editor'
import { Braces, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { IconButton } from '../../components/ui/IconButton'
import { templateErrorMessage } from './templateUi'
import styles from './TemplateInterfaceRequirements.module.css'

interface TemplateInterfaceRequirementsProps {
  application: TemplateApplication
  disabled: boolean
  requirements: readonly TemplateInterfaceRequirement[]
  apply(operation: TemplateDocumentOperation): boolean
}

export function TemplateInterfaceRequirements({
  application,
  disabled,
  requirements,
  apply
}: TemplateInterfaceRequirementsProps): JSX.Element {
  const [manifests, setManifests] = useState<InterfaceVarManifest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [alias, setAlias] = useState('')
  const [acceptedVars, setAcceptedVars] = useState<string[]>([])
  const manifestsById = useMemo(
    () => new Map(manifests.map((manifest) => [manifest.interfaceId, manifest])),
    [manifests]
  )

  useEffect(() => {
    let active = true
    void application.browser
      .listInterfaces()
      .then((values) => {
        if (!active) return
        setManifests(values)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application])

  const resetDraft = (): void => {
    setAdding(false)
    setSelectedId('')
    setAlias('')
    setAcceptedVars([])
  }

  const selectInterface = (interfaceId: string): void => {
    const manifest = manifestsById.get(interfaceId)
    setSelectedId(interfaceId)
    setAlias(manifest ? suggestAlias(manifest.interfaceName, requirements) : '')
    setAcceptedVars(manifest?.vars.map((variable) => variable.varName) ?? [])
  }

  const addRequirement = (): void => {
    if (!selectedId || !alias.trim() || acceptedVars.length === 0) return
    if (
      apply({
        type: 'insert-interface-requirement',
        requirement: { alias: alias.trim(), interfaceId: selectedId, acceptedVars }
      })
    ) {
      resetDraft()
    }
  }

  return (
    <section className={styles.section} aria-label="Interface 配置">
      <div className={styles.heading}>
        <span>Interface</span>
        <IconButton
          icon={Plus}
          label="添加 Interface"
          size="small"
          variant="ghost"
          disabled={disabled || loading || manifests.length === 0 || adding}
          onClick={() => setAdding(true)}
        />
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}
      {loading ? <div className={styles.status}>正在加载 Interface...</div> : null}
      {!loading && !error && manifests.length === 0 ? (
        <div className={styles.empty}>
          <Braces aria-hidden="true" />
          <span>暂无已发布 Interface</span>
        </div>
      ) : null}
      {!loading && requirements.length === 0 && !adding && manifests.length > 0 ? (
        <div className={styles.status}>尚未配置 Interface</div>
      ) : null}

      {requirements.length > 0 ? (
        <div className={styles.list}>
          {requirements.map((requirement, index) => (
            <RequirementEditor
              key={`${requirement.interfaceId}:${index}`}
              manifest={manifestsById.get(requirement.interfaceId)}
              requirement={requirement}
              disabled={disabled}
              apply={apply}
            />
          ))}
        </div>
      ) : null}

      {adding ? (
        <div className={styles.addEditor}>
          <div className={styles.itemHeading}>
            <strong>添加 Interface</strong>
            <IconButton
              icon={X}
              label="取消添加 Interface"
              size="small"
              variant="ghost"
              onClick={resetDraft}
            />
          </div>
          <label className={styles.field}>
            Interface
            <select
              aria-label="选择 Interface"
              value={selectedId}
              onChange={(event) => selectInterface(event.target.value)}
            >
              <option value="">请选择</option>
              {manifests.map((manifest) => (
                <option key={manifest.interfaceId} value={manifest.interfaceId}>
                  {manifest.interfaceName || '未命名 Interface'}
                </option>
              ))}
            </select>
          </label>
          {selectedId ? (
            <>
              <label className={styles.field}>
                别名
                <input
                  aria-label="新 Interface 别名"
                  value={alias}
                  onChange={(event) => setAlias(event.target.value)}
                />
              </label>
              <VariableSelector
                labelPrefix="新 Interface"
                manifest={manifestsById.get(selectedId)}
                selected={acceptedVars}
                onChange={setAcceptedVars}
              />
              <Button
                className={styles.confirmAdd}
                icon={Plus}
                size="small"
                disabled={!alias.trim() || acceptedVars.length === 0}
                onClick={addRequirement}
              >
                添加
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function RequirementEditor({
  requirement,
  manifest,
  disabled,
  apply
}: {
  requirement: TemplateInterfaceRequirement
  manifest: InterfaceVarManifest | undefined
  disabled: boolean
  apply: TemplateInterfaceRequirementsProps['apply']
}): JSX.Element {
  const manifestVariables = manifest?.vars.map((variable) => variable.varName) ?? []
  const variables = [
    ...manifestVariables,
    ...requirement.acceptedVars.filter((varName) => !manifestVariables.includes(varName))
  ]
  const update = (next: TemplateInterfaceRequirement): void => {
    apply({ type: 'update-interface-requirement', alias: requirement.alias, requirement: next })
  }

  return (
    <article className={styles.item}>
      <div className={styles.itemHeading}>
        <span className={styles.itemIdentity} title={requirement.interfaceId}>
          <strong>{manifest?.interfaceName || '未知 Interface'}</strong>
          <small>{requirement.interfaceId}</small>
        </span>
        <IconButton
          icon={Trash2}
          label={`移除 Interface ${requirement.alias}`}
          size="small"
          variant="danger"
          disabled={disabled}
          onClick={() => apply({ type: 'remove-interface-requirement', alias: requirement.alias })}
        />
      </div>
      <label className={styles.field}>
        别名
        <input
          aria-label={`Interface ${requirement.alias} 别名`}
          disabled={disabled}
          value={requirement.alias}
          onChange={(event) => update({ ...requirement, alias: event.target.value })}
        />
      </label>
      <VariableSelector
        disabled={disabled}
        labelPrefix={`Interface ${requirement.alias}`}
        manifest={manifest}
        selected={requirement.acceptedVars}
        variables={variables}
        onChange={(next) => update({ ...requirement, acceptedVars: next })}
      />
    </article>
  )
}

function VariableSelector({
  labelPrefix,
  manifest,
  selected,
  variables = manifest?.vars.map((variable) => variable.varName) ?? [],
  disabled = false,
  onChange
}: {
  labelPrefix: string
  manifest: InterfaceVarManifest | undefined
  selected: readonly string[]
  variables?: readonly string[]
  disabled?: boolean
  onChange(values: string[]): void
}): JSX.Element {
  const selectedSet = new Set(selected)

  const toggle = (varName: string, checked: boolean): void => {
    const next = new Set(selected)
    if (checked) next.add(varName)
    else next.delete(varName)
    onChange([
      ...variables.filter((name) => next.has(name)),
      ...selected.filter((name) => !variables.includes(name) && next.has(name))
    ])
  }

  return (
    <fieldset className={styles.variables}>
      <legend>可用变量</legend>
      {variables.map((varName) => {
        const variable = manifest?.vars.find((item) => item.varName === varName)
        const checked = selectedSet.has(varName)
        return (
          <label className={styles.variableOption} key={varName} title={variable?.description}>
            <input
              aria-label={`${labelPrefix} 变量 ${varName}`}
              checked={checked}
              disabled={disabled || (checked && selected.length === 1)}
              type="checkbox"
              onChange={(event) => toggle(varName, event.target.checked)}
            />
            <span>
              <strong>{varName}</strong>
              {variable ? <small>{variable.type === 'image' ? '图片' : '文本'}</small> : null}
            </span>
          </label>
        )
      })}
    </fieldset>
  )
}

function suggestAlias(
  interfaceName: string,
  requirements: readonly TemplateInterfaceRequirement[]
): string {
  const normalized = interfaceName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const base = /^[a-z_]/.test(normalized) ? normalized : 'data'
  const used = new Set(requirements.map((requirement) => requirement.alias))
  if (!used.has(base)) return base
  let suffix = 1
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}
