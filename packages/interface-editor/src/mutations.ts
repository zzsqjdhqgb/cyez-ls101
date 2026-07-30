import type { FieldCollection, FieldNode } from './types'

/** 在指定字段组中添加节点。根级使用空路径；路径无效或 key 冲突时返回 null。 */
export function addNode(
  fields: FieldCollection,
  parentPath: readonly string[],
  key: string,
  node: FieldNode
): FieldCollection | null {
  return updateChildren(fields, parentPath, (children) => {
    if (Object.hasOwn(children.nodes, key)) return null
    return {
      order: [...children.order, key],
      nodes: { ...children.nodes, [key]: node }
    }
  })
}

/** 替换指定路径的节点。路径无效时返回 null。 */
export function updateNode(
  fields: FieldCollection,
  path: readonly string[],
  node: FieldNode
): FieldCollection | null {
  if (path.length === 0) return null
  const key = path.at(-1) as string
  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children.nodes, key)) return null
    return { ...children, nodes: { ...children.nodes, [key]: node } }
  })
}

/** 重命名指定节点，保留同层字段顺序。路径无效或新 key 冲突时返回 null。 */
export function renameNode(
  fields: FieldCollection,
  path: readonly string[],
  newKey: string
): FieldCollection | null {
  if (path.length === 0) return null
  const oldKey = path.at(-1) as string
  if (oldKey === newKey) {
    return Object.hasOwn(getChildren(fields, path.slice(0, -1))?.nodes ?? {}, oldKey)
      ? fields
      : null
  }

  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children.nodes, oldKey) || Object.hasOwn(children.nodes, newKey)) return null

    const nodes = { ...children.nodes, [newKey]: children.nodes[oldKey] }
    delete nodes[oldKey]
    return {
      order: children.order.map((key) => (key === oldKey ? newKey : key)),
      nodes
    }
  })
}

/** 删除指定路径的节点。路径无效时返回 null。 */
export function removeNode(
  fields: FieldCollection,
  path: readonly string[]
): FieldCollection | null {
  if (path.length === 0) return null
  const key = path.at(-1) as string
  return updateChildren(fields, path.slice(0, -1), (children) => {
    if (!Object.hasOwn(children.nodes, key)) return null
    const nodes = { ...children.nodes }
    delete nodes[key]
    return { order: children.order.filter((item) => item !== key), nodes }
  })
}

function updateChildren(
  fields: FieldCollection,
  groupPath: readonly string[],
  update: (children: FieldCollection) => FieldCollection | null
): FieldCollection | null {
  if (groupPath.length === 0) return update(fields)

  const [key, ...rest] = groupPath
  const group = fields.nodes[key]
  if (!group || group.type !== 'group') return null

  const children = updateChildren(group.children, rest, update)
  if (!children) return null

  return {
    ...fields,
    nodes: { ...fields.nodes, [key]: { ...group, children } }
  }
}

function getChildren(
  fields: FieldCollection,
  groupPath: readonly string[]
): FieldCollection | null {
  let children = fields
  for (const key of groupPath) {
    const group = children.nodes[key]
    if (!group || group.type !== 'group') return null
    children = group.children
  }
  return children
}
