import type { SchemaDefinition } from '@ls101/core-types'
import type {
  FunctionDef,
  SchemaAnswerBinding,
  SchemaTextExpression,
  SchemaUse,
  TemplateNode,
  ValueExpression
} from '@ls101/template-editor'
import { Braces, Database } from 'lucide-react'
import { useEffect, useMemo, useState, type JSX } from 'react'
import { useSchemaRepository } from '../schemas/SchemaApplicationContext'
import { answerTypeLabels, questionTypeLabels } from '../schemas/schemaUi'
import { templateErrorMessage } from './templateUi'
import styles from './TemplateFunctionSchemaSummary.module.css'

interface TemplateFunctionSchemaSummaryProps {
  definition: FunctionDef
  functions: readonly FunctionDef[]
}

interface CollectedSchemaUse {
  key: string
  owner: string
  use: SchemaUse
}

export function TemplateFunctionSchemaSummary({
  definition,
  functions
}: TemplateFunctionSchemaSummaryProps): JSX.Element | null {
  const repository = useSchemaRepository()
  const uses = useMemo(
    () => collectFunctionSchemaUses(definition, functions),
    [definition, functions]
  )
  const [definitions, setDefinitions] = useState<ReadonlyMap<string, SchemaDefinition>>(
    () => new Map()
  )
  const [error, setError] = useState<string | null>(null)
  const schemaIds = useMemo(() => [...new Set(uses.map((item) => item.use.schemaId))], [uses])

  useEffect(() => {
    let active = true
    void Promise.all(schemaIds.map((schemaId) => repository.getSchema(schemaId)))
      .then((items) => {
        if (!active) return
        setError(null)
        setDefinitions(
          new Map(
            items
              .filter((item): item is SchemaDefinition => item !== null)
              .map((item) => [item.schemaId, item])
          )
        )
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [repository, schemaIds])

  if (uses.length === 0) return null

  return (
    <section className={styles.section} aria-label="函数内 Schema（只读）">
      <div className={styles.heading}>
        <Database aria-hidden="true" />
        <span>函数内 Schema</span>
        <small>{uses.length} 个，只读</small>
      </div>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
        </div>
      ) : null}
      <div className={styles.list}>
        {uses.map(({ key, owner, use }) => (
          <SchemaUseSummary
            definition={definitions.get(use.schemaId) ?? null}
            key={key}
            owner={owner}
            use={use}
          />
        ))}
      </div>
    </section>
  )
}

function SchemaUseSummary({
  definition,
  owner,
  use
}: {
  definition: SchemaDefinition | null
  owner: string
  use: SchemaUse
}): JSX.Element {
  return (
    <article className={styles.use} aria-label={`函数内评分单元 ${use.useId}`}>
      <header>
        <span className={styles.schemaIcon}>
          <Braces aria-hidden="true" />
        </span>
        <span className={styles.identity}>
          <strong>{definition?.data.name ?? '未知 Schema'}</strong>
          <small>
            {definition ? questionTypeLabels[definition.structure.questionType] : use.schemaId}
          </small>
        </span>
      </header>
      <dl className={styles.meta}>
        <div>
          <dt>评分单元</dt>
          <dd>{use.useId}</dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{owner}</dd>
        </div>
      </dl>
      {Object.keys(use.inputBindings).length > 0 ? (
        <SummaryGroup title="题目输入">
          {Object.entries(use.inputBindings).map(([inputId, expression]) => (
            <SummaryRow
              key={inputId}
              label={definition?.data.inputDescriptions[inputId] || inputId}
              value={schemaText(expression)}
            />
          ))}
        </SummaryGroup>
      ) : null}
      {Object.keys(use.answerBindings).length > 0 ? (
        <SummaryGroup title="答案绑定">
          {Object.entries(use.answerBindings).map(([answerId, binding]) => (
            <SummaryRow
              key={answerId}
              label={definition?.data.answerDescriptions[answerId] || answerId}
              value={answerBindingText(binding)}
            />
          ))}
        </SummaryGroup>
      ) : null}
      {use.attachments.length > 0 ? (
        <SummaryGroup title="附件">
          {use.attachments.map((attachment) => (
            <SummaryRow
              key={attachment.varName}
              label={attachment.description || attachment.varName}
              value={valueExpressionText(attachment.file)}
            />
          ))}
        </SummaryGroup>
      ) : null}
    </article>
  )
}

function SummaryGroup({
  children,
  title
}: {
  children: JSX.Element[]
  title: string
}): JSX.Element {
  return (
    <div className={styles.group}>
      <h3>{title}</h3>
      <dl>{children}</dl>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value || '未绑定'}</dd>
    </div>
  )
}

function collectFunctionSchemaUses(
  root: FunctionDef,
  functions: readonly FunctionDef[]
): CollectedSchemaUse[] {
  const definitions = new Map(functions.map((item) => [item.id, item]))
  definitions.set(root.id, root)
  const collected: CollectedSchemaUse[] = []

  const visit = (
    definition: FunctionDef,
    ownerPath: readonly string[],
    callPath: readonly string[],
    stack: readonly string[]
  ): void => {
    const owner = [...ownerPath, definition.name || '未命名函数'].join(' / ')
    definition.schemaUses.forEach((use, index) => {
      collected.push({ key: `${callPath.join('/')}:${use.useId}:${index}`, owner, use })
    })
    visitNodes(definition.body, (node) => {
      if (node.type !== 'function') return
      const nested = definitions.get(node.functionRef)
      if (!nested || stack.includes(nested.id)) return
      visit(
        nested,
        [...ownerPath, definition.name || '未命名函数'],
        [...callPath, node.id],
        [...stack, nested.id]
      )
    })
  }

  visit(root, [], [root.id], [root.id])
  return collected
}

function visitNodes(node: TemplateNode, visit: (node: TemplateNode) => void): void {
  visit(node)
  if (node.type === 'frame') node.children.forEach((child) => visitNodes(child, visit))
}

function answerBindingText(binding: SchemaAnswerBinding): string {
  const type = answerTypeLabels[binding.type]
  if (binding.type === 'text') return `${type} · ${binding.name || '未绑定'}`
  if (binding.type === 'fixed-speech') {
    return `${type} · 文本 ${schemaText(binding.text) || '未绑定'} · 录音 ${binding.audio.name || '未绑定'}`
  }
  return `${type} · ${binding.audio.name || '未绑定'}`
}

function schemaText(expression: SchemaTextExpression): string {
  return expression.parts
    .map((part) => {
      if (part.type === 'literal') return part.value
      if (part.ref.scope === 'interface') return `[@${part.ref.alias}.${part.ref.varName}]`
      if (part.ref.scope === 'schema-use') return `[@this.${part.ref.varName}]`
      return `[@${part.ref.name}]`
    })
    .join('')
}

function valueExpressionText(expression: ValueExpression<'file'>): string {
  if (expression.source === 'literal') return expression.value
  if (expression.ref.scope === 'interface') {
    return `[@${expression.ref.alias}.${expression.ref.varName}]`
  }
  return `[@${expression.ref.name}]`
}
