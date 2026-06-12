/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'
import type { Question, ContentNode } from '../types'

interface Props {
  question: Question
  onMediaEnded: () => void
  onMediaError?: (errorMessage: string) => void
}

function renderNode(
  node: ContentNode,
  key: string,
  onMediaEnded: () => void,
  onMediaError?: (msg: string) => void
): JSX.Element {
  // 统一日志辅助，避免使用 any 类型
  const logEvent = (mediaType: string, event: string, extra?: unknown): void => {
    const src = 'src' in node && typeof node.src === 'string' ? node.src : 'unknown'
    console.log(
      `[${mediaType}] ${new Date().toISOString()} | event: ${event} | src: ${src}`,
      extra !== undefined ? extra : ''
    )
  }

  switch (node.type) {
    case 'text': {
      const style: React.CSSProperties = {
        fontSize: node.size === 'large' ? 40 : node.size === 'small' ? 24 : 32,
        fontWeight: node.bold ? 'bold' : 'normal',
        textAlign: 'justify',
        margin: '10px 0'
      }
      return (
        <div key={key} style={style}>
          {node.text.split('\n').map((line, i, arr) =>
            i < arr.length - 1 ? (
              <span key={i}>
                {line}
                <br />
              </span>
            ) : (
              line
            )
          )}
        </div>
      )
    }
    case 'image':
      return (
        <img
          key={key}
          src={node.src}
          draggable={false}
          style={{
            width: node.width || '80%',
            display: 'block',
            maxHeight: '80%',
            objectFit: 'contain',
            margin: '10px auto'
          }}
          alt=""
        />
      )
    case 'video':
      return (
        <video
          key={key}
          src={node.src}
          controls
          autoPlay
          style={{ maxWidth: '100%', maxHeight: '100%' }}
          onLoadStart={() => logEvent('video', 'loadstart')}
          onLoadedMetadata={(e) => {
            const dur = (e.currentTarget as HTMLVideoElement).duration
            logEvent('video', 'loadedmetadata', { duration: dur })
            if (isNaN(dur) || dur <= 0) {
              const msg = `视频无效 (时长为0): ${node.src}`
              console.error(msg)
              onMediaError?.(msg)
            }
          }}
          onCanPlay={() => logEvent('video', 'canplay')}
          onCanPlayThrough={() => logEvent('video', 'canplaythrough')}
          onPlay={() => logEvent('video', 'play')}
          onPlaying={() => logEvent('video', 'playing')}
          onEnded={() => {
            logEvent('video', 'ended → 准备跳转下一题')
            onMediaEnded()
          }}
          onError={(e) => {
            const target = e.currentTarget
            const err = target.error
            logEvent('video', 'error', { code: err?.code, message: err?.message })
            const msg = `视频加载失败 (${err?.code ?? 'unknown'}): ${node.src}`
            onMediaError?.(msg)
          }}
          onSuspend={() => logEvent('video', 'suspend')}
          onStalled={() => logEvent('video', 'stalled')}
          onWaiting={() => logEvent('video', 'waiting')}
          onSeeked={() => logEvent('video', 'seeked')}
        />
      )

    case 'audio':
      return (
        <audio
          key={key}
          src={node.src}
          autoPlay
          style={{ display: 'none' }}
          onLoadStart={() => logEvent('audio', 'loadstart')}
          onLoadedMetadata={(e) => {
            const dur = (e.currentTarget as HTMLAudioElement).duration
            logEvent('audio', 'loadedmetadata', { duration: dur })
            if (isNaN(dur) || dur <= 0) {
              const msg = `音频无效 (时长为0): ${node.src}`
              console.error(msg)
              onMediaError?.(msg)
            }
          }}
          onCanPlay={() => logEvent('audio', 'canplay')}
          onCanPlayThrough={() => logEvent('audio', 'canplaythrough')}
          onPlay={() => logEvent('audio', 'play')}
          onPlaying={() => logEvent('audio', 'playing')}
          onEnded={() => {
            logEvent('audio', 'ended → 准备跳转下一题')
            onMediaEnded()
          }}
          onError={(e) => {
            const target = e.currentTarget
            const err = target.error
            logEvent('audio', 'error', { code: err?.code, message: err?.message })
            const msg = `音频加载失败 (${err?.code ?? 'unknown'}): ${node.src}`
            onMediaError?.(msg)
          }}
          onSuspend={() => logEvent('audio', 'suspend')}
          onStalled={() => logEvent('audio', 'stalled')}
          onWaiting={() => logEvent('audio', 'waiting')}
          onSeeked={() => logEvent('audio', 'seeked')}
        />
      )

    case 'quad-image':
      return (
        <div
          key={key}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '20px',
            width: node.width || '80%',
            maxWidth: '100%',
            margin: '20px auto'
          }}
        >
          {node.images.map((src, idx) => (
            <img
              key={idx}
              src={src}
              draggable={false}
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: '300px',
                objectFit: 'contain',
                display: 'block',
                borderRadius: '4px'
              }}
              alt=""
            />
          ))}
        </div>
      )
    default:
      return <span key={key}>未知内容</span>
  }
}

export default function DisplayArea({ question, onMediaEnded, onMediaError }: Props): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: '20px'
      }}
    >
      {question.content.map((node, index) =>
        renderNode(node, `${question.id}-${index}`, onMediaEnded, onMediaError)
      )}
    </div>
  )
}
