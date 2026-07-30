import { describe, it, expect } from 'vitest'
import {
  flattenFields as flattenFieldCollection,
  findNodeByPath as findNodeInCollection,
  getAllVarNames as getCollectionVarNames
} from '../queries'
import type { FieldNode, FieldLeaf, FieldGroup } from '../types'
import { collection } from './fieldFixtures'

// ============================================================
// 测试辅助：工厂函数
// ============================================================

/** 快速创建一个 text 叶子字段 */
function textLeaf(varName: string, description = 'desc', example = 'ex'): FieldLeaf {
  return { type: 'text', varName, description, example }
}

/** 快速创建一个 image 叶子字段 */
function imageLeaf(varName: string, description = 'desc', example = 'ex'): FieldLeaf {
  return { type: 'image', varName, description, example }
}

/** 快速创建一个字段组 */
function group(children: Record<string, FieldNode>): FieldGroup {
  return { type: 'group', children: collection(children) }
}

const flattenFields = (fields: Record<string, FieldNode>) =>
  flattenFieldCollection(collection(fields))
const findNodeByPath = (fields: Record<string, FieldNode>, path: string) =>
  findNodeInCollection(collection(fields), path)
const getAllVarNames = (fields: Record<string, FieldNode>) =>
  getCollectionVarNames(collection(fields))

// ============================================================
// flattenFields
// ============================================================

describe('flattenFields', () => {
  it('空树返回空数组', () => {
    expect(flattenFields({})).toEqual([])
  })

  it('单层单叶子 — 路径为 key 本身', () => {
    const leaf = textLeaf('v1')
    const result = flattenFields({ a: leaf })
    expect(result).toEqual([{ path: 'a', leaf }])
  })

  it('多个同层叶子按定义顺序排列', () => {
    const a = textLeaf('va')
    const b = textLeaf('vb')
    const result = flattenFields({ first: a, second: b })
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ path: 'first', leaf: a })
    expect(result[1]).toEqual({ path: 'second', leaf: b })
  })

  it('数字型 key 严格按显式 order 排列', () => {
    const two = textLeaf('two')
    const ten = textLeaf('ten')
    const fields = collection({ 2: two, 10: ten }, ['10', '2'])

    expect(flattenFieldCollection(fields)).toEqual([
      { path: '10', leaf: ten },
      { path: '2', leaf: two }
    ])
  })

  it('嵌套一层 — 路径以 . 分隔', () => {
    const leaf = textLeaf('inner')
    const tree = { outer: group({ inner: leaf }) }
    expect(flattenFields(tree)).toEqual([{ path: 'outer.inner', leaf }])
  })

  it('深层嵌套 — 路径逐层拼接', () => {
    const leaf = textLeaf('deep')
    const tree = { a: group({ b: group({ c: leaf }) }) }
    expect(flattenFields(tree)).toEqual([{ path: 'a.b.c', leaf }])
  })

  it('同层同时存在叶子和组 — 按定义顺序输出，组的子节点递归展开', () => {
    const leaf1 = textLeaf('root')
    const leaf2 = textLeaf('nested')
    const tree = { top: leaf1, grp: group({ sub: leaf2 }) }
    expect(flattenFields(tree)).toEqual([
      { path: 'top', leaf: leaf1 },
      { path: 'grp.sub', leaf: leaf2 }
    ])
  })

  it('支持 image 类型叶子', () => {
    const leaf = imageLeaf('img1')
    expect(flattenFields({ pic: leaf })).toEqual([{ path: 'pic', leaf }])
  })
})

// ============================================================
// findNodeByPath
// ============================================================

describe('findNodeByPath', () => {
  const leaf = textLeaf('v1')
  const tree = {
    a: leaf,
    grp: group({
      b: textLeaf('v2'),
      sub: group({ c: imageLeaf('v3') })
    })
  }

  it('路径指向顶层叶子 — 返回该叶子', () => {
    expect(findNodeByPath(tree, 'a')).toBe(leaf)
  })

  it('路径指向字段组 — 返回该组', () => {
    const result = findNodeByPath(tree, 'grp')
    expect(result).not.toBeNull()
    expect(result!.type).toBe('group')
  })

  it('路径指向嵌套叶子 — 返回该叶子', () => {
    const result = findNodeByPath(tree, 'grp.b')
    expect(result).not.toBeNull()
    expect((result as FieldLeaf).varName).toBe('v2')
  })

  it('路径指向深层嵌套叶子', () => {
    const result = findNodeByPath(tree, 'grp.sub.c')
    expect(result).not.toBeNull()
    expect((result as FieldLeaf).varName).toBe('v3')
  })

  it('不存在的顶层 key — 返回 null', () => {
    expect(findNodeByPath(tree, 'zzz')).toBeNull()
  })

  it('路径穿过叶子（叶子无 children）— 返回 null', () => {
    expect(findNodeByPath(tree, 'a.nope')).toBeNull()
  })

  it('部分存在的嵌套路径 — 返回 null', () => {
    expect(findNodeByPath(tree, 'grp.zzz')).toBeNull()
  })

  it('空路径 — 返回 null（无法在 Record 中定位）', () => {
    expect(findNodeByPath(tree, '')).toBeNull()
  })

  it('空树任意路径返回 null', () => {
    expect(findNodeByPath({}, 'a')).toBeNull()
  })
})

// ============================================================
// getAllVarNames
// ============================================================

describe('getAllVarNames', () => {
  it('空树返回空数组', () => {
    expect(getAllVarNames({})).toEqual([])
  })

  it('单叶子返回该 varName', () => {
    expect(getAllVarNames({ a: textLeaf('hello') })).toEqual(['hello'])
  })

  it('嵌套结构收集所有 varName', () => {
    const tree = {
      root: textLeaf('v1'),
      grp: group({
        sub1: textLeaf('v2'),
        sub2: imageLeaf('v3')
      })
    }
    expect(getAllVarNames(tree)).toEqual(['v1', 'v2', 'v3'])
  })

  it('保留 varName 原始顺序（深度优先）', () => {
    const tree = {
      first: textLeaf('a'),
      mid: group({ inner: textLeaf('b') }),
      last: textLeaf('c')
    }
    expect(getAllVarNames(tree)).toEqual(['a', 'b', 'c'])
  })
})
