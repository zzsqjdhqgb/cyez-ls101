import { marked, Renderer, type Tokens } from 'marked'

/** 报告 Markdown 里的资源引用；与 submission-library 的写法保持一致。 */
const RESOURCE_ATTRIBUTE = /(src|href)="resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)"/g
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:'])
const SAFE_DATA_URL = /^data:image\//i

/** 报告正文中可被解析成 URL 的静态资源最小结构（GradingResourceInput 的结构子集）。 */
export interface ReportResource {
  resourceKey: string
  mediaType?: string
  data: Uint8Array
}

export type ReportResourceUrlResolver = (resource: ReportResource) => string

/**
 * 报告 Markdown → 可注入 DOM 的 HTML，机房端（学生端本地报告）与
 * packages/renderer 的 submissionReportMarkup 保持同一套安全规则：
 * 原始 HTML 一律转义成文本，链接与图片地址只放行已知协议
 * （`resource:` 交给调用方解析），因此两处实现必须同步修改。
 */
export function renderSafeReportMarkup(
  markdown: string,
  resources: Readonly<Record<string, ReportResource>>,
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
    const src = safeUrl(token.href)
    return src === '' ? `<img alt="${alt}"${title}>` : `<img src="${src}" alt="${alt}"${title}>`
  }
}

/** 只放行已知协议；`resource:` 与图片 data URL 例外，其余一律清空。 */
function safeUrl(value: string): string {
  const url = value.trim()
  if (url === '') return ''
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
