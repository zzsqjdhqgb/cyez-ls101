import { useEffect, useMemo, useState, type JSX } from 'react'
import type { SubmissionLibraryEntry } from '@ls101/submission-library'
import { AlertCircle, ArrowLeft, CheckCircle2, Clock3, LoaderCircle } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useSubmissionLibrary } from './SubmissionLibraryContext'
import { submissionErrorMessage } from './submissionUi'
import styles from './SubmissionSettlementPage.module.css'

export function SubmissionSettlementPage(): JSX.Element {
  const repository = useSubmissionLibrary()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const submissionIds = useMemo(
    () => [...new Set(searchParams.getAll('submissionId').filter((value) => value.trim() !== ''))],
    [searchParams]
  )
  const [entries, setEntries] = useState<SubmissionLibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [settling, setSettling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void repository
      .listEntries()
      .then((allEntries) => {
        if (!active) return
        const byId = new Map(allEntries.map((entry) => [entry.record.submissionId, entry]))
        const selected = submissionIds.flatMap((submissionId) => {
          const entry = byId.get(submissionId)
          return entry ? [entry] : []
        })
        if (selected.length !== submissionIds.length) {
          setError('本次评分会话中的部分作答记录已经不存在。')
        }
        setEntries(selected)
      })
      .catch((reason: unknown) => {
        if (active) setError(submissionErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [repository, submissionIds])

  const settleable = entries.filter(
    (entry) => !entry.settlement && entry.grading?.status === 'ready'
  )

  const settle = async (): Promise<void> => {
    if (settleable.length === 0) return
    setSettling(true)
    setError(null)
    try {
      const batch = await repository.settleSubmissions(
        settleable.map((entry) => entry.record.submissionId)
      )
      navigate(`/submissions?view=settled&batchId=${encodeURIComponent(batch.batchId)}`)
    } catch (reason) {
      setError(submissionErrorMessage(reason))
    } finally {
      setSettling(false)
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}>评分会话完成</span>
          <h1>评分结算</h1>
          <p>确认本次评分结果。只有完成全部评分单元的作答会进入新批次。</p>
        </div>
        <div className={styles.summary} aria-label="本次结算摘要">
          <span>
            <strong>{entries.length}</strong>
            本次作答
          </span>
          <span>
            <strong>{settleable.length}</strong>
            可结算
          </span>
        </div>
      </header>

      <main className={styles.content}>
        {error ? (
          <div className={styles.notice} role="alert">
            <AlertCircle aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}
        {loading ? (
          <div className={styles.loading}>
            <LoaderCircle aria-hidden="true" />
            正在准备结算信息...
          </div>
        ) : (
          <div className={styles.tableFrame}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>作答人</th>
                  <th>试卷</th>
                  <th>评分进度</th>
                  <th>得分</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const ready = !entry.settlement && entry.grading?.status === 'ready'
                  return (
                    <tr key={entry.record.submissionId}>
                      <td>
                        <strong>{entry.record.candidateName}</strong>
                        <span>{displayCandidateId(entry.record.candidateId)}</span>
                      </td>
                      <td>{entry.record.examTitle}</td>
                      <td>
                        {entry.grading?.gradedCount ?? 0}/
                        {entry.grading?.totalCount ?? entry.record.schemaUseCount}
                      </td>
                      <td>
                        {entry.grading
                          ? `${entry.grading.totalScore}/${entry.grading.maxScore}`
                          : '-'}
                      </td>
                      <td>
                        <span className={ready ? styles.ready : styles.pending}>
                          {ready ? (
                            <CheckCircle2 aria-hidden="true" />
                          ) : (
                            <Clock3 aria-hidden="true" />
                          )}
                          {settlementStatus(entry)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      <footer className={styles.footer}>
        <Button
          disabled={settling}
          icon={ArrowLeft}
          variant="secondary"
          onClick={() => navigate('/submissions?view=unsettled')}
        >
          下次结算
        </Button>
        <Button
          disabled={loading || settling || settleable.length === 0}
          icon={CheckCircle2}
          variant="primary"
          onClick={() => void settle()}
        >
          {settling ? '正在结算' : `本次结算（${settleable.length}）`}
        </Button>
      </footer>
    </div>
  )
}

function settlementStatus(entry: SubmissionLibraryEntry): string {
  if (entry.settlement) return '已结算'
  if (entry.grading?.status === 'ready') return '可结算'
  if (entry.grading) return '评分中'
  return '未评分'
}

function displayCandidateId(candidateId: string): string {
  return candidateId.startsWith('auto:') ? '考生号未填写' : candidateId
}
