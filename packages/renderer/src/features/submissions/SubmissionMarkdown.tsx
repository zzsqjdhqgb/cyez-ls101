import {
  useEffect,
  useMemo,
  type AnchorHTMLAttributes,
  type ImgHTMLAttributes,
  type JSX
} from 'react'
import type { GradingResourceInput } from '@ls101/submission-library'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './submissionReport.css'

/** react-markdown 会把 hast 节点一并传给自定义组件，不能透传到 DOM。 */
type MarkdownNodeProps = { node?: unknown }
type MarkdownImageProps = ImgHTMLAttributes<HTMLImageElement> & MarkdownNodeProps
type MarkdownLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & MarkdownNodeProps

/** `resource:<key>` 不在默认 URL 白名单里，必须先放行再交给组件解析。 */
function resourceSafeUrlTransform(url: string): string {
  return url.startsWith('resource:') ? url : defaultUrlTransform(url)
}

interface SubmissionMarkdownProps {
  content: string
  resources: Readonly<Record<string, GradingResourceInput>>
  className?: string
  /**
   * 资源引用（`resource:<key>`）的解析方式。
   * 默认生成应用内可直接使用的 blob URL；导出报告时改传 data URL 工厂，
   * 这样静态渲染出来的 HTML 与屏幕上看到的结构完全一致。
   */
  resourceUrl?: (resource: GradingResourceInput) => string
}

export function SubmissionMarkdown({
  content,
  resources,
  className,
  resourceUrl
}: SubmissionMarkdownProps): JSX.Element {
  const resourceUrls = useResourceUrls(resources, resourceUrl)

  const Image = ({ node, src, alt, ...props }: MarkdownImageProps): JSX.Element => {
    void node
    return (
      <img
        {...props}
        alt={alt ?? ''}
        draggable={false}
        src={resolveResourceUrl(src, resourceUrls)}
      />
    )
  }
  const Link = ({ node, href, ...props }: MarkdownLinkProps): JSX.Element => {
    void node
    return (
      <a
        {...props}
        draggable={false}
        href={resolveResourceUrl(href, resourceUrls)}
        rel="noreferrer"
        target="_blank"
      />
    )
  }

  return (
    <div className={['submissionReport', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        components={{ a: Link, img: Image }}
        remarkPlugins={[remarkGfm]}
        urlTransform={resourceSafeUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function useResourceUrls(
  resources: Readonly<Record<string, GradingResourceInput>>,
  resolve?: (resource: GradingResourceInput) => string
): Readonly<Record<string, string>> {
  const urls = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(resources).map(([key, resource]) => [
          key,
          resolve
            ? resolve(resource)
            : URL.createObjectURL(
                new Blob([new Uint8Array(resource.data)], {
                  type: resource.mediaType || 'application/octet-stream'
                })
              )
        ])
      ),
    [resources, resolve]
  )

  useEffect(() => {
    if (resolve) return
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
  }, [resolve, urls])

  return urls
}

function resolveResourceUrl(
  value: string | undefined,
  urls: Readonly<Record<string, string>>
): string | undefined {
  if (!value?.startsWith('resource:')) return value
  return urls[value.slice('resource:'.length)]
}
