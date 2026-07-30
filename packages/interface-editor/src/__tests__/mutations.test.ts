import { describe, expect, it } from 'vitest'
import { addNode, removeNode, renameNode, updateNode } from '../mutations'
import type { FieldGroup, FieldLeaf, FieldNode } from '../types'
import { collection } from './fieldFixtures'

function leaf(varName: string): FieldLeaf {
  return { type: 'text', varName, description: 'desc', example: 'example' }
}

function group(children: Record<string, FieldNode>): FieldGroup {
  return { type: 'group', children: collection(children) }
}

describe('字段树写操作', () => {
  it('在根级添加节点且不修改原树', () => {
    const fields = collection({ a: leaf('a') })
    const result = addNode(fields, [], 'b', leaf('b'))

    expect(result).toEqual(collection({ a: leaf('a'), b: leaf('b') }))
    expect(fields).toEqual(collection({ a: leaf('a') }))
  })

  it('添加数字型 key 时追加到显式 order，而不采用对象数值排序', () => {
    const fields = collection({ 10: leaf('ten') }, ['10'])
    const result = addNode(fields, [], '2', leaf('two'))

    expect(result?.order).toEqual(['10', '2'])
    expect(Object.keys(result?.nodes ?? {})).toEqual(['2', '10'])
  })

  it('在嵌套 group 添加节点并保留未修改分支引用', () => {
    const untouched = group({ value: leaf('value') })
    const fields = collection({ section: group({ a: leaf('a') }), untouched })
    const result = addNode(fields, ['section'], 'b', leaf('b'))

    expect((result?.nodes.section as FieldGroup).children).toEqual(
      collection({ a: leaf('a'), b: leaf('b') })
    )
    expect(result?.nodes.untouched).toBe(untouched)
  })

  it('添加同名节点或向叶子添加子节点时返回 null', () => {
    const fields = collection({ a: leaf('a') })
    expect(addNode(fields, [], 'a', leaf('other'))).toBeNull()
    expect(addNode(fields, ['a'], 'child', leaf('child'))).toBeNull()
  })

  it('替换嵌套节点', () => {
    const fields = collection({ section: group({ a: leaf('a') }) })
    const replacement = { ...leaf('renamed'), type: 'image' as const }
    const result = updateNode(fields, ['section', 'a'], replacement)

    expect((result?.nodes.section as FieldGroup).children.nodes.a).toEqual(replacement)
  })

  it('重命名节点并保留原有顺序', () => {
    const fields = collection({ first: leaf('a'), second: leaf('b'), third: leaf('c') })
    const result = renameNode(fields, ['second'], 'renamed')

    expect(result?.order).toEqual(['first', 'renamed', 'third'])
    expect(result?.nodes.renamed).toBe(fields.nodes.second)
  })

  it('重命名为同层已有 key 时返回 null', () => {
    const fields = collection({ a: leaf('a'), b: leaf('b') })
    expect(renameNode(fields, ['a'], 'b')).toBeNull()
  })

  it('删除嵌套节点且不修改原树', () => {
    const fields = collection({ section: group({ a: leaf('a'), b: leaf('b') }) })
    const result = removeNode(fields, ['section', 'a'])

    expect((result?.nodes.section as FieldGroup).children).toEqual(collection({ b: leaf('b') }))
    expect((fields.nodes.section as FieldGroup).children.nodes).toHaveProperty('a')
  })

  it('空路径和不存在路径返回 null', () => {
    const fields = collection({ a: leaf('a') })
    expect(updateNode(fields, [], leaf('b'))).toBeNull()
    expect(removeNode(fields, ['missing'])).toBeNull()
    expect(renameNode(fields, ['missing'], 'next')).toBeNull()
  })
})
