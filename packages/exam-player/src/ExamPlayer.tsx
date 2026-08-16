import { useCallback, useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import type {
  ChoiceOptionLabel,
  ExamPage,
  ResolvedTimelineStep,
  SubmissionCandidate
} from '@ls101/core-types'
import { collectSubmissionPackageFiles, encodeSubmissionPackage } from '@ls101/exam-package'
import {
  AlertTriangle,
  Check,
  LogOut,
  Mic,
  Play,
  RefreshCw,
  RotateCcw,
  Volume2
} from 'lucide-react'
import { assembleSubmission, type CapturedAudioAnswer } from './submission'
import { ExamPageView } from './ExamPageView'
import { loadExam, resourceKey, type LoadedExam } from './loading'
import styles from './ExamPlayer.module.css'

const DESIGN_WIDTH = 1200
const DESIGN_HEIGHT = 800
const SUBMISSION_MEDIA_TYPE = 'application/x-ls101-submission'

type Phase =
  | 'loading'
  | 'load-error'
  | 'candidate'
  | 'microphone'
  | 'exam'
  | 'runtime-error'
  | 'submitting'
  | 'complete'

interface RuntimeFailure {
  error: Error
  retry: 'step' | 'submission'
}

interface TimelineStatus {
  kind: 'play' | 'countdown' | 'record'
  label: string
  remainingSeconds?: number
  progress?: number
}

export interface ExamPlayerProps {
  examBaseUrl: string
  fetcher?: typeof fetch
  allowExit?: boolean
  recordingCueUrls?: { start?: string; stop?: string }
  onFinish(archive: Blob): void | Promise<void>
  onExit(): void
  onError?(error: Error): void
}

export function ExamPlayer({ examBaseUrl, ...props }: ExamPlayerProps): JSX.Element {
  return <ExamPlayerSession key={examBaseUrl} examBaseUrl={examBaseUrl} {...props} />
}

function ExamPlayerSession({
  examBaseUrl,
  fetcher = fetch,
  allowExit = true,
  recordingCueUrls,
  onFinish,
  onExit,
  onError
}: ExamPlayerProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('loading')
  const [loaded, setLoaded] = useState<LoadedExam | null>(null)
  const [loadError, setLoadError] = useState<Error | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [candidateName, setCandidateName] = useState('')
  const [candidateId, setCandidateId] = useState('')
  const [candidateError, setCandidateError] = useState<string | null>(null)
  const [microphoneId, setMicrophoneId] = useState('')
  const [pageIndex, setPageIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [retryToken, setRetryToken] = useState(0)
  const [timelineStatus, setTimelineStatus] = useState<TimelineStatus | null>(null)
  const [choiceAnswers, setChoiceAnswers] = useState<Record<number, ChoiceOptionLabel>>({})
  const [runtimeFailure, setRuntimeFailure] = useState<RuntimeFailure | null>(null)
  const [exitConfirm, setExitConfirm] = useState(false)
  const scale = useViewportScale()

  const candidateRef = useRef<SubmissionCandidate | null>(null)
  const startedAtRef = useRef('')
  const choiceAnswersRef = useRef<Record<number, ChoiceOptionLabel>>({})
  const recordingsRef = useRef<Array<CapturedAudioAnswer | undefined>>([])
  const finishingRef = useRef(false)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  const reportError = useCallback((reason: unknown): Error => {
    const error = reason instanceof Error ? reason : new Error(String(reason))
    try {
      onErrorRef.current?.(error)
    } catch {
      // Host logging must not replace the player error state.
    }
    return error
  }, [])

  useEffect(() => {
    let active = true
    let current: LoadedExam | null = null
    void loadExam(examBaseUrl, fetcher)
      .then((result) => {
        if (!active) {
          result.dispose()
          return
        }
        current = result
        setLoaded(result)
        setPhase('candidate')
      })
      .catch((reason: unknown) => {
        if (!active) return
        setLoadError(reportError(reason))
        setPhase('load-error')
      })
    return () => {
      active = false
      current?.dispose()
    }
  }, [examBaseUrl, fetcher, loadAttempt, reportError])

  const retryLoad = (): void => {
    setPhase('loading')
    setLoaded(null)
    setLoadError(null)
    setLoadAttempt((value) => value + 1)
  }

  const finishSubmission = useCallback(async (): Promise<void> => {
    if (!loaded || !candidateRef.current || finishingRef.current) return
    finishingRef.current = true
    setPhase('submitting')
    setTimelineStatus(null)
    try {
      const bundle = assembleSubmission(loaded.exam, {
        submissionId: crypto.randomUUID(),
        candidate: candidateRef.current,
        startedAt: startedAtRef.current,
        submittedAt: new Date().toISOString(),
        choiceAnswers: choiceAnswerArray(choiceAnswersRef.current),
        recordings: recordingsRef.current
      })
      const recordingBytes: Record<string, Uint8Array> = {}
      for (const [key, blob] of Object.entries(bundle.files)) {
        recordingBytes[key] = new Uint8Array(await blob.arrayBuffer())
      }
      const files = collectSubmissionPackageFiles(
        bundle.submission,
        loaded.resources,
        recordingBytes
      )
      const bytes = await encodeSubmissionPackage(bundle.submission, files)
      const archive = new Blob([copyArrayBuffer(bytes)], { type: SUBMISSION_MEDIA_TYPE })
      await onFinish(archive)
      setPhase('complete')
    } catch (reason) {
      finishingRef.current = false
      setRuntimeFailure({ error: reportError(reason), retry: 'submission' })
      setPhase('runtime-error')
    }
  }, [loaded, onFinish, reportError])

  const advance = useCallback((): void => {
    if (!loaded) return
    const page = loaded.exam.examData.player.pages[pageIndex]
    if (stepIndex + 1 < page.timeline.length) {
      setStepIndex((current) => current + 1)
      return
    }
    if (pageIndex + 1 < loaded.exam.examData.player.pages.length) {
      setPageIndex((current) => current + 1)
      setStepIndex(0)
      return
    }
    void finishSubmission()
  }, [finishSubmission, loaded, pageIndex, stepIndex])

  const failStep = useCallback(
    (reason: unknown): void => {
      setRuntimeFailure({ error: reportError(reason), retry: 'step' })
      setPhase('runtime-error')
    },
    [reportError]
  )

  useEffect(() => {
    if (phase !== 'exam' || !loaded) return
    const step = loaded.exam.examData.player.pages[pageIndex]?.timeline[stepIndex]
    if (!step) {
      const timeout = window.setTimeout(() => failStep(new Error('考试时间线位置无效')), 0)
      return () => window.clearTimeout(timeout)
    }

    let disposed = false
    let statusTimeout = 0
    let cleanup = (): void => undefined
    const complete = (): void => {
      if (!disposed) advance()
    }

    if (step.type === 'play') {
      const key = resourceKey(step.src)
      const url = key ? loaded.resourceUrls[key] : undefined
      if (!url) {
        const timeout = window.setTimeout(
          () => failStep(new Error(`播放资源不存在：${step.src}`)),
          0
        )
        return () => window.clearTimeout(timeout)
      }
      statusTimeout = window.setTimeout(
        () => setTimelineStatus({ kind: 'play', label: '正在播放' }),
        0
      )
      const audio = new Audio(url)
      audio.onended = complete
      audio.onerror = () => failStep(new Error(`音频播放失败：${step.src}`))
      void audio.play().catch(failStep)
      cleanup = () => {
        audio.onended = null
        audio.onerror = null
        audio.pause()
      }
    } else if (step.type === 'countdown') {
      const started = performance.now()
      const durationMs = step.seconds * 1000
      const update = (): void => {
        const elapsed = performance.now() - started
        setTimelineStatus({
          kind: 'countdown',
          label: '准备作答',
          remainingSeconds: Math.max(0, Math.ceil((durationMs - elapsed) / 1000)),
          progress: durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs)
        })
      }
      statusTimeout = window.setTimeout(update, 0)
      const interval = window.setInterval(update, 100)
      const timeout = window.setTimeout(complete, durationMs)
      cleanup = () => {
        window.clearInterval(interval)
        window.clearTimeout(timeout)
      }
    } else {
      statusTimeout = window.setTimeout(
        () =>
          setTimelineStatus({
            kind: 'record',
            label: '准备录音',
            remainingSeconds: step.duration,
            progress: 0
          }),
        0
      )
      void startTimedRecording({
        step,
        deviceId: microphoneId,
        cueUrls: recordingCueUrls,
        onProgress: (remainingSeconds, progress) => {
          if (!disposed) {
            setTimelineStatus({
              kind: 'record',
              label: '正在录音',
              remainingSeconds,
              progress
            })
          }
        },
        onComplete: (recording) => {
          if (disposed) return
          recordingsRef.current[step.recordIndex] = recording
          complete()
        },
        onError: failStep,
        registerCleanup: (value) => {
          cleanup = value
        }
      })
    }

    return () => {
      disposed = true
      window.clearTimeout(statusTimeout)
      cleanup()
    }
  }, [
    advance,
    failStep,
    loaded,
    microphoneId,
    pageIndex,
    phase,
    recordingCueUrls,
    retryToken,
    stepIndex
  ])

  const submitCandidate = (event: FormEvent): void => {
    event.preventDefault()
    const displayName = candidateName.trim()
    const id = candidateId.trim()
    if (!displayName || !id) {
      setCandidateError('姓名和考生号不能为空')
      return
    }
    candidateRef.current = { displayName, candidateId: id }
    setCandidateError(null)
    if ((loaded?.exam.examData.player.recordingIndices.length ?? 0) > 0) {
      setPhase('microphone')
    } else {
      beginExam('')
    }
  }

  const beginExam = (deviceId: string): void => {
    setMicrophoneId(deviceId)
    startedAtRef.current = new Date().toISOString()
    setPageIndex(0)
    setStepIndex(0)
    setPhase('exam')
  }

  const answer = (choiceIndex: number, value: ChoiceOptionLabel): void => {
    const next = { ...choiceAnswersRef.current, [choiceIndex]: value }
    choiceAnswersRef.current = next
    setChoiceAnswers(next)
  }

  const retryFailure = (): void => {
    const retry = runtimeFailure?.retry
    setRuntimeFailure(null)
    if (retry === 'submission') {
      void finishSubmission()
      return
    }
    setRetryToken((current) => current + 1)
    setPhase('exam')
  }

  const page = loaded?.exam.examData.player.pages[pageIndex] ?? null
  const step = page?.timeline[stepIndex] ?? null
  const content = renderPhase()

  function renderPhase(): JSX.Element {
    if (phase === 'loading') {
      return <MessageScreen title="正在加载考试" message="正在验证清单和全部考试资源..." />
    }
    if (phase === 'load-error') {
      return (
        <MessageScreen
          error
          title="考试加载失败"
          message={errorDetails(loadError)}
          actions={
            <>
              <PlayerButton icon={RefreshCw} onClick={retryLoad}>
                重新加载
              </PlayerButton>
              {allowExit ? (
                <PlayerButton secondary icon={LogOut} onClick={() => setExitConfirm(true)}>
                  退出
                </PlayerButton>
              ) : null}
            </>
          }
        />
      )
    }
    if (phase === 'candidate') {
      return (
        <form className={styles.formPanel} onSubmit={submitCandidate}>
          <span className={styles.eyebrow}>考生登录</span>
          <h1>{loaded?.exam.examData.title}</h1>
          <label>
            <span>姓名</span>
            <input
              autoFocus
              value={candidateName}
              onChange={(event) => setCandidateName(event.target.value)}
            />
          </label>
          <label>
            <span>考生号</span>
            <input value={candidateId} onChange={(event) => setCandidateId(event.target.value)} />
          </label>
          {candidateError ? <p className={styles.formError}>{candidateError}</p> : null}
          <div className={styles.formActions}>
            {allowExit ? (
              <PlayerButton
                secondary
                icon={LogOut}
                type="button"
                onClick={() => setExitConfirm(true)}
              >
                退出
              </PlayerButton>
            ) : null}
            <PlayerButton icon={Play} type="submit">
              继续
            </PlayerButton>
          </div>
        </form>
      )
    }
    if (phase === 'microphone') {
      return <MicrophoneCheck allowExit={allowExit} onComplete={beginExam} onExit={onExit} />
    }
    if (phase === 'runtime-error') {
      return (
        <MessageScreen
          error
          title={runtimeFailure?.retry === 'submission' ? '作答归档生成失败' : '考试流程已暂停'}
          message={errorDetails(runtimeFailure?.error ?? null)}
          actions={
            <>
              <PlayerButton icon={RefreshCw} onClick={retryFailure}>
                重试
              </PlayerButton>
              {allowExit ? (
                <PlayerButton secondary icon={LogOut} onClick={() => setExitConfirm(true)}>
                  退出
                </PlayerButton>
              ) : null}
            </>
          }
        />
      )
    }
    if (phase === 'submitting') {
      return <MessageScreen title="正在生成作答包" message="正在整理答案、录音和考试附件..." />
    }
    if (phase === 'complete') {
      return (
        <MessageScreen
          title="考试完成"
          message="作答包已成功保存。"
          actions={
            <PlayerButton icon={Check} onClick={onExit}>
              完成
            </PlayerButton>
          }
        />
      )
    }
    return page && step ? (
      <ExamScreen
        allowExit={allowExit}
        answers={choiceAnswers}
        loaded={loaded as LoadedExam}
        page={page}
        pageIndex={pageIndex}
        status={timelineStatus}
        step={step}
        onAnswer={answer}
        onExit={() => setExitConfirm(true)}
      />
    ) : (
      <MessageScreen error title="考试数据错误" message="当前页面或时间线动作不存在。" />
    )
  }

  return (
    <div className={styles.root}>
      <div className={styles.stage} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {content}
      </div>
      {exitConfirm ? (
        <div className={styles.confirmBackdrop} role="presentation">
          <section
            aria-modal="true"
            className={styles.confirmDialog}
            role="dialog"
            aria-labelledby="exam-exit-title"
          >
            <AlertTriangle aria-hidden="true" />
            <h2 id="exam-exit-title">退出考试？</h2>
            <p>当前考试进度不会生成作答包。</p>
            <div>
              <PlayerButton secondary onClick={() => setExitConfirm(false)}>
                继续考试
              </PlayerButton>
              <PlayerButton icon={LogOut} onClick={onExit}>
                确认退出
              </PlayerButton>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function ExamScreen({
  loaded,
  page,
  step,
  pageIndex,
  status,
  answers,
  allowExit,
  onAnswer,
  onExit
}: {
  loaded: LoadedExam
  page: ExamPage
  step: ResolvedTimelineStep
  pageIndex: number
  status: TimelineStatus | null
  answers: Readonly<Record<number, ChoiceOptionLabel>>
  allowExit: boolean
  onAnswer(choiceIndex: number, answer: ChoiceOptionLabel): void
  onExit(): void
}): JSX.Element {
  const meta = loaded.exam.examData.player.choiceMeta
  return (
    <div className={styles.examLayout}>
      <div className={styles.contentViewport}>
        <ExamPageView
          answers={answers}
          className={styles.pageHost}
          choiceMeta={meta}
          page={page}
          resourceUrls={loaded.resourceUrls}
          step={step}
          onAnswer={onAnswer}
        />
      </div>
      <footer className={styles.statusBar}>
        <div className={styles.examPosition}>
          第 {pageIndex + 1} / {loaded.exam.examData.player.pages.length} 页
        </div>
        <div className={styles.statusMain}>
          <strong>{status?.label ?? '正在准备'}</strong>
          {status?.progress !== undefined ? (
            <div className={styles.progressTrack}>
              <span style={{ width: `${status.progress * 100}%` }} />
            </div>
          ) : null}
          {status?.remainingSeconds !== undefined ? (
            <span className={styles.remaining}>{status.remainingSeconds}s</span>
          ) : null}
        </div>
        {allowExit ? (
          <button className={styles.exitButton} type="button" onClick={onExit}>
            <LogOut aria-hidden="true" />
            退出
          </button>
        ) : (
          <span className={styles.exitSpacer} />
        )}
      </footer>
    </div>
  )
}

function MicrophoneCheck({
  allowExit,
  onComplete,
  onExit
}: {
  allowExit: boolean
  onComplete(deviceId: string): void
  onExit(): void
}): JSX.Element {
  const TEST_DURATION_SECONDS = 3
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [recording, setRecording] = useState(false)
  const [recordingRemaining, setRecordingRemaining] = useState(TEST_DURATION_SECONDS)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [playbackComplete, setPlaybackComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recordingIntervalRef = useRef<number | null>(null)
  const activeRef = useRef(true)

  const clearPlayback = useCallback((): void => {
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.currentTime = 0
    setPlaybackUrl(null)
    setPlaying(false)
    setPlaybackComplete(false)
  }, [])

  const loadDevices = useCallback(async (): Promise<void> => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((track) => track.stop())
      if (!activeRef.current) return
      const available = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audioinput' && device.deviceId
      )
      if (!activeRef.current) return
      setDevices(available)
      setDeviceId((current) =>
        available.some((device) => device.deviceId === current)
          ? current
          : available[0]?.deviceId || ''
      )
      if (available.length === 0) setError('未检测到麦克风，请连接设备后重新检测。')
    } catch (reason) {
      if (activeRef.current) setError(microphoneErrorMessage(reason))
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [])

  const retryDevices = (): void => {
    setLoading(true)
    clearPlayback()
    void loadDevices()
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadDevices(), 0)
    return () => window.clearTimeout(timeout)
  }, [loadDevices])

  useEffect(() => {
    return () => {
      if (playbackUrl) URL.revokeObjectURL(playbackUrl)
    }
  }, [playbackUrl])

  useEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      if (recordingIntervalRef.current !== null) {
        window.clearInterval(recordingIntervalRef.current)
      }
      if (recorderRef.current?.state === 'recording') {
        recorderRef.current.stop()
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const test = async (): Promise<void> => {
    setRecording(true)
    setRecordingRemaining(TEST_DURATION_SECONDS)
    setError(null)
    clearPlayback()
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true
      })
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop())
        return
      }
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      recorderRef.current = recorder
      const chunks: BlobPart[] = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      const stopped = new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
      })
      recorder.start()
      const startedAt = performance.now()
      recordingIntervalRef.current = window.setInterval(() => {
        const elapsedSeconds = (performance.now() - startedAt) / 1000
        setRecordingRemaining(Math.max(1, Math.ceil(TEST_DURATION_SECONDS - elapsedSeconds)))
      }, 100)
      await delay(TEST_DURATION_SECONDS * 1000)
      if (recorder.state === 'recording') recorder.stop()
      const blob = await stopped
      if (blob.size === 0) throw new Error('试录没有产生音频数据')
      if (activeRef.current) setPlaybackUrl(URL.createObjectURL(blob))
    } catch (reason) {
      if (activeRef.current) {
        setError(microphoneErrorMessage(reason))
      }
    } finally {
      if (recordingIntervalRef.current !== null) {
        window.clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      recorderRef.current = null
      if (activeRef.current) setRecording(false)
    }
  }

  const playTestRecording = async (): Promise<void> => {
    if (!audioRef.current) return
    setError(null)
    audioRef.current.currentTime = 0
    try {
      await audioRef.current.play()
    } catch (reason) {
      setPlaying(false)
      setError(microphoneErrorMessage(reason))
    }
  }

  const selectDevice = (nextDeviceId: string): void => {
    setDeviceId(nextDeviceId)
    setError(null)
    clearPlayback()
  }

  const testState = recording
    ? 'recording'
    : playbackComplete
      ? 'confirmed'
      : playbackUrl
        ? 'playback'
        : 'ready'

  return (
    <section className={styles.micPanel}>
      <header className={styles.micHeader}>
        <span className={styles.micIcon}>
          <Mic aria-hidden="true" />
        </span>
        <div>
          <span className={styles.eyebrow}>设备检查</span>
          <h1>麦克风测试</h1>
          <p>考试包含录音作答，请先确认录音和回放声音正常。</p>
        </div>
      </header>

      <ol className={styles.micSteps} aria-label="麦克风检查进度">
        <li data-complete={Boolean(deviceId) || undefined}>
          <span>{deviceId ? <Check aria-hidden="true" /> : '1'}</span>选择设备
        </li>
        <li
          data-active={testState === 'recording' || undefined}
          data-complete={Boolean(playbackUrl) || undefined}
        >
          <span>{playbackUrl ? <Check aria-hidden="true" /> : '2'}</span>完成试录
        </li>
        <li
          data-active={testState === 'playback' || undefined}
          data-complete={playbackComplete || undefined}
        >
          <span>{playbackComplete ? <Check aria-hidden="true" /> : '3'}</span>回放确认
        </li>
      </ol>

      <div className={styles.micDeviceRow}>
        <label>
          <span>录音设备</span>
          <select
            aria-busy={loading}
            disabled={loading || recording}
            value={deviceId}
            onChange={(event) => selectDevice(event.target.value)}
          >
            {loading ? <option>正在检测设备...</option> : null}
            {!loading && devices.length === 0 ? <option>未检测到麦克风</option> : null}
            {devices.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `麦克风 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <button
          aria-label="重新检测录音设备"
          className={styles.iconButton}
          disabled={loading || recording}
          title="重新检测录音设备"
          type="button"
          onClick={retryDevices}
        >
          <RefreshCw aria-hidden="true" />
        </button>
      </div>

      <div className={styles.micTestArea} data-state={testState}>
        {recording ? (
          <>
            <span className={styles.recordingIndicator} aria-hidden="true" />
            <strong>正在录音</strong>
            <span>请正常说话 · {recordingRemaining} 秒</span>
          </>
        ) : playbackUrl ? (
          <>
            <span className={styles.testResultIcon}>
              {playbackComplete ? <Check aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
            </span>
            <strong>{playbackComplete ? '回放完成' : '试录完成'}</strong>
            <span>{playbackComplete ? '确认声音清晰后即可开始考试' : '请完整播放刚才的录音'}</span>
            <audio
              ref={audioRef}
              className={styles.playback}
              src={playbackUrl}
              onEnded={() => {
                setPlaying(false)
                setPlaybackComplete(true)
              }}
              onError={() => {
                setPlaying(false)
                setError('试录回放失败，请重新试录。')
              }}
              onPlay={() => setPlaying(true)}
            />
            <PlayerButton
              secondary
              icon={Volume2}
              disabled={playing}
              onClick={() => void playTestRecording()}
            >
              {playing ? '正在回放' : playbackComplete ? '再听一次' : '播放试录'}
            </PlayerButton>
          </>
        ) : (
          <>
            <span className={styles.testResultIcon}>
              <Mic aria-hidden="true" />
            </span>
            <strong>{loading ? '正在检测麦克风' : '准备试录'}</strong>
            <span>试录时长 {TEST_DURATION_SECONDS} 秒</span>
            <PlayerButton icon={Mic} disabled={loading || !deviceId} onClick={() => void test()}>
              开始试录
            </PlayerButton>
          </>
        )}
      </div>

      {error ? (
        <p className={styles.formError} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.micActions}>
        {allowExit ? (
          <PlayerButton secondary icon={LogOut} onClick={onExit}>
            退出
          </PlayerButton>
        ) : null}
        <div>
          {playbackUrl && !recording ? (
            <PlayerButton secondary icon={RotateCcw} onClick={() => void test()}>
              重新试录
            </PlayerButton>
          ) : null}
          {playbackComplete ? (
            <PlayerButton icon={Check} onClick={() => onComplete(deviceId)}>
              声音正常，开始考试
            </PlayerButton>
          ) : null}
        </div>
      </div>
    </section>
  )
}

function MessageScreen({
  title,
  message,
  error = false,
  actions
}: {
  title: string
  message: string
  error?: boolean
  actions?: JSX.Element
}): JSX.Element {
  return (
    <section className={styles.messageScreen} data-error={error || undefined}>
      {error ? <AlertTriangle aria-hidden="true" /> : null}
      <h1>{title}</h1>
      <p>{message}</p>
      {actions ? <div className={styles.messageActions}>{actions}</div> : null}
    </section>
  )
}

function PlayerButton({
  icon: Icon,
  secondary = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: typeof Play
  secondary?: boolean
}): JSX.Element {
  return (
    <button
      className={secondary ? styles.secondaryButton : styles.primaryButton}
      type="button"
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {children}
    </button>
  )
}

function useViewportScale(): number {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const update = (): void =>
      setScale(Math.min(window.innerWidth / DESIGN_WIDTH, window.innerHeight / DESIGN_HEIGHT))
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return scale
}

async function startTimedRecording({
  step,
  deviceId,
  cueUrls,
  onProgress,
  onComplete,
  onError,
  registerCleanup
}: {
  step: Extract<ResolvedTimelineStep, { type: 'record' }>
  deviceId: string
  cueUrls?: { start?: string; stop?: string }
  onProgress(remainingSeconds: number, progress: number): void
  onComplete(recording: CapturedAudioAnswer): void
  onError(error: unknown): void
  registerCleanup(cleanup: () => void): void
}): Promise<void> {
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null
  let timeout = 0
  let interval = 0
  let cancelled = false
  registerCleanup(() => {
    cancelled = true
    window.clearTimeout(timeout)
    window.clearInterval(interval)
    if (recorder?.state === 'recording') {
      recorder.onstop = null
      recorder.stop()
    }
    stream?.getTracks().forEach((track) => track.stop())
  })
  try {
    if (cueUrls?.start) await playUrl(cueUrls.start)
    if (cancelled) return
    stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { exact: deviceId } } : true
    })
    if (cancelled) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    recorder = new MediaRecorder(stream)
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    }
    const started = performance.now()
    recorder.onstop = () => {
      window.clearTimeout(timeout)
      window.clearInterval(interval)
      stream?.getTracks().forEach((track) => track.stop())
      const durationMs = Math.max(0, Math.round(performance.now() - started))
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' })
      if (blob.size === 0) {
        onError(new Error('录音没有产生音频数据'))
        return
      }
      void (async () => {
        if (cueUrls?.stop) await playUrl(cueUrls.stop)
        if (!cancelled) onComplete({ blob, durationMs })
      })().catch(onError)
    }
    recorder.onerror = () => onError(new Error('录音设备发生错误'))
    recorder.start()
    const durationMs = step.duration * 1000
    interval = window.setInterval(() => {
      const elapsed = performance.now() - started
      onProgress(
        Math.max(0, Math.ceil((durationMs - elapsed) / 1000)),
        durationMs === 0 ? 1 : Math.min(1, elapsed / durationMs)
      )
    }, 100)
    timeout = window.setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop()
    }, durationMs)
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop())
    onError(error)
  }
}

function playUrl(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(url)
    audio.onended = () => resolve()
    audio.onerror = () => reject(new Error(`提示音播放失败：${url}`))
    void audio.play().catch(reject)
  })
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}

function errorDetails(error: Error | null): string {
  if (!error) return '未知错误'
  const cause = 'cause' in error && error.cause instanceof Error ? `：${error.cause.message}` : ''
  return `${error.message}${cause}`
}

function microphoneErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === 'NotAllowedError' || reason.name === 'SecurityError') {
      return '无法使用麦克风，请在系统设置中允许麦克风权限后重新检测。'
    }
    if (reason.name === 'NotFoundError' || reason.name === 'DevicesNotFoundError') {
      return '未检测到麦克风，请连接设备后重新检测。'
    }
    if (reason.name === 'NotReadableError' || reason.name === 'TrackStartError') {
      return '麦克风暂时无法使用，请关闭其他占用麦克风的应用后重试。'
    }
  }
  return errorDetails(reason instanceof Error ? reason : new Error(String(reason)))
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}

function choiceAnswerArray(
  answers: Readonly<Record<number, ChoiceOptionLabel>>
): Array<ChoiceOptionLabel | undefined> {
  const indices = Object.keys(answers).map(Number)
  const result = Array<ChoiceOptionLabel | undefined>(Math.max(-1, ...indices) + 1)
  for (const [index, answer] of Object.entries(answers)) result[Number(index)] = answer
  return result
}
