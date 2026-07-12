/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, RefreshCw } from 'lucide-react'

interface MicTestProps {
  onComplete: (deviceId: string) => void
  onBack: () => void
}

type RecordingState = 'idle' | 'recording' | 'done'

export default function MicTest({ onComplete, onBack }: MicTestProps): JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingDevices, setLoadingDevices] = useState(true)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<BlobPart[]>([])

  const cleanStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.onstop = null
        mediaRecorderRef.current.stop()
      }
      mediaRecorderRef.current = null
    }
  }, [])

  const clearAudioUrl = useCallback(() => {
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
  }, [audioUrl])

  useEffect(() => {
    ;(async () => {
      try {
        setLoadingDevices(true)
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach((track) => track.stop())

        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = allDevices.filter((d) => d.kind === 'audioinput' && d.deviceId)
        setDevices(audioInputs)
        if (audioInputs.length > 0) {
          setSelectedDeviceId((prev) => prev || audioInputs[0].deviceId)
        }
      } catch (err) {
        console.error('获取音频设备失败:', err)
        setError('无法获取音频输入设备，请检查麦克风是否连接')
      } finally {
        setLoadingDevices(false)
      }
    })()

    return () => {
      cleanStream()
    }
  }, [cleanStream])

  const startRecording = useCallback(async () => {
    setError(null)
    chunksRef.current = []
    clearAudioUrl()

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => {
        chunksRef.current.push(e.data)
      }

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const url = URL.createObjectURL(blob)
        setAudioUrl(url)
        cleanStream()
        setRecordingState('done')
      }

      mediaRecorder.start()
      setRecordingState('recording')
    } catch (err) {
      console.error('开始录音失败:', err)
      setError('无法访问麦克风，请确保已授权麦克风权限')
    }
  }, [selectedDeviceId, clearAudioUrl, cleanStream])

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  const handleRecordClick = useCallback(() => {
    if (recordingState === 'recording') {
      stopRecording()
    } else {
      startRecording()
    }
  }, [recordingState, stopRecording, startRecording])

  const handleReRecord = useCallback(() => {
    setRecordingState('idle')
    startRecording()
  }, [startRecording])

  if (loadingDevices) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <div style={{ fontSize: 28, color: '#888' }}>正在检测音频设备...</div>
      </div>
    )
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <div
        style={{
          width: 420,
          background: '#2c2c2c',
          borderRadius: 16,
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: '#fff',
            textAlign: 'center',
            margin: 0
          }}
        >
          麦克风测试
        </h2>

        {error && (
          <div
            style={{
              background: '#e74c3c',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 16,
              textAlign: 'center'
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 18, color: '#ccc' }}>录音设备</label>
          {devices.length === 0 ? (
            <div
              style={{
                padding: '12px 16px',
                fontSize: 16,
                borderRadius: 8,
                border: '1px solid #555',
                background: '#1e1e1e',
                color: '#888'
              }}
            >
              未检测到音频输入设备
            </div>
          ) : (
            <select
              value={selectedDeviceId}
              onChange={(e) => setSelectedDeviceId(e.target.value)}
              disabled={recordingState === 'recording'}
              style={{
                padding: '12px 16px',
                fontSize: 16,
                borderRadius: 8,
                border: '1px solid #555',
                background: '#1e1e1e',
                color: '#fff',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `麦克风 ${d.deviceId.slice(0, 8)}`}
                </option>
              ))}
            </select>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16
          }}
        >
          {recordingState === 'done' ? (
            <button
              type="button"
              onClick={handleReRecord}
              disabled={devices.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                fontSize: 18,
                fontWeight: 600,
                background: '#f59e0b',
                color: '#1e1e1e',
                border: 'none',
                borderRadius: 8,
                cursor: devices.length === 0 ? 'not-allowed' : 'pointer',
                opacity: devices.length === 0 ? 0.5 : 1
              }}
            >
              <RefreshCw size={20} />
              重新录音
            </button>
          ) : (
            <button
              type="button"
              onClick={handleRecordClick}
              disabled={devices.length === 0}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 24px',
                fontSize: 18,
                fontWeight: 600,
                background: recordingState === 'recording' ? '#e74c3c' : '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                cursor: devices.length === 0 ? 'not-allowed' : 'pointer',
                opacity: devices.length === 0 ? 0.5 : 1
              }}
            >
              {recordingState === 'recording' ? (
                <>
                  <MicOff size={20} />
                  停止录音
                </>
              ) : (
                <>
                  <Mic size={20} />
                  开始录音
                </>
              )}
            </button>
          )}
        </div>

        {recordingState === 'recording' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                background: '#e74c3c',
                animation: 'pulse 1s infinite'
              }}
            />
            <span style={{ fontSize: 16, color: '#e74c3c' }}>录音中...</span>
          </div>
        )}

        {recordingState === 'done' && audioUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 18, color: '#ccc' }}>录音回放</label>
            <audio
              controls
              src={audioUrl}
              style={{
                width: '100%',
                height: 40,
                borderRadius: 8,
                outline: 'none'
              }}
            />
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            marginTop: 8
          }}
        >
          <button
            type="button"
            onClick={() => onComplete(selectedDeviceId)}
            disabled={recordingState !== 'done'}
            style={{
              padding: '14px 0',
              fontSize: 20,
              fontWeight: 600,
              background: recordingState === 'done' ? '#16a34a' : '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: recordingState === 'done' ? 'pointer' : 'not-allowed',
              opacity: recordingState === 'done' ? 1 : 0.5
            }}
          >
            开始考试
          </button>

          <button
            type="button"
            onClick={onBack}
            style={{
              background: 'transparent',
              color: '#888',
              border: 'none',
              fontSize: 16,
              cursor: 'pointer',
              textDecoration: 'underline'
            }}
          >
            返回主页
          </button>
        </div>
      </div>
    </div>
  )
}
