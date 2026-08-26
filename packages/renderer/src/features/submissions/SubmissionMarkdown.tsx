import {
  useEffect,
  useMemo,
  type AnchorHTMLAttributes,
  type ImgHTMLAttributes,
  type JSX
} from 'react'
import type { GradingResourceInput } from '@ls101/submission-library'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import styles from './SubmissionMarkdown.module.css'

interface SubmissionMarkdownProps {
  content: string
  resources: Readonly<Record<string, GradingResourceInput>>
  className?: string
}

export function SubmissionMarkdown({
  content,
  resources,
  className
}: SubmissionMarkdownProps): JSX.Element {
  const resourceUrls = useResourceUrls(resources)

  const Image = (props: ImgHTMLAttributes<HTMLImageElement>): JSX.Element => {
    const src = resolveResourceUrl(props.src, resourceUrls)
    return <img {...props} alt={props.alt ?? ''} draggable={false} src={src} />
  }
  const Link = (props: AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element => {
    const href = resolveResourceUrl(props.href, resourceUrls)
    return <a {...props} draggable={false} href={href} rel="noreferrer" target="_blank" />
  }

  return (
    <div className={[styles.markdown, className].filter(Boolean).join(' ')}>
      <ReactMarkdown components={{ a: Link, img: Image }} remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

function useResourceUrls(
  resources: Readonly<Record<string, GradingResourceInput>>
): Readonly<Record<string, string>> {
  const urls = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(resources).map(([key, resource]) => [
          key,
          URL.createObjectURL(
            new Blob([new Uint8Array(resource.data)], {
              type: resource.mediaType || 'application/octet-stream'
            })
          )
        ])
      ),
    [resources]
  )

  useEffect(() => () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url)), [urls])

  return urls
}

function resolveResourceUrl(
  value: string | undefined,
  urls: Readonly<Record<string, string>>
): string | undefined {
  if (!value?.startsWith('resource:')) return value
  return urls[value.slice('resource:'.length)]
}
