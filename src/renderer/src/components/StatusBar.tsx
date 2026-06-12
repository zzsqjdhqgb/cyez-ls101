/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'
import type { Question } from '../types'

interface Props {
  question: Question | null
  countdown: number
  recordingProgress: number
  recordingTimeLeft: number
  examFinished: boolean
  statusText?: string
}

export default function StatusBar({
  question,
  countdown,
  recordingProgress,
  recordingTimeLeft,
  examFinished,
  statusText
}: Props): JSX.Element {
  if (examFinished) {
    return <div style={{ width: '100%', textAlign: 'center', fontSize: 24 }}>考试完成</div>
  }

  if (!question) {
    return <div style={{ width: '100%', textAlign: 'center', fontSize: 24 }}>Idle</div>
  }

  // ---- 倒计时题型 ----
  if (question.time.type === 'countdown') {
    return (
      <div
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16
        }}
      >
        {statusText && <span style={{ fontSize: 24 }}>{statusText}</span>}
        <span style={{ fontSize: 28, color: '#ffcc00' }}>⏱️ {countdown}s</span>
      </div>
    )
  }

  // ---- 录音题型 ----
  if (question.time.type === 'record') {
    return (
      <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 16 }}>
        {statusText && <span style={{ fontSize: 24, minWidth: 100 }}>{statusText}</span>}
        <div
          style={{ flex: 1, height: 8, background: '#555', borderRadius: 4, overflow: 'hidden' }}
        >
          <div
            style={{
              height: '100%',
              width: `${recordingProgress}%`,
              background: '#e74c3c',
              transition: 'width 0.1s linear'
            }}
          />
        </div>
        <span
          style={{
            fontWeight: 'bold',
            color: '#e74c3c',
            minWidth: 80,
            textAlign: 'right',
            fontSize: 24
          }}
        >
          🔴 {recordingTimeLeft}s
        </span>
      </div>
    )
  }

  // ---- 内容控制题型 ----
  return (
    <div style={{ width: '100%', textAlign: 'center', fontSize: 24 }}>
      {statusText || '播放中...'}
    </div>
  )
}
