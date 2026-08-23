import { useEffect, useState, type JSX } from 'react'
import { AlertTriangle, ArrowRight, Check, ExternalLink, Info, Tag, X } from 'lucide-react'
import { appIconUrl } from '../../assets'
import { IconButton } from '../../components/ui/IconButton'
import { Modal, ModalClose, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { currentRelease, type ReleaseNoteSection } from './release-notes'
import styles from './ReleaseNotesModal.module.css'

interface ReleaseNotesModalProps {
  open: boolean
  onOpenChange(open: boolean): void
}

function ChangeSection({ section }: { section: ReleaseNoteSection }): JSX.Element {
  return (
    <section className={styles.changeSection} aria-labelledby={`release-${section.title}`}>
      <h2 id={`release-${section.title}`}>{section.title}</h2>
      {section.groups.map((group) => (
        <div className={styles.changeGroup} key={group.title}>
          <h3>{group.title}</h3>
          <ul>
            {group.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function ReleaseNotesModal({ open, onOpenChange }: ReleaseNotesModalProps): JSX.Element {
  const [runtimeVersion, setRuntimeVersion] = useState(currentRelease.version)

  useEffect(() => {
    let active = true
    const appInfo = window.appInfo
    if (!appInfo) return undefined

    void appInfo
      .getVersion()
      .then((version) => {
        if (active) setRuntimeVersion(version)
      })
      .catch(() => undefined)

    return () => {
      active = false
    }
  }, [])

  return (
    <Modal open={open} overlayClassName={styles.backdrop} onOpenChange={onOpenChange}>
      <section className={styles.dialog}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <img src={appIconUrl} alt="" />
            <span>版本说明</span>
          </div>
          <span className={styles.runtimeVersion}>已安装 {runtimeVersion}</span>
          <ModalClose asChild>
            <IconButton autoFocus icon={X} label="关闭版本说明" variant="ghost" />
          </ModalClose>
        </header>

        <div className={styles.scroller}>
          <article className={styles.release}>
            <header className={styles.releaseHeader}>
              <div className={styles.titleRow}>
                <ModalTitle asChild>
                  <h1>{currentRelease.title}</h1>
                </ModalTitle>
                <span className={styles.releaseBadge}>Pre-release</span>
              </div>
              <div className={styles.meta}>
                <Tag aria-hidden="true" />
                <span>v{currentRelease.version}</span>
                <span aria-hidden="true">·</span>
                <span>{currentRelease.date}</span>
                <span aria-hidden="true">·</span>
                <span>自 v{currentRelease.previousVersion} 以来</span>
              </div>
              <ModalDescription asChild>
                <p className={styles.lead}>{currentRelease.summary}</p>
              </ModalDescription>
            </header>

            <aside className={styles.summary} aria-labelledby="release-summary-title">
              <div className={styles.calloutTitle} id="release-summary-title">
                <Info aria-hidden="true" />
                <strong>本次更新重点</strong>
              </div>
              <ul>
                {currentRelease.highlights.map((highlight) => (
                  <li key={highlight}>
                    <Check aria-hidden="true" />
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            </aside>

            {currentRelease.sections.map((section) => (
              <ChangeSection key={section.title} section={section} />
            ))}

            <section className={styles.changeSection} aria-labelledby="release-builtins">
              <h2 id="release-builtins">新增内置内容</h2>
              <div className={styles.tableWrapper}>
                <table>
                  <thead>
                    <tr>
                      <th>类型</th>
                      <th>数量</th>
                      <th>内容</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentRelease.builtins.map((builtin) => (
                      <tr key={builtin.kind}>
                        <td>{builtin.kind}</td>
                        <td>{builtin.count}</td>
                        <td>{builtin.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className={styles.changeSection} aria-labelledby="release-upgrade">
              <h2 id="release-upgrade">升级注意事项</h2>
              <aside className={styles.warning}>
                <div className={styles.calloutTitle}>
                  <AlertTriangle aria-hidden="true" />
                  <strong>升级前请先备份数据</strong>
                </div>
                <ul>
                  {currentRelease.upgradeNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </aside>
            </section>

            <section className={styles.changeSection} aria-labelledby="release-limitations">
              <h2 id="release-limitations">已知限制</h2>
              <ul>
                {currentRelease.limitations.map((limitation) => (
                  <li key={limitation}>{limitation}</li>
                ))}
              </ul>
            </section>

            <section className={styles.changeSection} aria-labelledby="release-start">
              <h2 id="release-start">开始使用</h2>
              <div className={styles.workflow}>
                {[
                  '准备题型与评分单元',
                  '制作试卷模板',
                  '生成并运行试卷',
                  '导入作答包',
                  '评分与结算'
                ].map((step, index, steps) => (
                  <span key={step}>
                    {step}
                    {index < steps.length - 1 ? <ArrowRight aria-hidden="true" /> : null}
                  </span>
                ))}
              </div>
            </section>

            <footer className={styles.footer}>
              <a href={currentRelease.compareUrl} rel="noreferrer" target="_blank">
                查看完整变更：v{currentRelease.previousVersion}...v{currentRelease.version}
                <ExternalLink aria-hidden="true" />
              </a>
            </footer>
          </article>
        </div>
      </section>
    </Modal>
  )
}
