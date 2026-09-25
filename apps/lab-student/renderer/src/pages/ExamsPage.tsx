import type { JSX } from 'react'
import { FileText, Play, WifiOff } from 'lucide-react'
import { Button, EmptyState, Page, PageHeader } from '@ls101/desktop-ui'
import { StudentNotice } from '../components/StudentStatus'
import { useWorkspace } from '../session/workspace'
import styles from './Workspace.module.css'

export function ExamsPage(): JSX.Element {
  const { view, controller, gate, action } = useWorkspace()
  return (
    <Page>
      <PageHeader title="可用试卷" />
      <div className={styles.stack}>
        <StudentNotice />
        {gate !== 'ready' ? (
          <EmptyState icon={WifiOff} title="服务连接恢复后可开始练习" />
        ) : view.exams.length === 0 ? (
          <EmptyState icon={FileText} title="暂无已发布试卷" />
        ) : (
          <div>
            {view.exams.map((exam) => (
              <article className={styles.exam} key={exam.examId}>
                <FileText aria-hidden="true" />
                <div className={styles.examTitle}>
                  <h2>{exam.title}</h2>
                  <p>{exam.pageCount} 页</p>
                </div>
                <Button
                  variant="primary"
                  disabled={action.busy || view.phase !== 'idle'}
                  onClick={() => void action.run(() => controller.prepare(exam))}
                >
                  <Play aria-hidden="true" />
                  开始练习
                </Button>
              </article>
            ))}
          </div>
        )}
      </div>
    </Page>
  )
}
