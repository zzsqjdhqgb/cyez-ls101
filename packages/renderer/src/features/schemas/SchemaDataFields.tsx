import {
  schemaBuiltinInputDescription,
  type SchemaData,
  type SchemaStructure
} from '@ls101/schema-editor'
import type { JSX } from 'react'
import styles from './SchemaEditor.module.css'

interface SchemaDataFieldsProps {
  data: SchemaData
  structure: SchemaStructure
  readOnly?: boolean
  onChange(data: SchemaData): void
}

export function SchemaDataFields({
  data,
  structure,
  readOnly = false,
  onChange
}: SchemaDataFieldsProps): JSX.Element {
  const update = <Key extends keyof SchemaData>(key: Key, value: SchemaData[Key]): void => {
    onChange({ ...data, [key]: value })
  }

  return (
    <div className={styles.dataFields}>
      <div className={styles.formGrid}>
        <label>
          <span>名称</span>
          <input
            disabled={readOnly}
            value={data.name}
            onChange={(event) => update('name', event.target.value)}
          />
        </label>
        <label>
          <span>满分</span>
          <input
            min="0"
            step="0.5"
            type="number"
            disabled={readOnly}
            value={Number.isFinite(data.maxScore) ? data.maxScore : ''}
            onChange={(event) => update('maxScore', Number(event.target.value))}
          />
        </label>
      </div>
      <label>
        <span>描述</span>
        <textarea
          disabled={readOnly}
          rows={3}
          value={data.description}
          onChange={(event) => update('description', event.target.value)}
        />
      </label>

      <section className={styles.descriptionSection} aria-labelledby="answer-description-heading">
        <h3 id="answer-description-heading">答案槽位说明</h3>
        {structure.answerFormat.map((answer) => (
          <label key={answer.answerId}>
            <span>
              <code>{answer.answerId}</code>
            </span>
            <input
              disabled={readOnly}
              value={data.answerDescriptions[answer.answerId] ?? ''}
              onChange={(event) =>
                update('answerDescriptions', {
                  ...data.answerDescriptions,
                  [answer.answerId]: event.target.value
                })
              }
            />
          </label>
        ))}
      </section>

      <section className={styles.descriptionSection} aria-labelledby="input-description-heading">
        <h3 id="input-description-heading">Template 输入说明</h3>
        {structure.templateInputs.map((input) => {
          const builtinDescription = schemaBuiltinInputDescription(
            structure.questionType,
            input.inputId
          )
          return builtinDescription !== null ? (
            <div className={styles.builtinDescription} key={input.inputId}>
              <span>
                <code>{input.inputId}</code>
                {input.required ? ' · 必填' : ' · 可选'} · 系统内置
              </span>
              <strong>{builtinDescription}</strong>
            </div>
          ) : (
            <label key={input.inputId}>
              <span>
                <code>{input.inputId}</code>
                {input.required ? ' · 必填' : ' · 可选'}
              </span>
              <input
                disabled={readOnly}
                value={data.inputDescriptions[input.inputId] ?? ''}
                onChange={(event) =>
                  update('inputDescriptions', {
                    ...data.inputDescriptions,
                    [input.inputId]: event.target.value
                  })
                }
              />
            </label>
          )
        })}
      </section>

      {structure.questionType !== 'objective' ? (
        <label>
          <span>评分标准（Markdown）</span>
          <textarea
            disabled={readOnly}
            className={styles.markdown}
            value={data.rubricMarkdown}
            onChange={(event) => update('rubricMarkdown', event.target.value)}
          />
        </label>
      ) : null}
      <label>
        <span>AI 补充提示词（Markdown，可选）</span>
        <textarea
          disabled={readOnly}
          className={styles.markdown}
          value={data.extraPromptMarkdown ?? ''}
          onChange={(event) => update('extraPromptMarkdown', event.target.value)}
        />
      </label>
    </div>
  )
}
