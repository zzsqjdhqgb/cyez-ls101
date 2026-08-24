/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useCallback, useState } from 'react'
import { speechToText } from '../../utils/speechToText'

const styles: Record<string, React.CSSProperties> = {
  noAudioPlaceholder: {
    padding: '16px',
    background: '#f1f5f9',
    borderRadius: 8,
    textAlign: 'center',
    color: '#94a3b8',
    fontSize: 14
  },
  sttContainer: {
    padding: '12px 14px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#ffffff'
  },
  sttHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8
  },
  sttTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: '#475569'
  },
  sttBtn: {
    fontSize: 12,
    padding: '4px 12px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  sttBtnDisabled: {
    fontSize: 12,
    padding: '4px 12px',
    background: '#94a3b8',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'default',
    fontWeight: 500
  },
  sttText: {
    minHeight: 40,
    maxHeight: 120,
    overflowY: 'auto',
    padding: '8px 10px',
    fontSize: 13,
    lineHeight: 1.6,
    borderRadius: 6,
    background: '#f8fafc',
    color: '#334155',
    whiteSpace: 'pre-wrap'
  },
  sttPlaceholder: {
    minHeight: 40,
    padding: '8px 10px',
    fontSize: 13,
    borderRadius: 6,
    background: '#f8fafc',
    color: '#94a3b8',
    fontStyle: 'italic'
  },
  textarea: {
    width: '100%',
    minHeight: 72,
    resize: 'vertical',
    padding: '10px 14px',
    fontSize: 14,
    borderRadius: 8,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#1e293b',
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box'
  },
  recordGroup: {
    padding: '12px',
    borderRadius: 8,
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    marginBottom: 12
  },
  recordLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: '#94a3b8',
    marginBottom: 8
  }
}

interface GradingRightPanelProps {
  recordIndices: number[]
  audioUrls: string[]
  rid: string
  comment: string
  onCommentChange: (value: string) => void
}

function RecordAudioPlayer({
  audioUrl,
  rid,
  recordIndex
}: {
  audioUrl: string
  rid: string
  recordIndex: number
}): JSX.Element {
  const [sttText, setSttText] = useState('')
  const [sttLoading, setSttLoading] = useState(false)
  const [sttError, setSttError] = useState<string | null>(null)

  const handleTranscribe = useCallback(async () => {
    setSttLoading(true)
    setSttError(null)
    try {
      const text = await speechToText(rid, recordIndex)
      setSttText(text)
    } catch (err: unknown) {
      setSttError(err instanceof Error ? err.message : String(err))
    } finally {
      setSttLoading(false)
    }
  }, [rid, recordIndex])

  return (
    <div style={styles.recordGroup}>
      <div style={styles.recordLabel}>录音 {recordIndex}</div>
      {audioUrl ? (
        <audio
          controls
          src={audioUrl}
          style={{ width: '100%', outline: 'none', borderRadius: 8 }}
        />
      ) : (
        <div style={styles.noAudioPlaceholder}>无录音</div>
      )}

      {audioUrl && (
        <div style={{ ...styles.sttContainer, marginTop: 8 }}>
          <div style={styles.sttHeader}>
            <span style={styles.sttTitle}>语音转文本</span>
            <button
              onClick={handleTranscribe}
              disabled={sttLoading}
              style={sttLoading ? styles.sttBtnDisabled : styles.sttBtn}
            >
              {sttLoading ? '转写中...' : '转写'}
            </button>
          </div>
          {sttText ? (
            <div style={styles.sttText}>{sttText}</div>
          ) : sttError ? (
            <div style={{ ...styles.sttPlaceholder, color: '#dc2626' }}>{sttError}</div>
          ) : (
            <div style={styles.sttPlaceholder}>
              {sttLoading ? '正在识别语音...' : '点击"转写"按钮获取语音文本'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function GradingRightPanel({
  recordIndices,
  audioUrls,
  rid,
  comment,
  onCommentChange
}: GradingRightPanelProps): JSX.Element {
  return (
    <>
      {recordIndices.map((ri, idx) => (
        <RecordAudioPlayer key={ri} audioUrl={audioUrls[idx] || ''} rid={rid} recordIndex={ri} />
      ))}

      <textarea
        value={comment}
        onChange={(e) => onCommentChange(e.target.value)}
        placeholder="教师评语（可选）"
        rows={3}
        style={styles.textarea}
      />
    </>
  )
}
