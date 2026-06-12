/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import DisplayArea from '../components/DisplayArea'
import StatusBar from '../components/StatusBar'
import type { ExamPackage, Question, StudentInfo } from '../types'
import { MessageModal } from '../components/Modal'
import useScalingRatio, { DESIGN_WIDTH, DESIGN_HEIGHT } from './exam/useScaling'
import StudentForm from './exam/StudentForm'

type Phase = 'input' | 'exam' | 'finished' | 'error'

/**
 * 播放一个短音频，返回一个 Promise，在播放结束后 resolve。
 * 若播放失败则直接 resolve，避免阻塞流程。
 */
function playShortAudio(src: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      console.log(`[playShortAudio] 尝试播放: ${src}`)
      const audio = new Audio(src)
      audio.addEventListener(
        'ended',
        () => {
          resolve()
        },
        { once: true }
      )
      audio.addEventListener(
        'error',
        () => {
          resolve()
        },
        { once: true }
      )
      audio.play().catch(() => {
        resolve()
      })
    } catch {
      resolve()
    }
  })
}

export default function ExamPage(): JSX.Element {
  const { examId } = useParams<{ examId: string }>()
  const navigate = useNavigate()

  const [questions, setQuestions] = useState<Question[]>([])
  const [currentIndex, setCurrentIndex] = useState(-1)
  const [phase, setPhase] = useState<Phase>('input')
  const [countdown, setCountdown] = useState(0)
  const [recordingTimeLeft, setRecordingTimeLeft] = useState(0)
  const [recordingProgress, setRecordingProgress] = useState(0)
  const [loading, setLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [studentName, setStudentName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [submissionId, setSubmissionId] = useState<string | null>(null)

  const [mediaError, setMediaError] = useState<string | null>(null)

  const [formError, setFormError] = useState<string | null>(null)
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const scale = useScalingRatio()

  const [devMode, setDevMode] = useState(() => sessionStorage.getItem('devMode') === 'true')

  useEffect(() => {
    window.electronAPI.dev
      .isDev()
      .then((isDev) => {
        if (isDev && sessionStorage.getItem('devMode') === null) {
          sessionStorage.setItem('devMode', 'true')
          window.dispatchEvent(new Event('storage'))
        }
        setDevMode(sessionStorage.getItem('devMode') === 'true')
      })
      .catch(() => setDevMode(sessionStorage.getItem('devMode') === 'true'))
    const onStorage = (): void => setDevMode(sessionStorage.getItem('devMode') === 'true')
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // 加载考试
  useEffect(() => {
    if (!examId) return

    window.electronAPI.exam
      .load(examId)
      .then((pkg: ExamPackage) => {
        setQuestions(pkg.questions)
        setCurrentIndex(0)
        setPhase('input')
      })
      .catch((err) => {
        console.error('加载考试失败:', err)
        setErrorMsg(String(err))
        setPhase('error')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [examId])

  // 清理所有定时器和 MediaRecorder
  const clearTimers = useCallback((stopRecording?: boolean) => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state === 'recording' &&
      stopRecording
    ) {
      mediaRecorderRef.current.onstop = null // 防止重复触发
      mediaRecorderRef.current.stop()
      mediaRecorderRef.current = null
    }
    // 关闭麦克风流
    if (streamRef.current && stopRecording) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [])

  // 停止录音（用于定时器超时自动停止）
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  // 跳转到下一题
  const nextQuestion = useCallback(() => {
    clearTimers(true)
    setMediaError(null)
    setRecordingTimeLeft(0)
    setRecordingProgress(0)
    setCurrentIndex((prev) => {
      const next = prev + 1
      if (next >= questions.length) {
        setPhase('finished')
        return prev
      }
      return next
    })
  }, [clearTimers, questions.length])

  // 开始录音（使用已获取的 MediaStream）
  const startRecordingWithStream = useCallback(
    (stream: MediaStream, duration: number, recordIndex?: number) => {
      streamRef.current = stream
      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder

      const chunks: BlobPart[] = []
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data)
      mediaRecorder.onstop = async () => {
        // 保存录音数据
        const blob = new Blob(chunks, { type: 'audio/webm' })
        const buffer = await blob.arrayBuffer()
        if (recordIndex !== undefined && submissionId) {
          await window.electronAPI.submission
            .saveRecord(submissionId, recordIndex, buffer)
            .catch(console.error)
        }
        // 关闭麦克风流
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        setRecordingTimeLeft(0)

        // 播放"停止录音"提示音，然后跳转下一题
        await playShortAudio('app-resource://stop_record.mp3')
        nextQuestion()
      }

      mediaRecorder.start()
      setRecordingTimeLeft(duration)
      setRecordingProgress(0)

      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      const startTime = Date.now()
      timerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const left = Math.max(0, Math.ceil(duration - elapsed))
        const progress = Math.min(100, (elapsed / duration) * 100)
        setRecordingTimeLeft(left)
        setRecordingProgress(progress)
        if (elapsed >= duration) {
          clearTimers()
          setTimeout(() => stopRecording(), 100)
        }
      }, 100)
    },
    [clearTimers, stopRecording, nextQuestion, submissionId]
  )

  // 处理题目切换
  useEffect(() => {
    if (phase !== 'exam') return
    if (currentIndex < 0 || currentIndex >= questions.length) return

    const question = questions[currentIndex]
    clearTimers()

    if (question.time.type === 'countdown') {
      const seconds = question.time.seconds
      let remaining = seconds
      queueMicrotask(() => setCountdown(remaining))
      timerRef.current = setInterval(() => {
        remaining--
        setCountdown(remaining)
        if (remaining <= 0) {
          clearTimers()
          nextQuestion()
        }
      }, 1000)
    } else if (question.time.type === 'record') {
      const { duration, recordIndex } = question.time

      // 步骤：先加载麦克风 → 播放"准备录音"音频 → 开始录音
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          return playShortAudio('app-resource://ready_record.mp3').then(() => stream)
        })
        .then((stream) => {
          startRecordingWithStream(stream, duration, recordIndex)
        })
        .catch((err) => {
          console.error('无法获取麦克风或播放提示音失败:', err)
          // 如果连麦克风都获取不到，直接跳过本题
          nextQuestion()
        })
    }
  }, [currentIndex, questions, clearTimers, nextQuestion, startRecordingWithStream, phase])

  const handleMediaError = useCallback(
    (msg: string) => {
      console.log('[ExamPage] 收到媒体错误:', msg)
      setMediaError(msg)
      clearTimers()
    },
    [clearTimers]
  )

  const handleMediaEnded = useCallback(() => {
    if (phase === 'exam' && !mediaError) {
      nextQuestion()
    }
  }, [phase, mediaError, nextQuestion])

  const handleBack = useCallback(() => {
    clearTimers()
    navigate('/')
  }, [clearTimers, navigate])

  const handleStartExam = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const trimmedName = studentName.trim()
    const trimmedId = studentId.trim()

    setFormError(null)

    if (!trimmedName) {
      setFormError('请输入姓名')
      return
    }

    if (!/^\d{6}$/.test(trimmedId)) {
      setFormError('学号必须是6位数字')
      return
    }

    if (!examId) return

    const student: StudentInfo = { name: trimmedName, studentId: trimmedId }
    try {
      const subId = await window.electronAPI.submission.create(examId, student)
      setSubmissionId(subId)
      setPhase('exam')
    } catch (err) {
      console.error('创建提交失败:', err)
      setMsgModal({ title: '操作失败', message: '创建作答记录失败', type: 'error' })
    }
  }

  const renderContent = (): JSX.Element => {
    if (loading) {
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
          <div style={{ fontSize: 28, color: '#888' }}>加载中...</div>
        </div>
      )
    }

    if (phase === 'error') {
      return (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 20
          }}
        >
          <div style={{ fontSize: 28, color: '#e74c3c' }}>加载失败：{errorMsg}</div>
          <button
            onClick={handleBack}
            style={{ fontSize: 20, padding: '10px 20px', cursor: 'pointer' }}
          >
            返回主页
          </button>
        </div>
      )
    }

    if (phase === 'finished') {
      return (
        <div style={{ textAlign: 'center' }}>
          <p style={{ fontSize: 40 }}>考试完成</p>
          <p style={{ fontSize: 24, color: '#aaa', marginTop: 16 }}>作答已自动保存</p>
          <div style={{ display: 'flex', gap: 16, justifyContent: 'center', marginTop: 32 }}>
            <button
              onClick={() => navigate('/')}
              style={{
                fontSize: 22,
                padding: '10px 24px',
                cursor: 'pointer',
                background: '#555',
                color: '#fff',
                border: 'none',
                borderRadius: 8
              }}
            >
              返回主页
            </button>
            <button
              onClick={() => navigate('/recordings')}
              style={{
                fontSize: 22,
                padding: '10px 24px',
                cursor: 'pointer',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 8
              }}
            >
              查看作答
            </button>
          </div>
        </div>
      )
    }

    if (phase === 'input') {
      return (
        <StudentForm
          studentName={studentName}
          studentId={studentId}
          formError={formError}
          onNameChange={setStudentName}
          onIdChange={setStudentId}
          onSubmit={handleStartExam}
          onBack={handleBack}
        />
      )
    }

    // phase === 'exam'
    const currentQuestion =
      currentIndex >= 0 && currentIndex < questions.length ? questions[currentIndex] : null

    if (mediaError && phase === 'exam') {
      return (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <p style={{ fontSize: 32, color: '#e74c3c' }}>媒体加载失败</p>
          <p style={{ fontSize: 20, color: '#aaa', marginTop: 12 }}>{mediaError}</p>
          <button
            onClick={() => {
              setMediaError(null)
              nextQuestion()
            }}
            style={{
              marginTop: 24,
              fontSize: 22,
              padding: '10px 20px',
              background: '#555',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            跳过本题
          </button>
        </div>
      )
    }

    return (
      <>
        {devMode && currentQuestion && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 10,
                left: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                zIndex: 10
              }}
            >
              <span style={{ fontSize: 24, color: '#aaa' }}>
                {currentIndex + 1} / {questions.length}
              </span>
              <button
                onClick={handleBack}
                style={{
                  fontSize: 20,
                  padding: '5px 15px',
                  background: '#555',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer'
                }}
              >
                返回
              </button>
            </div>
            <button
              onClick={nextQuestion}
              style={{
                position: 'absolute',
                top: 10,
                right: 10,
                fontSize: 20,
                padding: '5px 15px',
                background: '#e74c3c',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                zIndex: 10
              }}
            >
              跳过
            </button>
          </>
        )}

        {currentQuestion ? (
          <DisplayArea
            question={currentQuestion}
            onMediaEnded={handleMediaEnded}
            onMediaError={handleMediaError}
          />
        ) : (
          <div style={{ fontSize: 40, color: '#888' }}>等待...</div>
        )}
      </>
    )
  }

  const currentQuestion =
    currentIndex >= 0 && currentIndex < questions.length ? questions[currentIndex] : null

  return (
    <div
      style={
        {
          width: '100vw',
          height: '100vh',
          overflow: 'hidden',
          background: '#000',
          position: 'relative',
          userSelect: 'none',
          ['WebkitUserDrag' as string]: 'none'
        } as React.CSSProperties
      }
    >
      <div
        style={{
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          display: 'flex',
          flexDirection: 'column',
          background: '#1e1e1e',
          color: '#fff'
        }}
      >
        <main
          style={{
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            padding: '40px'
          }}
        >
          {renderContent()}
        </main>

        {phase === 'exam' && !mediaError && (
          <footer
            style={{
              height: 50,
              background: '#2d2d2d',
              display: 'flex',
              alignItems: 'center',
              padding: '0 20px'
            }}
          >
            <StatusBar
              key={currentQuestion?.id || 'idle'}
              question={currentQuestion}
              countdown={countdown}
              recordingProgress={recordingProgress}
              recordingTimeLeft={recordingTimeLeft}
              examFinished={false}
              statusText={currentQuestion?.statusText}
            />
          </footer>
        )}
      </div>
      {msgModal && (
        <MessageModal
          isOpen={true}
          title={msgModal.title}
          message={msgModal.message}
          type={msgModal.type}
          onClose={() => setMsgModal(null)}
          closeLabel="确定"
        />
      )}
    </div>
  )
}
