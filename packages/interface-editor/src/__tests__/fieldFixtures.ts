import type { FieldCollection, FieldNode } from '../types'

export function collection(
  nodes: Record<string, FieldNode>,
  order: string[] = Object.keys(nodes)
): FieldCollection {
  return { order, nodes }
}

export function isCollection(
  value: FieldCollection | Record<string, FieldNode>
): value is FieldCollection {
  return 'order' in value && 'nodes' in value
}

export function asCollection(value: FieldCollection | Record<string, FieldNode>): FieldCollection {
  return isCollection(value) ? value : collection(value)
}
