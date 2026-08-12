import { describe, it, expect } from 'vitest'
import {
  buildAIPrompt,
  buildExposedInstance,
  buildVarManifest,
  buildInstanceFromJson
} from '../conversions'
import type { InterfaceDef, FieldCollection, FieldNode, FieldLeaf, FieldGroup } from '../types'
import { asCollection, collection } from './fieldFixtures'

// ============================================================
// 测试辅助
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

type DefOverrides = Omit<Partial<InterfaceDef>, 'fields'> & {
  fields?: FieldCollection | Record<string, FieldNode>
}

function makeDef(overrides: DefOverrides = {}): InterfaceDef {
  const { fields, ...rest } = overrides
  return {
    id: 'if-test-001',
    name: '测试题型',
    description: '用于测试的 Interface',
    promptTemplate: '请生成一套测试题目',
    fields: collection({
      title: textLeaf('examTitle', '试卷标题', '2024 英语模拟卷')
    }),
    ...rest,
    ...(fields ? { fields: asCollection(fields) } : {})
  }
}

// ============================================================
// buildAIPrompt
// ============================================================

describe('buildAIPrompt', () => {
  it('包含 promptTemplate', () => {
    const def = makeDef({ promptTemplate: '请生成一套测试题目' })
    const prompt = buildAIPrompt(def)
    expect(prompt).toContain('请生成一套测试题目')
  })

  it('包含 JSON Schema（type: "object"）', () => {
    const prompt = buildAIPrompt(makeDef())
    expect(prompt).toContain('"type": "object"')
    expect(prompt).toContain('"additionalProperties": false')
  })

  it('包含 leaf 的 description 在 schema 中', () => {
    const def = makeDef({
      fields: { q: textLeaf('v1', '题干描述', '示例题干') }
    })
    const prompt = buildAIPrompt(def)
    expect(prompt).toContain('题干描述')
  })

  it('明确要求 image 字段返回生图提示词而不是 URL', () => {
    const prompt = buildAIPrompt(
      makeDef({
        fields: { picture: imageLeaf('image', '考试配图', '学生在教室学习') }
      })
    )
    expect(prompt).toContain('图片生成模型')
    expect(prompt).toContain('不要返回图片 URL')
  })

  it('包含 JSON Example', () => {
    const def = makeDef({
      fields: { q: textLeaf('v1', 'desc', '示例值ABC') }
    })
    const prompt = buildAIPrompt(def)
    expect(prompt).toContain('示例值ABC')
  })

  it('包含嵌套结构的 schema 和 example', () => {
    const def = makeDef({
      fields: {
        section: group({
          s1: textLeaf('a1', '第一句', 'Hello'),
          s2: textLeaf('a2', '第二句', 'World')
        })
      }
    })
    const prompt = buildAIPrompt(def)
    expect(prompt).toContain('"section"')
    expect(prompt).toContain('"Hello"')
    expect(prompt).toContain('"World"')
  })

  it('不包含 varName', () => {
    const def = makeDef({
      fields: { q: textLeaf('myPrivateVar', 'desc', 'ex') }
    })
    const prompt = buildAIPrompt(def)
    expect(prompt).not.toContain('myPrivateVar')
  })

  it('promptTemplate 在 schema 和 example 之前', () => {
    const def = makeDef({
      promptTemplate: '开头内容',
      fields: { q: textLeaf('v1', 'desc', 'ex') }
    })
    const prompt = buildAIPrompt(def)
    const schemaPos = prompt.indexOf('"type": "object"')
    const examplePos = prompt.indexOf('示例输出')
    const promptPos = prompt.indexOf('开头内容')
    expect(promptPos).toBeLessThan(schemaPos)
    expect(schemaPos).toBeLessThan(examplePos)
  })
})

// ============================================================
// buildVarManifest
// ============================================================

describe('buildVarManifest', () => {
  it('interfaceId 和 interfaceName 正确传递', () => {
    const def = makeDef({
      id: 'if-abc',
      name: '上海高考口语'
    })
    const manifest = buildVarManifest(def)
    expect(manifest.interfaceId).toBe('if-abc')
    expect(manifest.interfaceName).toBe('上海高考口语')
  })

  it('单个 text leaf → 一个变量', () => {
    const manifest = buildVarManifest(
      makeDef({
        fields: { q: textLeaf('v1', '题干', '示例') }
      })
    )
    expect(manifest.vars).toHaveLength(1)
    expect(manifest.vars[0]).toEqual({
      varName: 'v1',
      type: 'text',
      description: '题干',
      example: '示例',
      path: 'q'
    })
  })

  it('image leaf → type 为 image', () => {
    const manifest = buildVarManifest(
      makeDef({
        fields: { pic: imageLeaf('img1', '配图', '一只猫') }
      })
    )
    expect(manifest.vars.map(({ varName, type }) => ({ varName, type }))).toEqual([
      { varName: 'img1.inst', type: 'text' },
      { varName: 'img1.img', type: 'image' }
    ])
  })

  it('多个叶子 → 按深度优先顺序排列', () => {
    const manifest = buildVarManifest(
      makeDef({
        fields: {
          a: textLeaf('va', '字段A', 'A'),
          grp: group({
            b: textLeaf('vb', '字段B', 'B'),
            c: imageLeaf('vc', '字段C', 'C')
          }),
          d: textLeaf('vd', '字段D', 'D')
        }
      })
    )
    expect(manifest.vars).toHaveLength(5)
    // 深度优先：a, grp.b, grp.c, d
    expect(manifest.vars.map((v) => v.path)).toEqual(['a', 'grp.b', 'grp.c', 'grp.c', 'd'])
    expect(manifest.vars.map((v) => v.varName)).toEqual(['va', 'vb', 'vc.inst', 'vc.img', 'vd'])
  })

  it('空 fields → vars 为空数组', () => {
    const manifest = buildVarManifest(makeDef({ fields: {} }))
    expect(manifest.vars).toEqual([])
  })
})

describe('buildExposedInstance', () => {
  it('将图片字段拆成提示词和图片变量', () => {
    const def = makeDef({ fields: { picture: imageLeaf('questionImage') } })
    const instance = buildInstanceFromJson(def, { picture: '校园操场' })
    instance.values.questionImage = 'questionImage.png'
    expect(buildExposedInstance(def, instance).values).toEqual({
      'questionImage.inst': '校园操场',
      'questionImage.img': 'questionImage.png'
    })
  })
})

// ============================================================
// buildInstanceFromJson
// ============================================================

describe('buildInstanceFromJson', () => {
  it('单字段 → varName 映射到 JSON 值', () => {
    const def = makeDef({
      fields: { q: textLeaf('title', '标题', 'ex') }
    })
    const instance = buildInstanceFromJson(def, { q: '2024 模拟卷' })
    expect(instance.values).toEqual({ title: '2024 模拟卷' })
  })

  it('多字段 → 按 varName 收集', () => {
    const def = makeDef({
      fields: {
        name: textLeaf('studentName', '姓名', '张三'),
        score: textLeaf('totalScore', '总分', '100')
      }
    })
    const instance = buildInstanceFromJson(def, {
      name: '李四',
      score: '95'
    })
    expect(instance.values).toEqual({
      studentName: '李四',
      totalScore: '95'
    })
  })

  it('嵌套 JSON → 按路径取值', () => {
    const def = makeDef({
      fields: {
        sectionA: group({
          s1: textLeaf('sent1', '第一句', 'ex'),
          s2: textLeaf('sent2', '第二句', 'ex')
        })
      }
    })
    const instance = buildInstanceFromJson(def, {
      sectionA: { s1: 'Good morning.', s2: 'Welcome.' }
    })
    expect(instance.values).toEqual({
      sent1: 'Good morning.',
      sent2: 'Welcome.'
    })
  })

  it('深层嵌套 → 正确遍历', () => {
    const def = makeDef({
      fields: {
        a: group({
          b: group({
            c: textLeaf('deep', '深层值', 'ex')
          })
        })
      }
    })
    const instance = buildInstanceFromJson(def, {
      a: { b: { c: 'found me' } }
    })
    expect(instance.values).toEqual({ deep: 'found me' })
  })

  it('instanceId 每次不同', () => {
    const def = makeDef()
    const i1 = buildInstanceFromJson(def, { q: 'a' })
    const i2 = buildInstanceFromJson(def, { q: 'b' })
    expect(i1.instanceId).not.toBe(i2.instanceId)
  })

  it('generatedAt 为 ISO 8601 时间戳', () => {
    const instance = buildInstanceFromJson(makeDef(), { q: 'x' })
    expect(() => new Date(instance.generatedAt)).not.toThrow()
    expect(new Date(instance.generatedAt).toISOString()).toBe(instance.generatedAt)
  })

  it('实例名称使用本地默认值，不从 JSON 数据读取', () => {
    const instance = buildInstanceFromJson(makeDef(), { q: 'x', name: 'AI 名称' })
    expect(instance.name).toBe('未命名实例')
  })

  it('data 中路径不存在 → 降级为空字符串', () => {
    const def = makeDef({
      fields: {
        section: group({
          missing: textLeaf('lost', '缺失', 'ex')
        })
      }
    })
    const instance = buildInstanceFromJson(def, { section: {} })
    expect(instance.values).toEqual({ lost: '' })
  })

  it('data 中间节点为 null → 降级为空字符串', () => {
    const def = makeDef({
      fields: {
        section: group({
          sub: textLeaf('val', '值', 'ex')
        })
      }
    })
    const instance = buildInstanceFromJson(def, {
      section: null as unknown as Record<string, unknown>
    })
    expect(instance.values).toEqual({ val: '' })
  })

  it('image 字段将中间提示词与下游图片值分开', () => {
    const def = makeDef({
      fields: { pic: imageLeaf('img', '图片', 'ex') }
    })
    const instance = buildInstanceFromJson(def, { pic: 'https://example.com/img.png' })
    expect(instance.values).toEqual({ img: '' })
    expect(instance.imagePrompts).toEqual({ img: 'https://example.com/img.png' })
  })

  it('值中包含数字时转为字符串', () => {
    const def = makeDef({
      fields: { q: textLeaf('v', '字段', 'ex') }
    })
    // LLM 可能返回数字不是字符串，但 JSON schema 要求 string
    const instance = buildInstanceFromJson(def, { q: 42 as unknown as string })
    expect(instance.values).toEqual({ v: '42' })
  })
})
