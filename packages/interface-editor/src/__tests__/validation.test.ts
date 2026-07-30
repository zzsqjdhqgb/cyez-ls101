import { describe, it, expect } from 'vitest'
import { validateInterfaceDef, success, failure } from '../validation'
import type { ValidationError, ValidationErrorCode } from '../validation'
import { formatError } from '../errorMessages'
import type { FieldCollection, InterfaceDef, FieldNode } from '../types'
import { asCollection, collection } from './fieldFixtures'

// ============================================================
// 测试辅助
// ============================================================

function textLeaf(varName: string, description = 'desc', example = 'ex') {
  return { type: 'text' as const, varName, description, example }
}

function group(children: Record<string, FieldNode>) {
  return { type: 'group' as const, children: collection(children) }
}

type DefOverrides = Omit<Partial<InterfaceDef>, 'fields'> & {
  fields?: FieldCollection | Record<string, FieldNode>
}

function validDef(overrides: DefOverrides = {}): InterfaceDef {
  const { fields, ...rest } = overrides
  return {
    id: `sha256:${'a'.repeat(64)}`,
    name: 'Test Interface',
    description: 'A test interface',
    promptTemplate: 'Generate a test exam',
    fields: collection({
      s1: textLeaf('question1')
    }),
    ...rest,
    ...(fields ? { fields: asCollection(fields) } : {})
  }
}

/** 断言错误列表中包含指定的错误代码和可选路径/参数 */
function expectError(
  errors: readonly ValidationError[],
  code: ValidationErrorCode,
  path: string,
  params: Record<string, string> = {}
): void {
  expect(errors).toContainEqual({ path, code, params })
}

// ============================================================
// success / failure 工厂
// ============================================================

describe('success / failure 工厂', () => {
  it('success() 返回 valid=true, errors=[]', () => {
    const r = success()
    expect(r.valid).toBe(true)
    expect(r.errors).toEqual([])
  })

  it('failure([]) 返回 valid=false, errors=[]', () => {
    const r = failure([])
    expect(r.valid).toBe(false)
    expect(r.errors).toEqual([])
  })

  it('failure 保留传入的错误列表', () => {
    const err: ValidationError = { path: 'a', code: 'EMPTY_VAR_NAME', params: {} }
    const r = failure([err])
    expect(r.valid).toBe(false)
    expect(r.errors).toEqual([err])
  })
})

// ============================================================
// 正常情况
// ============================================================

describe('validateInterfaceDef — 正常', () => {
  it('合法的 InterfaceDef 返回 valid=true 无错误', () => {
    const result = validateInterfaceDef(validDef())
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('多层嵌套的合法结构通过校验', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          sectionA: group({
            inner: textLeaf('a1')
          }),
          sectionB: group({
            sub: group({
              deep: textLeaf('b1')
            })
          })
        }
      })
    )
    expect(result.valid).toBe(true)
  })

  it('image 类型叶子合法', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          img: {
            type: 'image',
            varName: 'pic1',
            description: 'A picture',
            example: 'A cat'
          }
        }
      })
    )
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// 顶层校验
// ============================================================

describe('validateInterfaceDef — 顶层校验', () => {
  it('id 不是 SHA-256 内容 ID → INVALID_ID', () => {
    const result = validateInterfaceDef(validDef({ id: 'test-id' }))
    expectError(result.errors, 'INVALID_ID', '', { id: 'test-id' })
  })

  it('name 仅空白 → EMPTY_NAME', () => {
    const result = validateInterfaceDef(validDef({ name: '   ' }))
    expectError(result.errors, 'EMPTY_NAME', '')
  })

  it('promptTemplate 为空字符串 → EMPTY_PROMPT_TEMPLATE', () => {
    const result = validateInterfaceDef(validDef({ promptTemplate: '' }))
    expect(result.valid).toBe(false)
    expectError(result.errors, 'EMPTY_PROMPT_TEMPLATE', '')
  })

  it('promptTemplate 仅空白 → EMPTY_PROMPT_TEMPLATE', () => {
    const result = validateInterfaceDef(validDef({ promptTemplate: '   ' }))
    expectError(result.errors, 'EMPTY_PROMPT_TEMPLATE', '')
  })

  it('fields 为空 → EMPTY_FIELDS', () => {
    const result = validateInterfaceDef(validDef({ fields: {} }))
    expectError(result.errors, 'EMPTY_FIELDS', '')
  })

  it.each([
    { order: ['a', 'a'], nodes: { a: textLeaf('a'), b: textLeaf('b') } },
    { order: ['a'], nodes: { a: textLeaf('a'), b: textLeaf('b') } },
    { order: ['a', 'missing'], nodes: { a: textLeaf('a') } }
  ])('order 与 nodes 不一致 → INVALID_FIELD_ORDER', (fields) => {
    const result = validateInterfaceDef(validDef({ fields: fields as FieldCollection }))
    expectError(result.errors, 'INVALID_FIELD_ORDER', '')
  })
})

// ============================================================
// 字段组校验
// ============================================================

describe('validateInterfaceDef — 字段组校验', () => {
  it('字段 key 含点号 → INVALID_FIELD_KEY', () => {
    const result = validateInterfaceDef(validDef({ fields: { 'section.a': textLeaf('value') } }))
    expectError(result.errors, 'INVALID_FIELD_KEY', 'section.a', { key: 'section.a' })
  })

  it('字段 key 含首尾空格 → INVALID_FIELD_KEY', () => {
    const result = validateInterfaceDef(validDef({ fields: { ' field ': textLeaf('value') } }))
    expectError(result.errors, 'INVALID_FIELD_KEY', ' field ', { key: ' field ' })
  })

  it('FieldGroup.children 为空 → EMPTY_GROUP', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: { emptyGroup: group({}) }
      })
    )
    expectError(result.errors, 'EMPTY_GROUP', 'emptyGroup')
  })

  it('嵌套的空字段组 → 错误路径正确', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          outer: group({
            inner: group({})
          })
        }
      })
    )
    expectError(result.errors, 'EMPTY_GROUP', 'outer.inner')
  })
})

// ============================================================
// varName 校验
// ============================================================

describe('validateInterfaceDef — varName 校验', () => {
  it('varName 为空字符串 → EMPTY_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('') } }))
    expectError(result.errors, 'EMPTY_VAR_NAME', 'a')
  })

  it('varName 仅空白 → EMPTY_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('  ') } }))
    expectError(result.errors, 'EMPTY_VAR_NAME', 'a')
  })

  it('varName 含空格 → INVALID_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('my var') } }))
    expectError(result.errors, 'INVALID_VAR_NAME', 'a', { varName: 'my var' })
  })

  it('varName 含特殊字符 → INVALID_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('var@name') } }))
    expectError(result.errors, 'INVALID_VAR_NAME', 'a', { varName: 'var@name' })
  })

  it('varName 以数字开头 → INVALID_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('1var') } }))
    expectError(result.errors, 'INVALID_VAR_NAME', 'a', { varName: '1var' })
  })

  it('varName 合法格式：字母开头 + 连字符 + 下划线 → 通过', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('my_var-name2') } }))
    expect(result.valid).toBe(true)
  })

  it('varName 以下划线开头 → 通过', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('_private') } }))
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// varName 唯一性
// ============================================================

describe('validateInterfaceDef — varName 唯一性', () => {
  it('多个空 varName 不额外产生 DUPLICATE_VAR_NAME', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf(''), b: textLeaf('') } }))
    expect(result.errors.filter((error) => error.code === 'EMPTY_VAR_NAME')).toHaveLength(2)
    expect(result.errors.some((error) => error.code === 'DUPLICATE_VAR_NAME')).toBe(false)
  })

  it('同层重复 varName → DUPLICATE_VAR_NAME', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          a: textLeaf('dup'),
          b: textLeaf('dup')
        }
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: expect.any(String) as unknown as string,
      code: 'DUPLICATE_VAR_NAME' as const,
      params: { varName: 'dup' }
    })
  })

  it('跨层重复 varName → 第二个出现的被标记', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          top: textLeaf('dup'),
          grp: group({
            inner: textLeaf('dup')
          })
        }
      })
    )
    expect(result.valid).toBe(false)
    expect(result.errors).toContainEqual({
      path: 'grp.inner',
      code: 'DUPLICATE_VAR_NAME' as const,
      params: { varName: 'dup' }
    })
  })

  it('全部 varName 唯一 → 通过', () => {
    const result = validateInterfaceDef(
      validDef({
        fields: {
          a: textLeaf('v1'),
          b: textLeaf('v2'),
          c: textLeaf('v3')
        }
      })
    )
    expect(result.valid).toBe(true)
  })
})

// ============================================================
// description / example 非空
// ============================================================

describe('validateInterfaceDef — description / example', () => {
  it('description 为空 → EMPTY_DESCRIPTION', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('ok', '') } }))
    expectError(result.errors, 'EMPTY_DESCRIPTION', 'a')
  })

  it('example 为空 → EMPTY_EXAMPLE', () => {
    const result = validateInterfaceDef(validDef({ fields: { a: textLeaf('ok', 'desc', '') } }))
    expectError(result.errors, 'EMPTY_EXAMPLE', 'a')
  })
})

// ============================================================
// 多重错误聚合
// ============================================================

describe('validateInterfaceDef — 多重错误聚合', () => {
  it('同时存在多个错误时全部收集', () => {
    const result = validateInterfaceDef(
      validDef({
        promptTemplate: '',
        fields: {
          a: textLeaf(''), // EMPTY_VAR_NAME
          b: textLeaf('dup'), // 首次出现，不报
          c: textLeaf('dup') // DUPLICATE_VAR_NAME
        }
      })
    )
    expect(result.valid).toBe(false)
    // EMPTY_PROMPT_TEMPLATE + EMPTY_VAR_NAME + DUPLICATE_VAR_NAME = 3
    expect(result.errors.length).toBe(3)
  })
})

// ============================================================
// errorMessages — formatError
// ============================================================

describe('formatError', () => {
  it('渲染 EMPTY_VAR_NAME', () => {
    const err: ValidationError = { path: 'a', code: 'EMPTY_VAR_NAME', params: {} }
    expect(formatError(err)).toBe('变量名不能为空')
  })

  it('渲染 INVALID_VAR_NAME 含 params 插值', () => {
    const err: ValidationError = {
      path: 'a',
      code: 'INVALID_VAR_NAME',
      params: { varName: 'foo bar' }
    }
    expect(formatError(err)).toContain('"foo bar"')
    expect(formatError(err)).toContain('格式无效')
  })

  it('渲染 DUPLICATE_VAR_NAME 含 params 插值', () => {
    const err: ValidationError = {
      path: 'grp.inner',
      code: 'DUPLICATE_VAR_NAME',
      params: { varName: 'dup' }
    }
    expect(formatError(err)).toContain('"dup"')
    expect(formatError(err)).toContain('重复')
  })

  it('未知 code 降级为 code 名称', () => {
    const err: ValidationError = {
      path: '',
      code: 'UNKNOWN_CODE' as ValidationErrorCode,
      params: {}
    }
    expect(formatError(err)).toBe('未知错误: UNKNOWN_CODE')
  })

  it('模板中未提供的 params 保留占位符原样', () => {
    const err: ValidationError = {
      path: 'a',
      code: 'INVALID_VAR_NAME',
      params: {}
    }
    // params 缺 varName → "{{varName}}" 不被替换
    expect(formatError(err)).toContain('{{varName}}')
  })
})
