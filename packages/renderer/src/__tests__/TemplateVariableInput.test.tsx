// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useState, type JSX } from 'react'
import type {
  FrameNode,
  FunctionDef,
  TextExpression,
  ValueExpression
} from '@ls101/template-editor'
import { TemplateVariableInput } from '../features/templates/TemplateVariableInput'
import {
  collectTemplateVariableCandidates,
  type TemplateVariableCandidate
} from '../features/templates/TemplateVariableInputModel'

afterEach(cleanup)

const candidates: TemplateVariableCandidate[] = [
  {
    key: 'local:sentence',
    label: 'sentence',
    sourceLabel: '局部变量',
    type: 'string',
    ref: { scope: 'local', name: 'sentence' }
  },
  {
    key: 'local:section',
    label: 'section',
    sourceLabel: '局部变量',
    type: 'string',
    ref: { scope: 'local', name: 'section' }
  },
  {
    key: 'local:score',
    label: 'score',
    sourceLabel: '局部变量',
    type: 'number',
    ref: { scope: 'local', name: 'score' }
  },
  {
    key: 'interface:exam.prompt',
    label: 'exam.prompt',
    sourceLabel: 'Interface',
    type: 'string',
    ref: { scope: 'interface', alias: 'exam', varName: 'prompt' }
  }
]

function TextHarness({
  available = candidates
}: {
  available?: TemplateVariableCandidate[]
}): JSX.Element {
  const [value, setValue] = useState<TextExpression>({
    type: 'string',
    parts: [{ type: 'literal', value: '' }]
  })
  return (
    <>
      <TemplateVariableInput
        mode="text"
        ariaLabel="文本"
        candidates={available}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}

function NumberHarness(): JSX.Element {
  const [value, setValue] = useState<ValueExpression<'number'>>({
    type: 'number',
    source: 'literal',
    value: 4
  })
  return (
    <>
      <TemplateVariableInput
        mode="value"
        valueType="number"
        ariaLabel="数值"
        candidates={candidates}
        inputMode="decimal"
        min={0}
        value={value}
        onChange={setValue}
      />
      <output data-testid="value">{JSON.stringify(value)}</output>
    </>
  )
}

describe('TemplateVariableInput', () => {
  it('filters text variables by the live prefix and restores matches after deletion', () => {
    render(<TextHarness />)
    const input = screen.getByLabelText('文本')

    fireEvent.change(input, { target: { value: '@sen', selectionStart: 4 } })
    let list = screen.getByRole('listbox')
    expect(within(list).getByRole('option', { name: /sentence/ })).toBeInTheDocument()
    expect(within(list).queryByRole('option', { name: /section/ })).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '@se', selectionStart: 3 } })
    list = screen.getByRole('listbox')
    expect(within(list).getAllByRole('option')).toHaveLength(2)

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('[@section]')
    expect(screen.getByTestId('value')).toHaveTextContent(
      JSON.stringify({
        type: 'string',
        parts: [{ type: 'variable', ref: { scope: 'local', name: 'section' } }]
      })
    )
  })

  it('inserts an Interface variable with its Template alias', () => {
    render(<TextHarness />)
    const input = screen.getByLabelText('文本')

    fireEvent.change(input, { target: { value: '题目：@pro。', selectionStart: 7 } })
    const option = screen.getByRole('option', { name: /exam\.prompt/ })
    fireEvent.mouseDown(option)

    expect(input).toHaveValue('题目：[@exam.prompt]。')
    expect(screen.getByTestId('value')).toHaveTextContent('"scope":"interface"')
    expect(screen.getByTestId('value')).toHaveTextContent('"alias":"exam"')
  })

  it('shows an unavailable row when no compatible variable matches', () => {
    render(<TextHarness available={[candidates[2]]} />)
    const input = screen.getByLabelText('文本')
    fireEvent.change(input, { target: { value: '@', selectionStart: 1 } })

    expect(screen.getByRole('option', { name: '无可用变量' })).toHaveAttribute(
      'aria-disabled',
      'true'
    )
  })

  it('closes completion with Escape without changing the text', () => {
    render(<TextHarness />)
    const input = screen.getByLabelText('文本')
    fireEvent.change(input, { target: { value: '@se', selectionStart: 3 } })

    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveValue('@se')
  })

  it('blocks @ for a non-empty single value', () => {
    render(<NumberHarness />)
    const input = screen.getByLabelText('数值')
    fireEvent.keyDown(input, { key: '@' })

    expect(input).toHaveValue('4')
    expect(screen.getByRole('option', { name: '请先清空输入框' })).toBeInTheDocument()
  })

  it('allows an empty single value to select a type-compatible variable', () => {
    render(<NumberHarness />)
    const input = screen.getByLabelText('数值')
    fireEvent.change(input, { target: { value: '', selectionStart: 0 } })
    fireEvent.change(input, { target: { value: '@sc', selectionStart: 3 } })

    expect(screen.getByRole('option', { name: /score/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /sentence/ })).not.toBeInTheDocument()
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input).toHaveValue('[@score]')
    expect(screen.getByTestId('value')).toHaveTextContent('"source":"variable"')
    expect(screen.getByTestId('value')).toHaveTextContent('"name":"score"')
  })
})

describe('collectTemplateVariableCandidates', () => {
  it('collects typed local outputs and accepted Interface variables', () => {
    const functionDefinition: FunctionDef = {
      id: 'function-definition',
      name: '取值',
      inputs: [],
      outputs: [
        {
          name: 'result',
          type: 'string',
          expression: {
            type: 'string',
            parts: [{ type: 'literal', value: 'result' }]
          }
        }
      ],
      schemaUses: [],
      body: { id: 'function-root', type: 'frame', children: [] }
    }
    const root: FrameNode = {
      id: 'root',
      type: 'frame',
      children: [
        {
          id: 'page',
          type: 'page',
          content: { blocks: [] },
          timeline: [
            {
              type: 'record',
              duration: { type: 'number', source: 'literal', value: 2 },
              outputName: 'recording'
            }
          ]
        },
        {
          id: 'question',
          type: 'choice-question',
          stem: { type: 'string', parts: [{ type: 'literal', value: '' }] },
          options: [
            { id: 'a', content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] } },
            { id: 'b', content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] } }
          ],
          outputName: 'answer'
        },
        {
          id: 'call',
          type: 'function',
          functionRef: functionDefinition.id,
          inputs: {},
          outputNames: { result: 'sentence' }
        }
      ]
    }

    const result = collectTemplateVariableCandidates(
      root,
      [functionDefinition],
      [{ alias: 'exam', interfaceId: 'interface', acceptedVars: ['prompt', 'ignored'] }],
      [
        {
          interfaceId: 'interface',
          interfaceName: '考试',
          vars: [
            {
              varName: 'prompt',
              type: 'text',
              description: '',
              example: '',
              path: 'prompt'
            },
            {
              varName: 'ignored',
              type: 'image',
              description: '',
              example: '',
              path: 'ignored'
            }
          ]
        }
      ]
    )

    expect(result.map(({ label, type }) => ({ label, type }))).toEqual([
      { label: 'recording', type: 'audio' },
      { label: 'answer', type: 'choice' },
      { label: 'sentence', type: 'string' },
      { label: 'exam.prompt', type: 'string' },
      { label: 'exam.ignored', type: 'file' }
    ])
  })
})
