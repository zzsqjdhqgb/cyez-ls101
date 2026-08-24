import type {
  TemplateDocument,
  TemplateNode,
  TemplatePreviewData,
  TemplatePreviewPage
} from '@ls101/template-editor'
import type { TemplatePreviewSnapshot } from './TemplatePreview'
import type { TemplatePreviewResult } from '@ls101/template-editor'

export function buildTemplatePreviewSnapshots(
  root: TemplateDocument['content']['root'],
  target: TemplateNode,
  preview: TemplatePreviewData,
  baseCallPath: readonly string[] = []
): TemplatePreviewSnapshot[] {
  const selectedPages = filterPreviewPages(root, target, preview.pages, baseCallPath)
  return selectedPages.flatMap((page, pageIndex) =>
    page.timeline.map((step, stepIndex) => ({
      id: `${page.id}:${stepIndex}`,
      page,
      pageIndex,
      step,
      stepIndex
    }))
  )
}

export function templatePreviewResourceUrls(
  result: TemplatePreviewResult | null
): Record<string, string> {
  if (!result?.success) return {}
  return Object.fromEntries(
    result.resourceSources.flatMap((source) =>
      'sourceUrl' in source ? [[source.assetKey, source.sourceUrl] as const] : []
    )
  )
}

function filterPreviewPages(
  root: TemplateDocument['content']['root'],
  target: TemplateNode,
  pages: readonly TemplatePreviewPage[],
  baseCallPath: readonly string[]
): TemplatePreviewPage[] {
  if (target.id === root.id) return [...pages]
  const directPageIds = new Set<string>()
  const functionCallIds = new Set<string>()
  collectPreviewSources(target, directPageIds, functionCallIds)
  return pages.filter(
    (page) =>
      (sameCallPath(page.callPath, baseCallPath) && directPageIds.has(page.sourceNodeId)) ||
      page.callPath.slice(baseCallPath.length).some((callId) => functionCallIds.has(callId))
  )
}

function sameCallPath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function collectPreviewSources(
  node: TemplateNode,
  pageIds: Set<string>,
  functionCallIds: Set<string>
): void {
  if (node.type === 'page') {
    pageIds.add(node.id)
    return
  }
  if (node.type === 'function') {
    functionCallIds.add(node.id)
    return
  }
  if (node.type === 'frame') {
    node.children.forEach((child) => collectPreviewSources(child, pageIds, functionCallIds))
  }
}
