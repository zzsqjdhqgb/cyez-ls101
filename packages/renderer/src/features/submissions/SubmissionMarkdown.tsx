import { useEffect, useMemo, type JSX } from 'react'
import type { GradingResourceInput } from '@ls101/submission-library'
import { renderSubmissionReportMarkup } from './submissionReportMarkup'
import './submissionReport.css'

interface SubmissionMarkdownProps {
  content: string
  resources: Readonly<Record<string, GradingResourceInput>>
  className?: string
  /**
   * 资源引用（`resource:<key>`）的解析方式。
   * 默认生成应用内可直接使用的 blob URL；导出报告时改传 data URL，
   * 两边共用同一段 Markdown → HTML 实现，只有地址不同。
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
  const markup = useMemo(
    () =>
      renderSubmissionReportMarkup(
        content,
        resources,
        (resource) => resourceUrls[resource.resourceKey] ?? ''
      ),
    [content, resourceUrls, resources]
  )

  // markup 来自 submissionReportMarkup：原始 HTML 已转义，地址已按协议白名单过滤。
  return (
    <div
      className={['submissionReport', className].filter(Boolean).join(' ')}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
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
