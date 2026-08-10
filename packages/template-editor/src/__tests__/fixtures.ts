import type { SchemaDefinition, SchemaStructure } from '@ls101/core-types'
import type {
  FrameNode,
  SchemaTextExpression,
  TemplateContent,
  TextExpression,
  ValueExpression
} from '../types'

export function text(value: string): TextExpression {
  return {
    type: 'string',
    parts: [{ type: 'literal', value }]
  }
}

export function number(value: number): ValueExpression<'number'> {
  return { type: 'number', source: 'literal', value }
}

export function schemaText(value: string): SchemaTextExpression {
  return { type: 'string', parts: [{ type: 'literal', value }] }
}

export function schemaDefinition(
  schemaId: string,
  structure: SchemaStructure,
  name = 'Test schema'
): SchemaDefinition {
  return {
    formatVersion: 2,
    schemaId,
    sourceDraftId: '10000000-0000-4000-8000-000000000001',
    structureHash: `sha256:${'a'.repeat(64)}`,
    revision: 0,
    structure,
    data: {
      name,
      description: '',
      maxScore: 10,
      answerDescriptions: Object.fromEntries(
        structure.answerFormat.map((answer) => [answer.answerId, answer.answerId])
      ),
      inputDescriptions: Object.fromEntries(
        structure.templateInputs.map((input) => [input.inputId, input.inputId])
      ),
      rubricMarkdown: ''
    }
  }
}

export function root(children: FrameNode['children'] = []): FrameNode {
  return {
    id: 'root',
    type: 'frame',
    children
  }
}

export function templateContent(overrides: Partial<TemplateContent> = {}): TemplateContent {
  return {
    name: '上海高考听说模板',
    description: '用于听说考试',
    interfaces: [
      {
        alias: 'speaking',
        interfaceId: `sha256:${'1'.repeat(64)}`,
        acceptedVars: ['sentence', 'audio']
      }
    ],
    root: root(),
    schemaUses: [
      {
        useId: 'reading-1',
        schemaId: `sha256:${'2'.repeat(64)}`,
        inputBindings: { prompt: schemaText('Read the sentence.') },
        answerBindings: {},
        attachments: []
      }
    ],
    ...overrides
  }
}
