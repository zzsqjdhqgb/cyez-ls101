import type {
  TemplateDocument,
  TemplateNode,
  TemplatePreviewData,
  TemplatePreviewPage
} from '@ls101/template-editor'
import type { TemplatePreviewSnapshot } from './TemplatePreview'
import type { TemplatePreviewSession } from './useTemplatePreview'

export function buildTemplatePreviewSnapshots(
  root: TemplateDocument['content']['root'],
  target: TemplateNode,
  preview: TemplatePreviewData
): TemplatePreviewSnapshot[] {
  const selectedPages = filterPreviewPages(root, target, preview.pages)
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
  result: TemplatePreviewSession['result']
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
  pages: readonly TemplatePreviewPage[]
): TemplatePreviewPage[] {
  if (target.id === root.id) return [...pages]
  const directPageIds = new Set<string>()
  const functionCallIds = new Set<string>()
  collectPreviewSources(target, directPageIds, functionCallIds)
  return pages.filter(
    (page) =>
      (page.callPath.length === 0 && directPageIds.has(page.sourceNodeId)) ||
      (page.callPath.length > 0 && functionCallIds.has(page.callPath[0]))
  )
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
