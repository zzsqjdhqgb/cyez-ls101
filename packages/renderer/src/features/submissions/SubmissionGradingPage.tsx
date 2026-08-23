import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import {
  executeAIGrading,
  type AIGradingProgress,
  type SpeechRecognitionModelSelection,
  type TextGradingModelSelection
} from '@ls101/grading-engine'
import {
  createHumanGradingEngine,
  type GradingInput,
  type GradingResourceInput,
  type SubmissionAIGradingRun,
  type SubmissionAIGradingRunInput,
  type SubmissionGradingWorkspace
} from '@ls101/submission-library'
import {
  schemaBuiltinInputDescription,
  SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID
} from '@ls101/schema-editor'
import { ArrowLeft, Bot, Check, CircleAlert, LockKeyhole, RefreshCw, UserRound } from 'lucide-react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AIModelSelect, type AIModelOption } from '../../components/ai/AIModelSelect'
import { Button } from '../../components/ui/Button'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { SubmissionMarkdown } from './SubmissionMarkdown'
import {
  createAIRouterSpeechCorrector,
  createAIRouterSpeechRecognizer,
  createAIRouterTextGradingModel,
  listSubmissionAIModels
} from './SubmissionAIRouterAdapter'
import {
  createReviewSamplingRules,
  samplingCountKey,
  selectReviewSamples,
  type ReviewSamplingRule
} from './reviewSampling'
import { submissionErrorMessage } from './submissionUi'
import styles from './SubmissionGradingPage.module.css'

export function SubmissionGradingPage(): JSX.Element {
  const { submissionId: legacySubmissionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const submissionIds = useMemo(() => {
    const queued = searchParams.getAll('submissionId').filter((value) => value.trim() !== '')
    return queued.length > 0 ? [...new Set(queued)] : legacySubmissionId ? [legacySubmissionId] : []
  }, [legacySubmissionId, searchParams])
  const [mode, setMode] = useState<'human' | 'ai' | null>(legacySubmissionId ? 'human' : null)
  const [preflight, setPreflight] = useState<'checking' | 'available' | 'error'>(
    submissionIds.length > 0 ? 'checking' : 'available'
  )
  const [preflightError, setPreflightError] = useState<string | null>(null)
  const [preflightWorkspaces, setPreflightWorkspaces] = useState<
    Record<string, SubmissionGradingWorkspace>
  >({})

  useEffect(() => {
    if (submissionIds.length === 0) return

    let active = true
    const timeout = window.setTimeout(() => {
      setPreflight('checking')
      setPreflightError(null)
      void Promise.all(submissionIds.map((submissionId) => repository.startGrading(submissionId)))
        .then((workspaces) => {
          if (!active) return
          setPreflightWorkspaces(
            Object.fromEntries(
              workspaces.map((workspace) => [workspace.submission.meta.submissionId, workspace])
            )
          )
          if (workspaces.every((workspace) => workspace.grading.status === 'ready')) {
            navigate(settlementUrl(submissionIds), { replace: true })
            return
          }
          setPreflight('available')
        })
        .catch((reason: unknown) => {
          if (!active) return
          setPreflightError(submissionErrorMessage(reason))
          setPreflight('error')
        })
    }, 0)

    return () => {
      active = false
      window.clearTimeout(timeout)
    }
  }, [navigate, repository, submissionIds])

  if (preflight === 'checking') {
    return <div className={styles.centerState}>正在准备评分...</div>
  }

  if (preflight === 'error') {
    return (
      <div className={styles.centerState}>
        <CircleAlert aria-hidden="true" />
        <p>{preflightError || '无法准备评分'}</p>
        <Button icon={ArrowLeft} onClick={() => navigate('/submissions')}>
          返回作答记录
        </Button>
      </div>
    )
  }

  if (mode === 'human') {
    return (
      <HumanSubmissionGradingPage
        initialWorkspaces={preflightWorkspaces}
        submissionIds={submissionIds}
      />
    )
  }
  if (mode === 'ai') {
    return (
      <AISubmissionGradingPage
        initialWorkspaces={preflightWorkspaces}
        submissionIds={submissionIds}
      />
    )
  }
  return <GradingModeChooser onSelect={setMode} />
}

function GradingModeChooser({ onSelect }: { onSelect(mode: 'human' | 'ai'): void }): JSX.Element {
  const navigate = useNavigate()
  return (
    <div className={styles.setupPage}>
      <header className={styles.setupHeader}>
        <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/submissions')}>
          返回作答记录
        </Button>
        <div>
          <span>开始评分会话</span>
          <h1>选择评分方式</h1>
        </div>
      </header>
      <main className={styles.modeOptions}>
        <button aria-label="人工评分" type="button" onClick={() => onSelect('human')}>
          <UserRound aria-hidden="true" />
          <strong>人工评分</strong>
          <span>逐个评分单元查看作答并填写分数与评语</span>
        </button>
        <button aria-label="AI 评分" type="button" onClick={() => onSelect('ai')}>
          <Bot aria-hidden="true" />
          <strong>AI 评分</strong>
          <span>先完成整场评分，再选择完成、全部审查或抽查</span>
        </button>
      </main>
    </div>
  )
}

function HumanSubmissionGradingPage({
  submissionIds,
  initialWorkspaces
}: {
  submissionIds: readonly string[]
  initialWorkspaces: Readonly<Record<string, SubmissionGradingWorkspace>>
}): JSX.Element {
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
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
      const cached = initialWorkspaces[submissionId]
      const workspacePromise = cached
        ? Promise.resolve(cached)
        : repository.startGrading(submissionId)
      void workspacePromise
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
  }, [finishOrAdvance, initialWorkspaces, repository, submissionId])

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
    current.inputs.find((input) => input.inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID)?.value ||
    '无题目描述'
  const auxiliaryInputs = current.inputs.filter((input) =>
    isVisibleGradingAuxiliaryInput(current, input.inputId)
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
                <h2>{gradingInputLabel(current, input.inputId)}</h2>
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

interface AIGradingTarget {
  submissionId: string
  input: GradingInput
}

type AIPhase = 'configure' | 'running' | 'decision' | 'sample' | 'review' | 'submitting'

function AISubmissionGradingPage({
  submissionIds,
  initialWorkspaces
}: {
  submissionIds: readonly string[]
  initialWorkspaces: Readonly<Record<string, SubmissionGradingWorkspace>>
}): JSX.Element {
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] =
    useState<Record<string, SubmissionGradingWorkspace>>(initialWorkspaces)
  const workspacesRef = useRef(workspaces)
  const [recognitionModels, setRecognitionModels] = useState<AIModelOption[]>([])
  const [textModels, setTextModels] = useState<AIModelOption[]>([])
  const [recognitionModel, setRecognitionModel] = useState<SpeechRecognitionModelSelection | null>(
    null
  )
  const [textModel, setTextModel] = useState<TextGradingModelSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [phase, setPhase] = useState<AIPhase>('configure')
  const [processed, setProcessed] = useState(0)
  const [failures, setFailures] = useState<Array<{ target: AIGradingTarget; error: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [reviewTargets, setReviewTargets] = useState<AIGradingTarget[]>([])
  const [reviewIndex, setReviewIndex] = useState(0)
  const [reviewScore, setReviewScore] = useState('')
  const [reviewComment, setReviewComment] = useState('')
  const [sampleRuleId, setSampleRuleId] = useState('total')
  const [sampleCounts, setSampleCounts] = useState<Record<string, string>>({})
  const controllerRef = useRef<AbortController | null>(null)

  const updateWorkspaces = useCallback((next: Record<string, SubmissionGradingWorkspace>): void => {
    workspacesRef.current = next
    setWorkspaces(next)
  }, [])

  useEffect(() => {
    let active = true
    void listSubmissionAIModels()
      .then((models) => {
        if (!active) return
        setRecognitionModels(models.speechRecognition)
        setTextModels(models.text)
        setRecognitionModel(models.speechRecognition[0] ?? null)
        setTextModel(models.text[0] ?? null)
      })
      .catch((reason: unknown) => {
        if (active) setError(submissionErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
      controllerRef.current?.abort()
    }
  }, [updateWorkspaces])

  const targets = useMemo(() => aiTargets(workspaces), [workspaces])
  const samplingRules = useMemo(() => {
    return createReviewSamplingRules(targets, (target) => ({
      schemaId: target.input.schema.schemaId,
      schemaName: target.input.schema.data.name
    }))
  }, [targets])

  const runAI = async (): Promise<void> => {
    if (!recognitionModel || !textModel) {
      setError('请选择语音识别模型和文本模型')
      return
    }
    const controller = new AbortController()
    controllerRef.current = controller
    setPhase('running')
    setError(null)
    setFailures([])
    setProcessed(0)
    const nextFailures: Array<{ target: AIGradingTarget; error: string }> = []
    let currentWorkspaces = workspacesRef.current
    const dependencies = {
      recognizer: createAIRouterSpeechRecognizer(recognitionModel),
      corrector: createAIRouterSpeechCorrector(),
      textModel: createAIRouterTextGradingModel(textModel),
      speechRecognitionModel: recognitionModel,
      textModelSelection: textModel
    }

    for (const target of aiTargets(currentWorkspaces)) {
      const existing = findAIRun(currentWorkspaces[target.submissionId], target.input.instanceId)
      if (
        existing?.status === 'succeeded' &&
        sameModel(existing.speechRecognitionModel, recognitionModel) &&
        sameModel(existing.textModel, textModel)
      ) {
        setProcessed((value) => value + 1)
        continue
      }
      let progress: AIGradingProgress = { answers: [] }
      try {
        const initial = await repository.saveAIGradingRun(
          target.submissionId,
          target.input.instanceId,
          aiRunInput('processing', recognitionModel, textModel, progress)
        )
        currentWorkspaces = { ...currentWorkspaces, [target.submissionId]: initial }
        updateWorkspaces(currentWorkspaces)
        const execution = await executeAIGrading(target.input, dependencies, {
          signal: controller.signal,
          async onProgress(nextProgress) {
            progress = nextProgress
            if (nextProgress.result) return
            const next = await repository.saveAIGradingRun(
              target.submissionId,
              target.input.instanceId,
              aiRunInput('processing', recognitionModel, textModel, nextProgress)
            )
            currentWorkspaces = { ...currentWorkspaces, [target.submissionId]: next }
            updateWorkspaces(currentWorkspaces)
          }
        })
        const succeeded = await repository.saveAIGradingRun(
          target.submissionId,
          target.input.instanceId,
          {
            status: 'succeeded',
            speechRecognitionModel: recognitionModel,
            textModel,
            answers: execution.trace.answers,
            prompt: execution.trace.prompt,
            rawResponse: execution.trace.rawResponse,
            result: execution.result
          }
        )
        currentWorkspaces = { ...currentWorkspaces, [target.submissionId]: succeeded }
        updateWorkspaces(currentWorkspaces)
      } catch (reason) {
        if (controller.signal.aborted) return
        const message = reason instanceof Error ? reason.message : String(reason)
        nextFailures.push({ target, error: message })
        try {
          const failed = await repository.saveAIGradingRun(
            target.submissionId,
            target.input.instanceId,
            aiRunInput('failed', recognitionModel, textModel, progress, message)
          )
          currentWorkspaces = { ...currentWorkspaces, [target.submissionId]: failed }
          updateWorkspaces(currentWorkspaces)
        } catch (saveReason) {
          nextFailures[nextFailures.length - 1].error = submissionErrorMessage(saveReason)
        }
      } finally {
        setProcessed((value) => value + 1)
      }
    }
    controllerRef.current = null
    setFailures(nextFailures)
    setPhase(nextFailures.length > 0 ? 'running' : 'decision')
  }

  const resultFor = (target: AIGradingTarget): SubmissionAIGradingRun => {
    const run = findAIRun(workspacesRef.current[target.submissionId], target.input.instanceId)
    if (!run || run.status !== 'succeeded' || !run.result) {
      throw new Error(`AI 评分结果不完整：${target.input.instanceId}`)
    }
    return run
  }

  const persistReviewPlan = async (
    allTargets: readonly AIGradingTarget[],
    selectedIds: ReadonlySet<string>,
    mode: 'none' | 'all' | 'sample'
  ): Promise<void> => {
    let current = workspacesRef.current
    for (const target of allTargets) {
      const run = resultFor(target)
      const selected = selectedIds.has(targetKey(target))
      const next = await repository.saveAIGradingRun(target.submissionId, target.input.instanceId, {
        status: 'succeeded',
        speechRecognitionModel: run.speechRecognitionModel,
        textModel: run.textModel,
        answers: run.answers,
        prompt: run.prompt,
        rawResponse: run.rawResponse,
        result: run.result,
        review: { mode, selected, reviewed: false }
      })
      current = { ...current, [target.submissionId]: next }
      updateWorkspaces(current)
    }
  }

  const submitWithoutReview = async (selected: readonly AIGradingTarget[]): Promise<void> => {
    setPhase('submitting')
    setError(null)
    try {
      await persistReviewPlan(selected, new Set(), 'none')
      let current = workspacesRef.current
      for (const target of selected) {
        const workspace = current[target.submissionId]
        if (workspace.grading.items.some((item) => item.instanceId === target.input.instanceId)) {
          continue
        }
        const run = resultFor(target)
        const next = await repository.submitGradingResult(
          target.submissionId,
          target.input.instanceId,
          'ai',
          run.result as NonNullable<typeof run.result>
        )
        current = { ...current, [target.submissionId]: next }
        updateWorkspaces(current)
      }
      navigate(settlementUrl(submissionIds))
    } catch (reason) {
      setError(submissionErrorMessage(reason))
      setPhase('decision')
    }
  }

  const beginReview = (selected: AIGradingTarget[]): void => {
    setReviewTargets(selected)
    setReviewIndex(0)
    const firstRun = selected[0] ? resultFor(selected[0]) : null
    const first = firstRun?.result
    setReviewScore(first ? String(first.score) : '')
    setReviewComment(first?.comment ?? '')
    setPhase('review')
  }

  const beginFullReview = async (): Promise<void> => {
    setPhase('submitting')
    setError(null)
    try {
      await persistReviewPlan(targets, new Set(targets.map(targetKey)), 'all')
      beginReview(targets)
    } catch (reason) {
      setError(submissionErrorMessage(reason))
      setPhase('decision')
    }
  }

  const applySample = async (): Promise<void> => {
    const rule = samplingRules.find((item) => item.id === sampleRuleId) ?? samplingRules[0]
    if (!rule) return
    const selected = selectReviewSamples(rule, sampleCounts)
    const selectedIds = new Set(selected.map(targetKey))
    const unselected = targets.filter((target) => !selectedIds.has(targetKey(target)))
    setPhase('submitting')
    try {
      await persistReviewPlan(targets, selectedIds, 'sample')
      let current = workspacesRef.current
      for (const target of unselected) {
        const run = resultFor(target)
        const next = await repository.submitGradingResult(
          target.submissionId,
          target.input.instanceId,
          'ai',
          run.result as NonNullable<typeof run.result>
        )
        current = { ...current, [target.submissionId]: next }
        updateWorkspaces(current)
      }
      if (selected.length === 0) navigate(settlementUrl(submissionIds))
      else beginReview(selected)
    } catch (reason) {
      setError(submissionErrorMessage(reason))
      setPhase('sample')
    }
  }

  const submitReviewed = async (): Promise<void> => {
    const target = reviewTargets[reviewIndex]
    if (!target) return
    const numericScore = Number(reviewScore)
    if (!validReviewedScore(reviewScore, target.input.schema.data.maxScore)) {
      setError(`分数必须在 0 到 ${target.input.schema.data.maxScore} 之间且最多三位小数`)
      return
    }
    setError(null)
    try {
      const next = await repository.submitGradingResult(
        target.submissionId,
        target.input.instanceId,
        'ai',
        { score: numericScore, comment: reviewComment }
      )
      let current = { ...workspacesRef.current, [target.submissionId]: next }
      updateWorkspaces(current)
      const run = resultFor(target)
      const reviewed = await repository.saveAIGradingRun(
        target.submissionId,
        target.input.instanceId,
        {
          status: 'succeeded',
          speechRecognitionModel: run.speechRecognitionModel,
          textModel: run.textModel,
          answers: run.answers,
          prompt: run.prompt,
          rawResponse: run.rawResponse,
          result: run.result,
          review: {
            mode: run.review?.mode ?? 'all',
            selected: true,
            reviewed: true,
            finalResult: { score: numericScore, comment: reviewComment }
          }
        }
      )
      current = { ...current, [target.submissionId]: reviewed }
      updateWorkspaces(current)
      const nextTarget = reviewTargets[reviewIndex + 1]
      if (!nextTarget) {
        navigate(settlementUrl(submissionIds))
        return
      }
      const nextResult = resultFor(nextTarget).result
      setReviewIndex((value) => value + 1)
      setReviewScore(String(nextResult?.score ?? ''))
      setReviewComment(nextResult?.comment ?? '')
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    }
  }

  const reviewTarget = reviewTargets[reviewIndex]
  const reviewRun = reviewTarget
    ? findAIRun(workspaces[reviewTarget.submissionId], reviewTarget.input.instanceId)
    : undefined

  if (phase === 'review' && reviewTarget && reviewRun?.status === 'succeeded' && reviewRun.result) {
    return (
      <AIReviewWorkspace
        comment={reviewComment}
        error={error}
        index={reviewIndex}
        run={reviewRun}
        score={reviewScore}
        target={reviewTarget}
        total={reviewTargets.length}
        onCommentChange={setReviewComment}
        onScoreChange={setReviewScore}
        onSubmit={() => void submitReviewed()}
      />
    )
  }

  return (
    <div className={styles.setupPage}>
      <header className={styles.setupHeader}>
        <Button icon={ArrowLeft} variant="ghost" onClick={() => navigate('/submissions')}>
          暂停并返回
        </Button>
        <div>
          <span>AI 评分会话</span>
          <h1>
            {submissionIds.length} 份作答 · {targets.length} 个评分单元
          </h1>
        </div>
      </header>
      <main className={styles.aiSetup}>
        {loading ? <p>正在准备评分会话...</p> : null}
        {!loading && phase === 'configure' ? (
          <>
            <div className={styles.modelFields}>
              <AIModelSelect
                label="语音识别模型"
                options={recognitionModels}
                value={recognitionModel}
                onChange={setRecognitionModel}
              />
              <AIModelSelect
                label="文本评分模型"
                options={textModels}
                value={textModel}
                onChange={setTextModel}
              />
            </div>
            <Button
              disabled={!recognitionModel || !textModel || targets.length === 0}
              icon={Bot}
              variant="primary"
              onClick={() => void runAI()}
            >
              开始 AI 评分
            </Button>
          </>
        ) : null}

        {phase === 'running' ? (
          <section className={styles.aiStatus}>
            <strong>{failures.length ? '部分题目评分失败' : '正在执行 AI 评分'}</strong>
            <span>
              {Math.min(processed, targets.length)}/{targets.length}
            </span>
            {failures.map(({ target, error: message }) => (
              <p key={targetKey(target)}>
                {target.input.schema.data.name}：{message}
              </p>
            ))}
            {failures.length ? (
              <Button icon={RefreshCw} variant="primary" onClick={() => void runAI()}>
                重试失败题目
              </Button>
            ) : null}
          </section>
        ) : null}

        {phase === 'decision' ? (
          <section className={styles.reviewDecision}>
            <strong>AI 评分已完成</strong>
            <div>
              <Button onClick={() => void submitWithoutReview(targets)}>完成</Button>
              <Button onClick={() => void beginFullReview()}>全部审查</Button>
              <Button variant="primary" onClick={() => setPhase('sample')}>
                抽查
              </Button>
            </div>
          </section>
        ) : null}

        {phase === 'sample' ? (
          <SampleConfiguration
            counts={sampleCounts}
            ruleId={sampleRuleId}
            rules={samplingRules}
            onApply={() => void applySample()}
            onCountChange={(key, value) =>
              setSampleCounts((current) => ({ ...current, [key]: value }))
            }
            onRuleChange={setSampleRuleId}
          />
        ) : null}

        {phase === 'submitting' ? <p>正在保存评分结果...</p> : null}
        {error ? (
          <div className={styles.error} role="alert">
            <CircleAlert />
            <span>{error}</span>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function SampleConfiguration({
  counts,
  ruleId,
  rules,
  onApply,
  onCountChange,
  onRuleChange
}: {
  counts: Record<string, string>
  ruleId: string
  rules: readonly ReviewSamplingRule<AIGradingTarget>[]
  onApply(): void
  onCountChange(key: string, value: string): void
  onRuleChange(value: string): void
}): JSX.Element {
  const rule = rules.find((item) => item.id === ruleId) ?? rules[0]
  return (
    <section className={styles.sampleConfig}>
      <div className={styles.segmented} aria-label="抽查规则">
        {rules.map((item) => (
          <button
            data-active={item.id === rule?.id || undefined}
            key={item.id}
            type="button"
            onClick={() => onRuleChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className={styles.schemaSamples}>
        {rule?.groups.map((group) => {
          const key = samplingCountKey(rule.id, group.id)
          return (
            <label key={group.id}>
              <span>
                {group.name}
                <small>{group.targets.length} 题</small>
              </span>
              <input
                min="0"
                max={group.targets.length}
                type="number"
                value={counts[key] ?? String(rule.defaultCount)}
                onChange={(event) => onCountChange(key, event.target.value)}
              />
            </label>
          )
        })}
      </div>
      <Button variant="primary" onClick={onApply}>
        开始抽查
      </Button>
    </section>
  )
}

function AIReviewWorkspace({
  target,
  run,
  index,
  total,
  score,
  comment,
  error,
  onScoreChange,
  onCommentChange,
  onSubmit
}: {
  target: AIGradingTarget
  run: SubmissionAIGradingRun
  index: number
  total: number
  score: string
  comment: string
  error: string | null
  onScoreChange(value: string): void
  onCommentChange(value: string): void
  onSubmit(): void
}): JSX.Element {
  const input = target.input
  const question =
    input.inputs.find((item) => item.inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID)?.value ??
    '无题目描述'
  const auxiliaryInputs = input.inputs.filter((item) =>
    isVisibleGradingAuxiliaryInput(input, item.inputId)
  )
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span />
        <div className={styles.identity}>
          <strong>AI 评分审查</strong>
          <span>{input.schema.data.name}</span>
        </div>
        <div className={styles.progress}>
          {index + 1}/{total}
        </div>
      </header>
      <main className={styles.workspace}>
        <section className={styles.contextPanel} aria-label="评分材料">
          <div className={styles.panelHeading}>
            <span>题目</span>
            <strong>{input.schema.data.name}</strong>
          </div>
          <div className={styles.scrollArea}>
            <section className={styles.contentSection}>
              <SubmissionMarkdown content={question} resources={input.resources} />
            </section>
            {auxiliaryInputs.map((item) => (
              <section className={styles.contentSection} key={item.inputId}>
                <h2>{gradingInputLabel(input, item.inputId)}</h2>
                <SubmissionMarkdown content={item.value} resources={input.resources} />
              </section>
            ))}
            <section className={styles.contentSection}>
              <h2>评分标准</h2>
              <SubmissionMarkdown
                content={input.schema.data.rubricMarkdown}
                resources={input.resources}
              />
            </section>
          </div>
        </section>
        <section className={styles.gradingPanel} aria-label="AI 评分审查">
          <div className={styles.panelHeading}>
            <span>AI 评分结果</span>
            <strong>满分 {input.schema.data.maxScore}</strong>
          </div>
          <div className={styles.scrollArea}>
            <section className={styles.contentSection}>
              <h2>学生答案</h2>
              <div className={styles.answers}>
                {input.answers.map((answer) => (
                  <GradingAnswer answer={answer} key={answer.answerId} />
                ))}
              </div>
            </section>
            {run.answers.length > 0 ? (
              <section className={styles.contentSection}>
                <h2>语音识别与发音纠正</h2>
                <div className={styles.speechResults}>
                  {run.answers.map((answer) => (
                    <article className={styles.speechResult} key={answer.answerId}>
                      <strong>{answer.description}</strong>
                      {answer.referenceText ? (
                        <p className={styles.speechResultReference}>
                          参考文本：{answer.referenceText}
                        </p>
                      ) : null}
                      <p className={styles.speechResultTranscript}>
                        识别文本：{answer.transcript || '未识别到清晰内容'}
                      </p>
                      <div className={styles.speechResultCorrection}>
                        <SubmissionMarkdown
                          content={answer.correction}
                          resources={input.resources}
                        />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault()
                onSubmit()
              }}
            >
              <div className={styles.formField}>
                <label htmlFor="ai-review-score">分数</label>
                <div className={styles.scoreField}>
                  <input
                    id="ai-review-score"
                    max={input.schema.data.maxScore}
                    min="0"
                    step="0.001"
                    type="number"
                    value={score}
                    onChange={(event) => onScoreChange(event.target.value)}
                  />
                  <strong>/ {input.schema.data.maxScore}</strong>
                </div>
              </div>
              <div className={styles.formField}>
                <label htmlFor="ai-review-comment">评语</label>
                <textarea
                  id="ai-review-comment"
                  rows={7}
                  value={comment}
                  onChange={(event) => onCommentChange(event.target.value)}
                />
              </div>
              {error ? (
                <div className={styles.error} role="alert">
                  <CircleAlert />
                  <span>{error}</span>
                </div>
              ) : null}
              <div className={styles.submitRow}>
                <span>
                  <LockKeyhole />
                  确认后不可修改
                </span>
                <Button icon={Check} type="submit" variant="primary">
                  确认本题
                </Button>
              </div>
            </form>
          </div>
        </section>
      </main>
    </div>
  )
}

function aiTargets(
  workspaces: Readonly<Record<string, SubmissionGradingWorkspace>>
): AIGradingTarget[] {
  return Object.values(workspaces).flatMap((workspace) => {
    const graded = new Set(workspace.grading.items.map((item) => item.instanceId))
    return workspace.inputs
      .filter(
        (input) =>
          input.schema.structure.questionType !== 'objective' && !graded.has(input.instanceId)
      )
      .map((input) => ({ submissionId: workspace.submission.meta.submissionId, input }))
  })
}

function findAIRun(
  workspace: SubmissionGradingWorkspace | undefined,
  instanceId: string
): SubmissionAIGradingRun | undefined {
  return workspace?.grading.aiRuns.find((run) => run.instanceId === instanceId)
}

function aiRunInput(
  status: 'processing' | 'failed',
  speechRecognitionModel: SpeechRecognitionModelSelection,
  textModel: TextGradingModelSelection,
  progress: AIGradingProgress,
  error?: string
): SubmissionAIGradingRunInput {
  return {
    status,
    speechRecognitionModel,
    textModel,
    answers: progress.answers,
    ...(progress.prompt !== undefined ? { prompt: progress.prompt } : {}),
    ...(progress.rawResponse !== undefined ? { rawResponse: progress.rawResponse } : {}),
    ...(error !== undefined ? { error } : {})
  }
}

function sameModel(
  left: { providerId: string; modelId: string },
  right: { providerId: string; modelId: string }
): boolean {
  return left.providerId === right.providerId && left.modelId === right.modelId
}

function targetKey(target: AIGradingTarget): string {
  return `${target.submissionId}\u0000${target.input.instanceId}`
}

function gradingInputLabel(input: GradingInput, inputId: string): string {
  return (
    schemaBuiltinInputDescription(input.schema.structure.questionType, inputId) ??
    input.schema.data.inputDescriptions[inputId] ??
    inputId
  )
}

function isVisibleGradingAuxiliaryInput(input: GradingInput, inputId: string): boolean {
  if (inputId === SCHEMA_QUESTION_DESCRIPTION_INPUT_ID) return false
  return !(
    input.schema.structure.questionType === 'objective' &&
    inputId === SCHEMA_OBJECTIVE_CORRECT_ANSWER_INPUT_ID
  )
}

function validReviewedScore(value: string, maxScore: number): boolean {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(value)) return false
  const score = Number(value)
  if (!Number.isFinite(score) || score < 0 || score > maxScore) return false
  return true
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
