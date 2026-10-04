import type { GradingResourceInput } from '@ls101/submission-library'
import { marked, Renderer, type Tokens } from 'marked'

/** 报告 Markdown 里的资源引用；与 submission-library 的写法保持一致。 */
const RESOURCE_ATTRIBUTE = /(src|href)="resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)"/g
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_DATA_URL = /^data:image\//i

export type ReportResourceUrlResolver = (resource: GradingResourceInput) => string

/**
 * 报告 Markdown → HTML：查看报告与导出 PDF 共用这一份实现。
 *
 * marked 默认保留原始 HTML，而报告正文里可能有学生输入，因此这里显式做两件事：
 * 原始 HTML 一律转义成文本，链接与图片地址只放行已知协议（`resource:` 交给调用方解析）。
 * 结果可以直接注入 DOM。
 */
export function renderSubmissionReportMarkup(
  markdown: string,
  resources: Readonly<Record<string, GradingResourceInput>>,
  resolveResourceUrl: ReportResourceUrlResolver
): string {
  const markup = marked.parse(markdown, {
    async: false,
    gfm: true,
    renderer: new SafeReportRenderer()
  })
  return markup.replace(RESOURCE_ATTRIBUTE, (match, attribute: string, key: string) => {
    const resource = resources[key]
    if (!resource) return ''
    return `${attribute}="${escapeAttribute(resolveResourceUrl(resource))}"`
  })
}

class SafeReportRenderer extends Renderer {
  override html(token: Tokens.HTML | Tokens.Tag): string {
    return `${escapeHtml(token.text)}\n`
  }

  override link(token: Tokens.Link): string {
    const text = this.parser.parseInline(token.tokens)
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : ''
    return `<a href="${safeUrl(token.href)}"${title} rel="noreferrer" target="_blank">${text}</a>`
  }

  override image(token: Tokens.Image): string {
    const alt = escapeAttribute(token.text)
    const title = token.title ? ` title="${escapeAttribute(token.title)}"` : ''
    const src = safeUrl(token.href, { keepEmpty: true })
    return src === '' ? `<img alt="${alt}"${title}>` : `<img src="${src}" alt="${alt}"${title}>`
  }
}

/** 只放行已知协议；`resource:` 与图片 data URL 例外，其余一律清空。 */
function safeUrl(value: string, options: { keepEmpty?: boolean } = {}): string {
  const url = value.trim()
  if (url === '') return options.keepEmpty ? '' : ''
  if (url.startsWith('resource:') || SAFE_DATA_URL.test(url)) return escapeAttribute(url)
  if (url.startsWith('#') || url.startsWith('/') || url.startsWith('./') || url.startsWith('../')) {
    return escapeAttribute(url)
  }
  try {
    const parsed = new URL(url)
    if (ALLOWED_PROTOCOLS.has(parsed.protocol)) return escapeAttribute(url)
  } catch {
    // 无协议的相对地址按允许处理
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return escapeAttribute(url)
  }
  return ''
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}
