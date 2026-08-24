import type { FrameNode, TemplateDocument } from '../types'

export function pruneResources(
  root: FrameNode,
  document: TemplateDocument
): TemplateDocument['resources'] {
  const byId = new Map(document.resources.functions.map((resource) => [resource.id, resource]))
  const reachable = new Set<string>()
  const visit = (frame: FrameNode): void => {
    frame.children.forEach((node) => {
      if (node.type === 'frame') visit(node)
      if (node.type !== 'function' || reachable.has(node.functionRef)) return
      reachable.add(node.functionRef)
      const resource = byId.get(node.functionRef)
      if (resource) visit(resource.body)
    })
  }
  visit(root)
  if (reachable.size === document.resources.functions.length) return document.resources
  return {
    functions: document.resources.functions.filter((resource) => reachable.has(resource.id))
  }
}
