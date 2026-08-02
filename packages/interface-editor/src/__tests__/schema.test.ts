import { afterEach, describe, it, expect, vi } from 'vitest'
import { TypeGuard } from '@sinclair/typebox'
import {
  buildJsonSchema as buildCollectionJsonSchema,
  buildJsonExample as buildCollectionJsonExample,
  validateJson
} from '../schema'
import type { FieldNode, FieldLeaf, FieldGroup } from '../types'
import { collection } from './fieldFixtures'

afterEach(() => vi.unstubAllGlobals())

// ============================================================
// 测试辅助工厂
// ============================================================

function textLeaf(varName: string, description = 'desc', example = 'ex'): FieldLeaf {
  return { type: 'text', varName, description, example }
}

function imageLeaf(varName: string, description = 'desc', example = 'ex'): FieldLeaf {
  return { type: 'image', varName, description, example }
}

function group(children: Record<string, FieldNode>): FieldGroup {
  return { type: 'group', children: collection(children) }
}

const buildJsonSchema = (fields: Record<string, FieldNode>): Record<string, unknown> =>
  buildCollectionJsonSchema(collection(fields))
const buildJsonExample = (fields: Record<string, FieldNode>): Record<string, unknown> =>
  buildCollectionJsonExample(collection(fields))

// ============================================================
// buildJsonSchema
// ============================================================

describe('buildJsonSchema', () => {
  it('空 fields 产生 type: "object" 含 additionalProperties: false', () => {
    const schema = buildJsonSchema({})
    expect(schema).toMatchObject({
      type: 'object',
      additionalProperties: false
    })
  })

  it('单个 text 叶子 → properties 含该字段 + required', () => {
    const schema = buildJsonSchema({
      myField: textLeaf('v1', '我的字段描述')
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        myField: { type: 'string', description: '我的字段描述' }
      },
      required: ['myField'],
      additionalProperties: false
    })
  })

  it('单个 image 叶子 → type: "string" 并要求返回生图提示词', () => {
    const schema = buildJsonSchema({
      pic: imageLeaf('img1', '图片描述', '一只猫')
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        pic: {
          type: 'string',
          description: expect.stringContaining('图片生成模型')
        }
      },
      required: ['pic']
    })
  })

  it('image schema 保留教师填写的描述', () => {
    const schema = buildJsonSchema({ pic: imageLeaf('img1', '校园操场配图') })
    expect(JSON.stringify(schema)).toContain('校园操场配图')
  })

  it('多个同层叶子 → 全部出现在 properties 和 required', () => {
    const schema = buildJsonSchema({
      a: textLeaf('v1', '字段A'),
      b: textLeaf('v2', '字段B'),
      c: imageLeaf('v3', '字段C')
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        a: { type: 'string', description: '字段A' },
        b: { type: 'string', description: '字段B' },
        c: { type: 'string', description: expect.stringContaining('字段C') }
      },
      required: ['a', 'b', 'c']
    })
  })

  it('嵌套 group → 产生嵌套 object schema', () => {
    const schema = buildJsonSchema({
      sectionA: group({
        sub: textLeaf('v1', '嵌套字段')
      })
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        sectionA: {
          type: 'object',
          properties: {
            sub: { type: 'string', description: '嵌套字段' }
          },
          required: ['sub'],
          additionalProperties: false
        }
      },
      required: ['sectionA']
    })
  })

  it('深层嵌套 → schema 跟随嵌套', () => {
    const schema = buildJsonSchema({
      l1: group({
        l2: group({
          l3: textLeaf('deep', '深层字段')
        })
      })
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        l1: {
          type: 'object',
          properties: {
            l2: {
              type: 'object',
              properties: {
                l3: { type: 'string', description: '深层字段' }
              },
              required: ['l3'],
              additionalProperties: false
            }
          },
          required: ['l2'],
          additionalProperties: false
        }
      },
      required: ['l1']
    })
  })

  it('同层混合 group 和 leaf → 均正常出现', () => {
    const schema = buildJsonSchema({
      title: textLeaf('v1', '标题'),
      section: group({
        content: textLeaf('v2', '内容')
      })
    })
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        title: { type: 'string', description: '标题' },
        section: {
          type: 'object',
          properties: {
            content: { type: 'string', description: '内容' }
          },
          required: ['content'],
          additionalProperties: false
        }
      },
      required: ['title', 'section']
    })
  })

  it('varName 不出现在 schema 中', () => {
    // 用 varName = "myVar" 但 field key = "q1"
    const schema = buildJsonSchema({
      q1: textLeaf('myVar', '题干描述')
    })
    const schemaStr = JSON.stringify(schema)
    // varName "myVar" 不应出现在 JSON 中
    expect(schemaStr).not.toContain('myVar')
    // 字段 key "q1" 出现在 properties 中
    expect(schemaStr).toContain('q1')
  })

  it('实例 name 不出现在 schema 中且不能由 JSON 提供', () => {
    const schema = buildJsonSchema({ q: textLeaf('answer', '题目') })
    expect(JSON.stringify(schema)).not.toContain('name')
    expect(validateJson(schema, '{"name":"AI 名称","q":"答案"}').valid).toBe(false)
  })
})

// ============================================================
// buildJsonSchema — meta-schema 合法性
// ============================================================

describe('buildJsonSchema — meta-schema 合法性', () => {
  function expectValidSchema(fields: Record<string, FieldNode>, description: string): void {
    it(description, () => {
      const schema = buildJsonSchema(fields)
      expect(TypeGuard.IsSchema(schema)).toBe(true)
    })
  }

  expectValidSchema({}, '空 fields')

  expectValidSchema({ q: textLeaf('v1', '字段描述') }, '单个 text leaf')

  expectValidSchema(
    { a: textLeaf('v1', 'A'), b: textLeaf('v2', 'B'), c: imageLeaf('v3', 'C') },
    '多个叶子混合 text + image'
  )

  expectValidSchema({ section: group({ sub: textLeaf('v1', '嵌套') }) }, '嵌套 group')

  expectValidSchema(
    {
      l1: group({
        l2: group({
          l3: textLeaf('deep', '深层字段')
        })
      })
    },
    '深层嵌套'
  )

  expectValidSchema(
    {
      title: textLeaf('v1', '标题'),
      section: group({
        content: textLeaf('v2', '内容')
      })
    },
    '同层混合 group + leaf'
  )
})

// ============================================================
// buildJsonExample
// ============================================================

describe('buildJsonExample', () => {
  it('空 fields → 返回空对象', () => {
    expect(buildJsonExample({})).toEqual({})
  })

  it('单个 text 叶子 → 填充 example 值', () => {
    const result = buildJsonExample({
      q: textLeaf('v1', 'desc', 'Hello, world!')
    })
    expect(result).toEqual({ q: 'Hello, world!' })
  })

  it('多个叶子 → 各自填充 example', () => {
    const result = buildJsonExample({
      a: textLeaf('va', 'fa', 'Apple'),
      b: textLeaf('vb', 'fb', 'Banana'),
      c: imageLeaf('vc', 'fc', 'A picture of a cat')
    })
    expect(result).toEqual({
      a: 'Apple',
      b: 'Banana',
      c: 'A picture of a cat'
    })
  })

  it('嵌套 group → 递归填充', () => {
    const result = buildJsonExample({
      section: group({
        sub: textLeaf('v1', 'desc', 'Nested value')
      })
    })
    expect(result).toEqual({
      section: { sub: 'Nested value' }
    })
  })

  it('深层嵌套 → 完整镜像', () => {
    const result = buildJsonExample({
      a: group({
        b: group({
          c: textLeaf('deep', 'desc', 'Deep value')
        })
      })
    })
    expect(result).toEqual({
      a: { b: { c: 'Deep value' } }
    })
  })

  it('结构镜像 fields 树（包含 group 和 leaf 混合）', () => {
    const result = buildJsonExample({
      sectionA: group({
        s1: textLeaf('a1', 'd1', 'Sentence 1'),
        s2: textLeaf('a2', 'd2', 'Sentence 2')
      }),
      sectionB: group({
        picture: imageLeaf('b1', 'd3', 'A beautiful sunset'),
        hint: textLeaf('b2', 'd4', 'sunset, beach, ocean')
      })
    })
    expect(result).toEqual({
      sectionA: { s1: 'Sentence 1', s2: 'Sentence 2' },
      sectionB: { picture: 'A beautiful sunset', hint: 'sunset, beach, ocean' }
    })
  })
})

// ============================================================
// validateJson — 正常情况
// ============================================================

describe('validateJson', () => {
  // 构建一个测试用的 schema
  const testSchema = buildJsonSchema({
    title: textLeaf('v1', '试卷标题'),
    questions: group({
      q1: textLeaf('v2', '第一题题干'),
      q2: textLeaf('v3', '第二题题干')
    })
  })

  it('合法 JSON 通过校验 → valid=true, errors=null, 返回 data', () => {
    const result = validateJson(
      testSchema,
      '{"title": "Test Exam", "questions": {"q1": "What is 1+1?", "q2": "What is 2+2?"}}'
    )
    expect(result.valid).toBe(true)
    expect(result.errors).toBeNull()
    expect(result.data).toEqual({
      title: 'Test Exam',
      questions: { q1: 'What is 1+1?', q2: 'What is 2+2?' }
    })
  })

  it('缺少必填字段 → valid=false', () => {
    const result = validateJson(testSchema, '{"title": "Test Exam"}')
    expect(result.valid).toBe(false)
    expect(result.errors).not.toBeNull()
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('多余字段（additionalProperties: false）→ valid=false', () => {
    const result = validateJson(
      testSchema,
      '{"title": "Test", "questions": {"q1": "Q", "q2": "Q2"}, "extra": "should not exist"}'
    )
    expect(result.valid).toBe(false)
  })

  it('类型不匹配 → valid=false', () => {
    const result = validateJson(testSchema, '{"title": 123, "questions": {"q1": "Q", "q2": "Q2"}}')
    expect(result.valid).toBe(false)
  })

  it('questions 内部嵌套类型错误 → valid=false', () => {
    const result = validateJson(
      testSchema,
      '{"title": "Test", "questions": {"q1": 100, "q2": "Q2"}}'
    )
    expect(result.valid).toBe(false)
  })

  it('JSON 格式非法 → valid=false, errors 含 parse 错误', () => {
    const result = validateJson(testSchema, '{invalid json')
    expect(result.valid).toBe(false)
    expect(result.errors).not.toBeNull()
    expect(result.errors![0].keyword).toBe('parse')
  })

  it('空对象 {} → 缺少必填字段导致失败', () => {
    const result = validateJson(testSchema, '{}')
    expect(result.valid).toBe(false)
  })

  it('禁用 Function 构造器时仍可校验，兼容 Electron CSP', () => {
    vi.stubGlobal('Function', function blockedFunctionConstructor(): never {
      throw new Error('unsafe-eval blocked by CSP')
    })

    expect(
      validateJson(testSchema, '{"title":"Test","questions":{"q1":"Question 1","q2":"Question 2"}}')
        .valid
    ).toBe(true)
    expect(validateJson(testSchema, '{"title":123}').valid).toBe(false)
  })
})

// ============================================================
// 集成：schema + example + validate 联合
// ============================================================

describe('schema / example / validate 集成', () => {
  it('用 buildJsonExample 产出的 example JSON 应通过自身 schema 校验', () => {
    const fields: Record<string, FieldNode> = {
      sectionA: group({
        sentences: group({
          s1: textLeaf('a1', '朗读第一句', 'Good morning everyone.'),
          s2: textLeaf('a2', '朗读第二句', 'Welcome to our school.')
        })
      }),
      sectionB: group({
        picture: imageLeaf('b1', '看图说话题目配图', 'A classroom full of students'),
        hint: textLeaf('b2', '关键词提示', 'classroom, students, learning')
      })
    }

    const schema = buildJsonSchema(fields)
    const example = buildJsonExample(fields)

    // 将 example 序列化为 JSON 字符串，再用 schema 校验
    const exampleStr = JSON.stringify(example)
    const result = validateJson(schema, exampleStr)

    expect(result.valid).toBe(true)
    expect(result.data).toEqual(example)
  })

  it('schema 中 additionalProperties: false 阻止任意注入', () => {
    const fields = { a: textLeaf('v1', '字段', '值') }
    const schema = buildJsonSchema(fields)

    const result = validateJson(schema, '{"a": "ok", "b": "hack"}')
    expect(result.valid).toBe(false)
  })
})
