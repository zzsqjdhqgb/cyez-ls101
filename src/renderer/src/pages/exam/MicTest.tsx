/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useEffect, useRef, useState } from 'react'

interface MicTestProps {
  onDeviceSelected: (deviceId: string) => void
  onStartExam: () => void
}

export default function MicTest({ onDeviceSelected, onStartExam }: MicTestProps): JSX.Element {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [recording, setRecording] = useState(false)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [devicesLoaded, setDevicesLoaded] = useState(false)

  const streamRef = useRef<MediaStream | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])

  useEffect(() => {
    loadDevices()
  }, [])

  const loadDevices = async (): Promise<void> => {
    try {
      setErrorMsg(null)
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = allDevices.filter((d) => d.kind === 'audioinput')
      setDevices(audioInputs)
      setDevicesLoaded(true)

      if (audioInputs.length > 0 && !selectedDeviceId) {
        const defaultId = audioInputs.find((d) => d.deviceId === 'default')?.deviceId
          || audioInputs[0]?.deviceId
        if (defaultId) {
          setSelectedDeviceId(defaultId)
          onDeviceSelected(defaultId)
        }
      }
    } catch (err) {
      console.error('获取麦克风设备列表失败:', err)
      setErrorMsg('无法获取麦克风设备列表，请检查权限')
      setDevicesLoaded(true)
    }
  }

  const handleDeviceChange = (deviceId: string): void => {
    setSelectedDeviceId(deviceId)
    onDeviceSelected(deviceId)
    if (recording) {
      stopMedia()
    }
  }

  const stopMedia = (): void => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.onstop = null
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setRecording(false)
  }

  const toggleRecording = async (): Promise<void> => {
    if (recording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      }
      return
    }

    try {
      setErrorMsg(null)
      setRecordedBlob(null)
      chunksRef.current = []

      const constraints: MediaStreamConstraints = {
        audio: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId } }
          : true
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = (e) => chunksRef.current.push(e.data)
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setRecordedBlob(blob)
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        setRecording(false)
      }

      mediaRecorder.start()
      setRecording(true)
    } catch (err) {
      console.error('录音失败:', err)
      setErrorMsg('无法访问麦克风，请检查设备权限')
      setRecording(false)
    }
  }

  const deviceOptions = devices.map((d) => ({
    value: d.deviceId,
    label: d.label || `麦克风 (${d.deviceId.slice(0, 8)}...)`
  }))

  const hasRecording = recordedBlob !== null

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
          width: 480,
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

        {errorMsg && (
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
            {errorMsg}
          </div>
        )}

        {!devicesLoaded ? (
          <div style={{ fontSize: 18, color: '#888', textAlign: 'center' }}>
            正在加载设备列表...
          </div>
        ) : deviceOptions.length === 0 ? (
          <div style={{ fontSize: 18, color: '#e74c3c', textAlign: 'center' }}>
            未检测到麦克风设备
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ fontSize: 18, color: '#ccc' }}>选择麦克风</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => handleDeviceChange(e.target.value)}
                style={{
                  padding: '12px 16px',
                  fontSize: 18,
                  borderRadius: 8,
                  border: '1px solid #555',
                  background: '#1e1e1e',
                  color: '#fff',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                {deviceOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => void toggleRecording()}
                disabled={!selectedDeviceId}
                style={{
                  padding: '12px 32px',
                  fontSize: 18,
                  fontWeight: 600,
                  background: recording ? '#f59e0b' : '#e74c3c',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: selectedDeviceId ? 'pointer' : 'not-allowed',
                  opacity: selectedDeviceId ? 1 : 0.5
                }}
              >
                {recording ? '停止录音' : '开始录音'}
              </button>
            </div>

            {recording && (
              <div
                style={{
                  textAlign: 'center',
                  fontSize: 16,
                  color: '#f59e0b'
                }}
              >
                正在录音...
              </div>
            )}

            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                opacity: hasRecording ? 1 : 0.4,
                pointerEvents: hasRecording ? 'auto' : 'none'
              }}
            >
              <audio
                key={hasRecording ? recordedBlob!.size : 'empty'}
                controls
                style={{ width: '100%', maxWidth: 360 }}
              >
                {hasRecording && (
                  <source src={URL.createObjectURL(recordedBlob!)} type="audio/webm" />
                )}
              </audio>
            </div>
          </>
        )}

        <button
          onClick={onStartExam}
          style={{
            padding: '14px 0',
            fontSize: 20,
            fontWeight: 600,
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            marginTop: 8
          }}
        >
          开始考试
        </button>
      </div>
    </div>
  )
}
