import type { FieldNode } from './types'

/** 在指定字段组中添加节点。根级使用空路径；路径无效或 key 冲突时返回 null。 */
export function addNode(
  fields: Record<string, FieldNode>,
  parentPath: readonly string[],
  key: string,
  node: FieldNode
): Record<string, FieldNode> | null {
  return updateChildren(fields, parentPath, (children) => {
    if (Object.hasOwn(children, key)) return null
    return { ...children, [key]: node }
  })
}

/** 替换指定路径的节点。路径无效时返回 null。 */
export function updateNode(
  fields: Record<string, FieldNode>,
  path: readonly string[],
  node: FieldNode
): Record<string, FieldNode> | null {
  if (path.length === 0) return null
  const key = path.at(-1) as string
  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children, key)) return null
    return { ...children, [key]: node }
  })
}

/** 重命名指定节点，保留同层字段顺序。路径无效或新 key 冲突时返回 null。 */
export function renameNode(
  fields: Record<string, FieldNode>,
  path: readonly string[],
  newKey: string
): Record<string, FieldNode> | null {
  if (path.length === 0) return null
  const oldKey = path.at(-1) as string
  if (oldKey === newKey) {
    return Object.hasOwn(getChildren(fields, path.slice(0, -1)) ?? {}, oldKey) ? fields : null
  }

  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children, oldKey) || Object.hasOwn(children, newKey)) return null

    return Object.fromEntries(
      Object.entries(children).map(([key, node]) => (key === oldKey ? [newKey, node] : [key, node]))
    )
  })
}

/** 删除指定路径的节点。路径无效时返回 null。 */
export function removeNode(
  fields: Record<string, FieldNode>,
  path: readonly string[]
): Record<string, FieldNode> | null {
  if (path.length === 0) return null
  const key = path.at(-1) as string
  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children, key)) return null
    const next = { ...children }
    delete next[key]
    return next
  })
}

function updateChildren(
  fields: Record<string, FieldNode>,
  groupPath: readonly string[],
  update: (children: Record<string, FieldNode>) => Record<string, FieldNode> | null
): Record<string, FieldNode> | null {
  if (groupPath.length === 0) return update(fields)

  const [key, ...rest] = groupPath
  const group = fields[key]
  if (!group || group.type !== 'group') return null

  const children = updateChildren(group.children, rest, update)
  if (!children) return null

  return {
    ...fields,
    [key]: { ...group, children }
  }
}

function getChildren(
  fields: Record<string, FieldNode>,
  groupPath: readonly string[]
): Record<string, FieldNode> | null {
  let children = fields
  for (const key of groupPath) {
    const group = children[key]
    if (!group || group.type !== 'group') return null
    children = group.children
  }
  return children
}
