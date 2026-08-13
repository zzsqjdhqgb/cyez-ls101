import { describe, expect, it } from 'vitest'
import type { FrameNode, TemplateCompileError } from '@ls101/template-editor'
import {
  templateCompileErrorDetails,
  templateCompileErrorsMessage,
  templateErrorNodeId
} from '../features/templates/TemplateCompileErrors'

describe('Template compile errors', () => {
  it('turns validation and compile codes into readable Chinese messages', () => {
    const validationError: TemplateCompileError = {
      stage: 'validation',
      error: {
        code: 'EMPTY_PAGE_TIMELINE',
        path: 'root.children[0].timeline',
        params: {}
      }
    }
    const compileError: TemplateCompileError = {
      stage: 'compile',
      code: 'RESOURCE_SOURCE_NOT_FOUND',
      path: 'root.children[1].content.blocks[0].source',
      params: {}
    }

    expect(templateCompileErrorDetails(validationError)).toEqual({
      message: '页面时间线不能为空',
      path: 'root.children[0].timeline'
    })
    expect(templateCompileErrorsMessage([validationError, compileError])).toBe(
      '页面时间线不能为空\n位置：root.children[0].timeline\n' +
        '找不到资源文件\n位置：root.children[1].content.blocks[0].source'
    )
  })

  it('uses a specific compiler message when one is available', () => {
    const error: TemplateCompileError = {
      stage: 'compile',
      code: 'SPEECH_SYNTHESIS_FAILED',
      path: 'root.children[0].timeline[0].text',
      params: { message: '当前语音模型不支持这段文本' }
    }

    expect(templateCompileErrorDetails(error).message).toBe('当前语音模型不支持这段文本')
  })

  it('resolves a nested children path to the owning node', () => {
    const root: FrameNode = {
      id: 'root',
      type: 'frame',
      children: [
        {
          id: 'section',
          type: 'frame',
          children: [
            {
              id: 'question',
              type: 'choice-question',
              stem: { type: 'text', parts: [] },
              options: [],
              outputName: 'answer'
            }
          ]
        }
      ]
    }

    expect(templateErrorNodeId(root, 'root.children[0].children[0].options')).toBe('question')
    expect(templateErrorNodeId(root, 'root.children[0].choiceCollector')).toBe('section')
    expect(templateErrorNodeId(root, 'content.interfaces[0]')).toBeNull()
  })
})
