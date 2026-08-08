import { describe, expect, it } from 'vitest'
import type { FrameNode, FunctionDef } from '@ls101/template-editor'
import { collectTemplateChoiceTargetPages } from '../features/templates/TemplateChoiceTargets'

describe('Template choice targets', () => {
  it('maps collector pages to direct and nested function questions in expansion order', () => {
    const nested: FunctionDef = {
      id: 'function-nested',
      name: 'Nested',
      inputs: [],
      outputs: [],
      schemaUses: [],
      body: {
        id: 'nested-root',
        type: 'frame',
        children: [question('question-deep')]
      }
    }
    const section: FunctionDef = {
      id: 'function-section',
      name: 'Section',
      inputs: [],
      outputs: [],
      schemaUses: [],
      body: {
        id: 'section-root',
        type: 'frame',
        children: [
          question('question-inner'),
          {
            id: 'nested-call',
            type: 'function',
            functionRef: nested.id,
            inputs: {},
            outputNames: {}
          }
        ]
      }
    }
    const root: FrameNode = {
      id: 'root',
      type: 'frame',
      choiceCollector: { pages: [{ questionCount: 2 }, { questionCount: 1 }] },
      children: [
        question('question-root'),
        {
          id: 'section-call',
          type: 'function',
          functionRef: section.id,
          inputs: {},
          outputNames: {}
        }
      ]
    }

    expect(collectTemplateChoiceTargetPages(root, [section, nested])).toEqual([
      {
        pageIndex: 0,
        questions: [
          {
            pageIndex: 0,
            questionIndex: 0,
            ref: { scope: 'absolute', callPath: [], questionId: 'question-root' }
          },
          {
            pageIndex: 0,
            questionIndex: 1,
            ref: {
              scope: 'absolute',
              callPath: ['section-call'],
              questionId: 'question-inner'
            }
          }
        ]
      },
      {
        pageIndex: 1,
        questions: [
          {
            pageIndex: 1,
            questionIndex: 0,
            ref: {
              scope: 'absolute',
              callPath: ['section-call', 'nested-call'],
              questionId: 'question-deep'
            }
          }
        ]
      }
    ])
  })
})

function question(id: string): FrameNode['children'][number] {
  return {
    id,
    type: 'choice-question',
    stem: { type: 'string', parts: [{ type: 'literal', value: id }] },
    options: [
      { id: 'a', content: { type: 'string', parts: [{ type: 'literal', value: 'A' }] } },
      { id: 'b', content: { type: 'string', parts: [{ type: 'literal', value: 'B' }] } }
    ],
    outputName: `${id}-answer`
  }
}
