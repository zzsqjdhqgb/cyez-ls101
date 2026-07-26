// @ls101/interface-editor — 字段树查询
//
// 纯函数集合，对 InterfaceDef 的 fields 树进行只读查询。
//
// 已实现:
//   flattenFields(tree) → { path, leaf }[]
//     — 递归平铺字段树为叶子列表（含路径）。
//       用于: buildVarManifest, buildAIPrompt, 校验
//
//   findNodeByPath(tree, path) → FieldNode | null
//     — 按 "." 分隔的路径查找节点。
//       用于: 编辑器树点击导航
//
//   getAllVarNames(tree) → string[]
//     — 收集所有 varName。
//       用于: varName 唯一性校验
//
// 待实现:
//   [无 — 查询层已完整]

import type { FieldLeaf, FieldGroup, FieldNode } from './types'

/**
 * 递归平铺字段树，返回所有叶子字段及其完整路径。
 *
 * @example
 * flattenFields({ a: { type: "group", children: { b: { type: "text", varName: "x", description: "...", example: "..." } } } })
 * // → [{ path: "a.b", leaf: { type: "text", varName: "x", ... } }]
 */
export function flattenFields(
  fields: Record<string, FieldNode>,
  parentPath = ''
): { path: string; leaf: FieldLeaf }[] {
  const result: { path: string; leaf: FieldLeaf }[] = []
  for (const [key, node] of Object.entries(fields)) {
    const currentPath = parentPath ? `${parentPath}.${key}` : key
    if (isFieldLeaf(node)) {
      result.push({ path: currentPath, leaf: node })
    } else {
      result.push(...flattenFields(node.children, currentPath))
    }
  }
  return result
}

/**
 * 按路径查找字段树中的节点。
 * 路径以 "." 分隔每层的 key，如 "sectionA.sentences.s1"。
 * 路径指向叶子字段时返回 FieldLeaf，指向中间节点时返回 FieldGroup。
 *
 * @returns 找到的节点，路径无效时返回 null
 */
export function findNodeByPath(fields: Record<string, FieldNode>, path: string): FieldNode | null {
  const segments = path.split('.')
  let current: Record<string, FieldNode> = fields
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i]
    const node = current[key]
    if (!node) return null
    // 到达路径末尾 — 返回当前节点（可能是叶子或组）
    if (i === segments.length - 1) return node
    // 路径未走完但当前节点是叶子 — 无法继续深入
    if (!isFieldGroup(node)) return null
    current = node.children
  }
  return null
}

/**
 * 收集字段树中所有叶子字段的变量名。
 */
export function getAllVarNames(fields: Record<string, FieldNode>): string[] {
  return flattenFields(fields).map((f) => f.leaf.varName)
}

// ============================================================
// 内部类型守卫
// ============================================================

function isFieldLeaf(node: FieldNode): node is FieldLeaf {
  return node.type !== 'group'
}

function isFieldGroup(node: FieldNode): node is FieldGroup {
  return node.type === 'group'
}
