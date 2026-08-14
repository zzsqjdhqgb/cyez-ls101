import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  createHumanGradingEngine,
  type GradingInput,
  type GradingResourceInput,
  type SubmissionGradingWorkspace
} from '@ls101/submission-library'
import { ArrowLeft, Check, CircleAlert, LockKeyhole } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { SubmissionMarkdown } from './SubmissionMarkdown'
import { submissionErrorMessage } from './submissionUi'
import styles from './SubmissionGradingPage.module.css'

const QUESTION_DESCRIPTION_INPUT_ID = 'question-description'

export function SubmissionGradingPage(): JSX.Element {
  const { submissionId: legacySubmissionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const submissionIds = useMemo(() => {
    const queued = searchParams.getAll('submissionId').filter((value) => value.trim() !== '')
    return queued.length > 0 ? [...new Set(queued)] : legacySubmissionId ? [legacySubmissionId] : []
  }, [legacySubmissionId, searchParams])
  const [submissionIndex, setSubmissionIndex] = useState(0)
  const submissionId = submissionIds[submissionIndex] ?? ''
  const [workspace, setWorkspace] = useState<SubmissionGradingWorkspace | null>(null)
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const finishOrAdvance = useCallback((): void => {
    setWorkspace(null)
    setError(null)
    setScore('')
    setComment('')
    if (submissionIndex + 1 < submissionIds.length) {
      setSubmissionIndex((current) => current + 1)
      return
    }
    navigate(settlementUrl(submissionIds))
  }, [navigate, submissionIds, submissionIndex])

  useEffect(() => {
    let active = true
    const timeout = window.setTimeout(() => {
      if (!submissionId) {
        setError('未指定需要评分的作答记录。')
        return
      }
      void repository
        .startGrading(submissionId)
        .then((next) => {
          if (!active) return
          if (next.grading.status === 'ready') {
            finishOrAdvance()
            return
          }
          setWorkspace(next)
        })
        .catch((reason: unknown) => {
          if (active) setError(submissionErrorMessage(reason))
        })
    }, 0)
    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [finishOrAdvance, repository, submissionId])

  const current = useMemo(() => {
    if (!workspace) return null
    const gradedIds = new Set(workspace.grading.items.map((item) => item.instanceId))
    return workspace.inputs.find((input) => !gradedIds.has(input.instanceId)) ?? null
  }, [workspace])

  const currentIndex = current
    ? (workspace?.inputs.findIndex((input) => input.instanceId === current.instanceId) ?? 0)
    : -1

  const submit = async (): Promise<void> => {
    if (!workspace || !current) return
    if (score.trim() === '') {
      setError('请输入分数')
      return
    }
    const numericScore = Number(score)
    setSubmitting(true)
    setError(null)
    try {
      const human = createHumanGradingEngine(() => ({ score: numericScore, comment }))
      const result = await human.grade(current)
      const next = await repository.submitGradingResult(
        submissionId,
        current.instanceId,
        'human',
        result
      )
      if (next.grading.status === 'ready') {
        finishOrAdvance()
        return
      }
      setWorkspace(next)
      setScore('')
      setComment('')
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setSubmitting(false)
    }
  }

  if (error && !workspace) {
    return (
      <div className={styles.centerState}>
        <CircleAlert aria-hidden="true" />
        <p>{error}</p>
        <Button icon={ArrowLeft} onClick={() => navigate('/submissions')}>
          返回作答记录
        </Button>
      </div>
    )
  }

  if (!workspace || !current) {
    return <div className={styles.centerState}>正在准备批改...</div>
  }

  const question =
    current.inputs.find((input) => input.inputId === QUESTION_DESCRIPTION_INPUT_ID)?.value ||
    '无题目描述'
  const auxiliaryInputs = current.inputs.filter(
    (input) => input.inputId !== QUESTION_DESCRIPTION_INPUT_ID && input.inputId !== 'analysis'
  )

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Button
          icon={ArrowLeft}
          variant="ghost"
          onClick={() => navigate('/submissions?view=unsettled')}
        >
          暂停并返回
        </Button>
        <div className={styles.identity}>
          <strong>{workspace.submission.meta.candidate.displayName}</strong>
          <span>
            {displayCandidateId(workspace.submission.meta.candidate.candidateId)} ·{' '}
            {workspace.submission.meta.examTitle}
          </span>
        </div>
        <div className={styles.progress}>
          第 {submissionIndex + 1}/{submissionIds.length} 份 · 评分单元{' '}
          {workspace.grading.items.length + 1}/{workspace.inputs.length}
        </div>
      </header>

      <main className={styles.workspace}>
        <section className={styles.contextPanel} aria-label="评分材料">
          <div className={styles.panelHeading}>
            <span>第 {currentIndex + 1} 题</span>
            <strong>{current.schema.data.name}</strong>
          </div>
          <div className={styles.scrollArea}>
            <section className={styles.contentSection}>
              <h2>题目</h2>
              <SubmissionMarkdown content={question} resources={current.resources} />
            </section>

            {auxiliaryInputs.map((input) => (
              <section className={styles.contentSection} key={input.inputId}>
                <h2>{current.schema.data.inputDescriptions[input.inputId] ?? input.inputId}</h2>
                <SubmissionMarkdown content={input.value} resources={current.resources} />
              </section>
            ))}

            <section className={styles.contentSection}>
              <h2>评分标准</h2>
              <SubmissionMarkdown
                content={current.schema.data.rubricMarkdown}
                resources={current.resources}
              />
            </section>
          </div>
        </section>

        <section className={styles.gradingPanel} aria-label="人工评分">
          <div className={styles.panelHeading}>
            <span>人工评分</span>
            <strong>满分 {current.schema.data.maxScore}</strong>
          </div>
          <div className={styles.scrollArea}>
            <section className={styles.contentSection}>
              <h2>学生答案</h2>
              <div className={styles.answers}>
                {current.answers.map((answer) => (
                  <GradingAnswer answer={answer} key={answer.answerId} />
                ))}
              </div>
            </section>

            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <div className={styles.formField}>
                <label htmlFor="grading-score">分数</label>
                <div className={styles.scoreField}>
                  <input
                    autoFocus
                    id="grading-score"
                    max={current.schema.data.maxScore}
                    min="0"
                    step="any"
                    type="number"
                    value={score}
                    onChange={(event) => setScore(event.target.value)}
                  />
                  <strong>/ {current.schema.data.maxScore}</strong>
                </div>
              </div>
              <div className={styles.formField}>
                <label htmlFor="grading-comment">评语</label>
                <textarea
                  id="grading-comment"
                  placeholder="可留空"
                  rows={7}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                />
              </div>

              {error ? (
                <div className={styles.error} role="alert">
                  <CircleAlert aria-hidden="true" />
                  <span>{error}</span>
                </div>
              ) : null}

              <div className={styles.submitRow}>
                <span>
                  <LockKeyhole aria-hidden="true" />
                  提交后不可修改
                </span>
                <Button disabled={submitting} icon={Check} type="submit" variant="primary">
                  {submitting ? '正在提交' : '提交本题'}
                </Button>
              </div>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}

function GradingAnswer({ answer }: { answer: GradingInput['answers'][number] }): JSX.Element {
  if (answer.type === 'text') {
    return (
      <article className={styles.answer}>
        <strong>{answer.description}</strong>
        <p>{answer.value ?? '未作答'}</p>
      </article>
    )
  }

  return (
    <article className={styles.answer}>
      <div className={styles.answerTitle}>
        <strong>{answer.description}</strong>
        <span>{formatDuration(answer.audio.durationMs)}</span>
      </div>
      {answer.type === 'fixed-speech' ? <p>{answer.text}</p> : null}
      <AudioAnswer resource={answer.audio} />
    </article>
  )
}

function AudioAnswer({ resource }: { resource: GradingResourceInput }): JSX.Element {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [failedResourceKey, setFailedResourceKey] = useState<string | null>(null)

  useEffect(() => {
    const player = audioRef.current
    if (!player) return
    const nextUrl = URL.createObjectURL(
      new Blob([new Uint8Array(resource.data)], { type: resource.mediaType || 'audio/webm' })
    )
    player.src = nextUrl
    return () => {
      player.removeAttribute('src')
      URL.revokeObjectURL(nextUrl)
    }
  }, [resource])

  const playbackError = failedResourceKey === resource.resourceKey

  return (
    <>
      <audio
        ref={audioRef}
        controls
        preload="metadata"
        onCanPlay={() => setFailedResourceKey(null)}
        onError={() => setFailedResourceKey(resource.resourceKey)}
      />
      {playbackError ? (
        <p className={styles.audioError} role="alert">
          录音无法播放，请导出作答包后检查音频文件。
        </p>
      ) : null}
    </>
  )
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
    : `${seconds} 秒`
}

function settlementUrl(submissionIds: readonly string[]): string {
  const params = new URLSearchParams()
  submissionIds.forEach((submissionId) => params.append('submissionId', submissionId))
  return `/submissions/settlement?${params.toString()}`
}

function displayCandidateId(candidateId: string): string {
  return candidateId.startsWith('auto:') ? '考生号未填写' : candidateId
}
