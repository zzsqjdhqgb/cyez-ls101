/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
  eid: string
  rid?: string
}

function preprocessMarkdown(content: string): string {
  return content.replace(/([^\n])\n([^\n])/g, '$1  \n$2')
}

export default function MarkdownRenderer({ content, eid, rid }: Props): JSX.Element {
  const processedContent = useMemo(() => preprocessMarkdown(content), [content])

  const imgComponent = useMemo(
    () =>
      function Img(props: React.ImgHTMLAttributes<HTMLImageElement>): JSX.Element {
        const transparent =
          'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
        const raw = props.src
        const imgStyle = { width: '60%', ...props.style }
        if (!raw) {
          return <img {...props} draggable={false} src={transparent} style={imgStyle} />
        }
        if (
          raw.startsWith('http://') ||
          raw.startsWith('https://') ||
          raw.startsWith('file://') ||
          raw.startsWith('data:')
        ) {
          return <img {...props} draggable={false} style={imgStyle} />
        }
        const prefix = rid ? `grading-resource://${rid}/exam` : `exam-resource://${eid}`
        return <img {...props} draggable={false} src={`${prefix}/${raw}`} style={imgStyle} />
      },
    [eid, rid]
  )

  return (
    <div style={{ fontSize: 16, lineHeight: 1.7, color: '#1e293b' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: imgComponent }}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
