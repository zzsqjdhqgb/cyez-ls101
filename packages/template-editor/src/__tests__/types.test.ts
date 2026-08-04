import { describe, expect, it } from 'vitest'
import type { ChoiceQuestionNode, FunctionDef, PageNode, SchemaUse, TemplateNode } from '../types'
import { number, root, text } from './fixtures'

describe('Template 核心类型', () => {
  it('表达页面、选择题、函数及其运行期出参', () => {
    const question: ChoiceQuestionNode = {
      id: 'question-1',
      type: 'choice-question',
      stem: {
        type: 'string',
        parts: [
          { type: 'literal', value: 'Choose: ' },
          {
            type: 'variable',
            ref: { scope: 'interface', alias: 'listening', varName: 'question' }
          }
        ]
      },
      options: [
        { id: 'option-1', content: text('First') },
        { id: 'option-2', content: text('Second') }
      ],
      outputName: 'answer-1'
    }
    const page: PageNode = {
      id: 'page-1',
      type: 'page',
      content: {
        blocks: [
          {
            id: 'choice-view',
            type: 'choice-view',
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            defaultViewport: { mode: 'focus', questionRef: question.id }
          }
        ]
      },
      timeline: [
        {
          type: 'record',
          duration: number(10),
          outputName: 'recording-1',
          choiceViewOverrides: {
            'choice-view': { mode: 'free', initialPage: 0 }
          }
        }
      ]
    }
    const func: FunctionDef = {
      id: `sha256:${'1'.repeat(64)}`,
      name: '单道选择题',
      inputs: [{ name: 'prompt', type: 'string' }],
      body: root([question, page]),
      outputs: [
        {
          name: 'answer',
          type: 'choice',
          expression: { type: 'choice', source: 'choice-output', name: 'answer-1' }
        }
      ],
      schemaUses: []
    }

    const nodes: TemplateNode[] = [func.body, page, question]
    expect(nodes.map((node) => node.type)).toEqual(['frame', 'page', 'choice-question'])
    expect(func.outputs[0].type).toBe('choice')
  })

  it('SchemaUse 强关联 schemaId 并区分静态和运行期绑定', () => {
    const use: SchemaUse = {
      useId: 'choice-score-1',
      schemaId: `sha256:${'2'.repeat(64)}`,
      blockId: 'single-choice',
      bindings: {
        description: {
          type: 'concat',
          parts: [
            { type: 'literal', value: 'Question: ' },
            { type: 'variable', scope: 'local', name: 'question-description' }
          ]
        },
        answer: { type: 'choice-output', name: 'answer-1' }
      }
    }

    expect(use.schemaId).toMatch(/^sha256:/)
    expect(use.bindings.answer.type).toBe('choice-output')
  })
})
