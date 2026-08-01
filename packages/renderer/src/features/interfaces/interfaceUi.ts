import type { FieldCollection, FieldNode, ValidationError } from '@ls101/interface-editor'

export interface FieldEntry {
  key: string
  node: FieldNode
  path: string[]
  depth: number
}

export function flattenNodes(
  fields: FieldCollection,
  parentPath: string[] = [],
  depth = 0
): FieldEntry[] {
  return fields.order.flatMap((key) => {
    const node = fields.nodes[key]
    const path = [...parentPath, key]
    const current = { key, node, path, depth }
    return node.type === 'group'
      ? [current, ...flattenNodes(node.children, path, depth + 1)]
      : [current]
  })
}

export function getFieldNode(fields: FieldCollection, path: readonly string[]): FieldNode | null {
  let collection = fields
  for (const [index, key] of path.entries()) {
    const node = collection.nodes[key]
    if (!node) return null
    if (index === path.length - 1) return node
    if (node.type !== 'group') return null
    collection = node.children
  }
  return null
}

export function makeUniqueKey(
  fields: FieldCollection,
  parentPath: readonly string[],
  base: string
): string {
  let collection = fields
  for (const key of parentPath) {
    const node = collection.nodes[key]
    if (!node || node.type !== 'group') return base
    collection = node.children
  }
  let suffix = 1
  while (Object.hasOwn(collection.nodes, `${base}${suffix}`)) suffix += 1
  return `${base}${suffix}`
}

const validationMessages: Record<ValidationError['code'], string> = {
  INVALID_ID: '题型 ID 无效',
  EMPTY_NAME: '题型名称不能为空',
  EMPTY_PROMPT_TEMPLATE: '提示词不能为空',
  EMPTY_FIELDS: '至少需要一个字段',
  EMPTY_GROUP: '字段组中至少需要一个字段',
  INVALID_FIELD_ORDER: '字段顺序无效',
  INVALID_FIELD_KEY: '字段标识不能为空、包含点号或带有首尾空格',
  EMPTY_VAR_NAME: '变量名不能为空',
  INVALID_VAR_NAME: '变量名应以字母或下划线开头，且只包含字母、数字、下划线或连字符',
  EMPTY_DESCRIPTION: '字段描述不能为空',
  EMPTY_EXAMPLE: '示例值不能为空',
  DUPLICATE_VAR_NAME: '变量名不能重复'
}

export function validationMessage(error: ValidationError): string {
  const prefix = error.path ? `${error.path}：` : ''
  return `${prefix}${validationMessages[error.code]}`
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('preload bridge is unavailable')) {
      return '当前环境无法访问本地数据，请在桌面应用中打开。'
    }
    return error.message
  }
  return '操作失败，请重试。'
}

export function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}
