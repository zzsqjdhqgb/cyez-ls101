import type { FrameNode, TemplateContent, TextExpression, ValueExpression } from '../types'

export function text(value: string): TextExpression {
  return {
    type: 'string',
    parts: [{ type: 'literal', value }]
  }
}

export function number(value: number): ValueExpression<'number'> {
  return { type: 'number', source: 'literal', value }
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
        blockId: 'reading',
        bindings: {
          prompt: { type: 'literal', value: 'Read the sentence.' }
        }
      }
    ],
    ...overrides
  }
}
