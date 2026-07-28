import { describe, expect, it } from 'vitest'
import { addNode, removeNode, renameNode, updateNode } from '../mutations'
import type { FieldGroup, FieldLeaf, FieldNode } from '../types'

function leaf(varName: string): FieldLeaf {
  return { type: 'text', varName, description: 'desc', example: 'example' }
}

function group(children: Record<string, FieldNode>): FieldGroup {
  return { type: 'group', children }
}

describe('字段树写操作', () => {
  it('在根级添加节点且不修改原树', () => {
    const fields = { a: leaf('a') }
    const result = addNode(fields, [], 'b', leaf('b'))

    expect(result).toEqual({ a: leaf('a'), b: leaf('b') })
    expect(fields).toEqual({ a: leaf('a') })
  })

  it('在嵌套 group 添加节点并保留未修改分支引用', () => {
    const untouched = group({ value: leaf('value') })
    const fields = { section: group({ a: leaf('a') }), untouched }
    const result = addNode(fields, ['section'], 'b', leaf('b'))

    expect((result?.section as FieldGroup).children).toEqual({ a: leaf('a'), b: leaf('b') })
    expect(result?.untouched).toBe(untouched)
  })

  it('添加同名节点或向叶子添加子节点时返回 null', () => {
    const fields = { a: leaf('a') }
    expect(addNode(fields, [], 'a', leaf('other'))).toBeNull()
    expect(addNode(fields, ['a'], 'child', leaf('child'))).toBeNull()
  })

  it('替换嵌套节点', () => {
    const fields = { section: group({ a: leaf('a') }) }
    const replacement = { ...leaf('renamed'), type: 'image' as const }
    const result = updateNode(fields, ['section', 'a'], replacement)

    expect((result?.section as FieldGroup).children.a).toEqual(replacement)
  })

  it('重命名节点并保留原有顺序', () => {
    const fields = { first: leaf('a'), second: leaf('b'), third: leaf('c') }
    const result = renameNode(fields, ['second'], 'renamed')

    expect(Object.keys(result ?? {})).toEqual(['first', 'renamed', 'third'])
    expect(result?.renamed).toBe(fields.second)
  })

  it('重命名为同层已有 key 时返回 null', () => {
    const fields = { a: leaf('a'), b: leaf('b') }
    expect(renameNode(fields, ['a'], 'b')).toBeNull()
  })

  it('删除嵌套节点且不修改原树', () => {
    const fields = { section: group({ a: leaf('a'), b: leaf('b') }) }
    const result = removeNode(fields, ['section', 'a'])

    expect((result?.section as FieldGroup).children).toEqual({ b: leaf('b') })
    expect((fields.section as FieldGroup).children).toHaveProperty('a')
  })

  it('空路径和不存在路径返回 null', () => {
    const fields = { a: leaf('a') }
    expect(updateNode(fields, [], leaf('b'))).toBeNull()
    expect(removeNode(fields, ['missing'])).toBeNull()
    expect(renameNode(fields, ['missing'], 'next')).toBeNull()
  })
})
