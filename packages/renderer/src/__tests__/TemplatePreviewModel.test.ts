import { describe, expect, it } from 'vitest'
import type {
  TemplateDocument,
  TemplateNode,
  TemplatePreviewData,
  TemplatePreviewPage
} from '@ls101/template-editor'
import { buildTemplatePreviewSnapshots } from '../features/templates/TemplatePreviewModel'

const directPage = page('direct-page', [], 2)
const siblingPage = page('sibling-page', [], 1)
const functionPage = page('inner-page', ['function-call'], 2)

const root: TemplateDocument['content']['root'] = {
  id: 'root',
  type: 'frame',
  children: [
    {
      id: 'section',
      type: 'frame',
      children: [
        authorPage('direct-page'),
        {
          id: 'function-call',
          type: 'function',
          functionRef: `sha256:${'a'.repeat(64)}`,
          inputs: {},
          outputNames: {}
        }
      ]
    },
    authorPage('sibling-page')
  ]
}

const preview: TemplatePreviewData = {
  title: 'Preview',
  pages: [directPage, functionPage, siblingPage],
  recordingIndices: [],
  resources: {}
}

describe('Template preview selection', () => {
  it('includes direct and expanded function pages under a selected frame', () => {
    const section = root.children[0]
    expect(buildTemplatePreviewSnapshots(root, section, preview).map((item) => item.id)).toEqual([
      'page:direct-page:0',
      'page:direct-page:1',
      'page:function-call/inner-page:0',
      'page:function-call/inner-page:1'
    ])
  })

  it('limits page and function selections to their own expanded pages', () => {
    const section = root.children[0]
    if (section.type !== 'frame') throw new Error('expected frame')
    const selectedPage = section.children[0]
    const selectedFunction = section.children[1]

    expect(buildTemplatePreviewSnapshots(root, selectedPage, preview)).toHaveLength(2)
    expect(
      buildTemplatePreviewSnapshots(root, selectedFunction, preview).map((item) => item.id)
    ).toEqual(['page:function-call/inner-page:0', 'page:function-call/inner-page:1'])
  })
})

function page(id: string, callPath: string[], stepCount: number): TemplatePreviewPage {
  return {
    id: `page:${[...callPath, id].join('/')}`,
    sourceNodeId: id,
    callPath,
    content: [],
    timeline: Array.from({ length: stepCount }, (_, index) => ({
      type: 'countdown' as const,
      seconds: index + 1
    }))
  }
}

function authorPage(id: string): TemplateNode {
  return {
    id,
    type: 'page',
    content: { blocks: [] },
    timeline: []
  }
}
