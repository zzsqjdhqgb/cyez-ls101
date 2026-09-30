import { useEffect, useMemo, type JSX } from 'react'
import { X } from 'lucide-react'
import { IconButton, Modal, ModalTitle } from '@ls101/desktop-ui'
import { renderSafeReportMarkup } from '@ls101/lab-renderer'
import type { ObjectiveReport } from '../../objective-report'
import styles from './ObjectiveReportDialog.module.css'
import './objectiveReport.css'

/**
 * 学生端一次性客观题报告对话框。
 *
 * 报告数据只保留在本组件的打开期间：关闭即从控制器中丢弃，界面不留下任何重新
 * 查看的入口；对话框常驻提示“如需再次查看，请询问任课老师”。
 */
export function ObjectiveReportDialog({
  report,
  onClose
}: {
  report: ObjectiveReport
  onClose(): void
}): JSX.Element {
  const resourceUrls = useResourceUrls(report.resources)
  const markup = useMemo(
    () =>
      renderSafeReportMarkup(report.markdown, report.resources, (resource) => {
        return resourceUrls[resource.resourceKey] ?? ''
      }),
    [report, resourceUrls]
  )

  return (
    <Modal open overlayClassName={styles.backdrop} onOpenChange={() => undefined}>
      <section className={styles.dialog}>
        <header className={styles.header}>
          <div>
            <ModalTitle asChild>
              <h2>作答报告</h2>
            </ModalTitle>
            <span>
              {report.candidateName} · {report.examTitle} · 总分 {report.totalScore}/
              {report.maxScore}
            </span>
          </div>
          <IconButton icon={X} label="关闭报告" variant="ghost" onClick={onClose} />
        </header>
        <div className={styles.body}>
          {/* markup 来自 renderSafeReportMarkup：原始 HTML 已转义，地址已按协议白名单过滤。 */}
          <div className="objectiveReport" dangerouslySetInnerHTML={{ __html: markup }} />
        </div>
        <footer className={styles.footer}>
          报告仅显示这一次，关闭后学生端不再保留；如需再次查看，请询问任课老师。
        </footer>
      </section>
    </Modal>
  )
}

/** 静态资源换成 blob URL 展示；报告关闭或资源更新时统一回收。 */
function useResourceUrls(
  resources: Readonly<Record<string, ObjectiveReport['resources'][string]>>
): Readonly<Record<string, string>> {
  const urls = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(resources).map(([key, resource]) => [
          key,
          URL.createObjectURL(
            new Blob([new Uint8Array(resource.data)], {
              type: resource.mediaType || 'application/octet-stream'
            })
          )
        ])
      ),
    [resources]
  )
  useEffect(() => {
    return () => {
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url))
    }
  }, [urls])
  return urls
}
