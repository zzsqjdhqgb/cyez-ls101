import { useEffect, useState, type JSX } from 'react'
import { decodeExamPackage } from '@ls101/exam-package'
import { ExamPlayer } from '@ls101/exam-player'
import { fileDialog } from '@ls101/file-dialog/renderer'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { useExamLibrary } from './ExamLibraryContext'
import { examErrorMessage } from './examUi'
import { createLocalExamTransport, type LocalExamTransport } from './localExamTransport'
import styles from './ExamSessionPage.module.css'

const SUBMISSION_FILTER = [{ name: 'LS101 作答包', extensions: ['lssubmission', 'zip'] }]

type SessionState =
  | { status: 'loading' }
  | { status: 'ready'; transport: LocalExamTransport }
  | { status: 'error'; message: string }

export function ExamSessionPage(): JSX.Element {
  const repository = useExamLibrary()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const packageId = searchParams.get('packageId') ?? ''
  const [session, setSession] = useState<SessionState>(
    packageId ? { status: 'loading' } : { status: 'error', message: '未指定要开始的试卷。' }
  )
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    if (!packageId) return
    void repository
      .exportArchive(packageId)
      .then((data) => decodeExamPackage(data))
      .then((archive) => {
        if (active) setSession({ status: 'ready', transport: createLocalExamTransport(archive) })
      })
      .catch((reason: unknown) => {
        if (active) setSession({ status: 'error', message: examErrorMessage(reason) })
      })
    return () => {
      active = false
    }
  }, [loadAttempt, packageId, repository])

  const saveSubmission = async (archive: Blob): Promise<void> => {
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const written = await fileDialog.writeBinary(bytes, {
      title: '保存作答包',
      defaultName: `作答-${new Date().toISOString().replace(/[:]/g, '-').replace(/\.\d+/, '')}.lssubmission`,
      filters: SUBMISSION_FILTER
    })
    if (!written) throw new Error('需要保存作答包才能完成考试。')
  }

  if (session.status === 'error') {
    return (
      <main className={styles.message}>
        <AlertTriangle aria-hidden="true" />
        <h1>无法开始考试</h1>
        <p>{session.message}</p>
        <div>
          <Button icon={ArrowLeft} variant="secondary" onClick={() => navigate('/exams')}>
            返回考试列表
          </Button>
          {packageId ? (
            <Button
              icon={RefreshCw}
              onClick={() => {
                setSession({ status: 'loading' })
                setLoadAttempt((value) => value + 1)
              }}
            >
              重试
            </Button>
          ) : null}
        </div>
      </main>
    )
  }

  if (session.status === 'loading') {
    return <main className={styles.loading}>正在验证试卷资源...</main>
  }

  return (
    <ExamPlayer
      allowExit
      examBaseUrl={session.transport.baseUrl}
      fetcher={session.transport.fetcher}
      onExit={() => navigate('/exams')}
      onFinish={saveSubmission}
    />
  )
}
