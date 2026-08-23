import { useEffect, useMemo, useState, type JSX } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { X } from 'lucide-react'
import { appIconUrl } from '../../assets'
import { IconButton } from '../../components/ui/IconButton'
import { Modal, ModalClose, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { getReleaseNote, latestReleaseVersion } from './release-notes'
import styles from './ReleaseNotesModal.module.css'

interface ReleaseNotesModalProps {
  open: boolean
  onOpenChange(open: boolean): void
}

export function ReleaseNotesModal({ open, onOpenChange }: ReleaseNotesModalProps): JSX.Element {
  const [runtimeVersion, setRuntimeVersion] = useState(latestReleaseVersion)
  const releaseNote = useMemo(() => getReleaseNote(runtimeVersion), [runtimeVersion])

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
            <ModalDescription className={styles.visuallyHidden}>
              曹二听说101 的版本更新内容、升级注意事项与已知限制
            </ModalDescription>
            <ReactMarkdown
              components={{
                a: ({ children, href }) => (
                  <a href={href} rel="noreferrer" target="_blank">
                    {children}
                  </a>
                ),
                h1: ({ children }) => (
                  <ModalTitle asChild>
                    <h1>{children}</h1>
                  </ModalTitle>
                )
              }}
              remarkPlugins={[remarkGfm]}
            >
              {releaseNote}
            </ReactMarkdown>
          </article>
        </div>
      </section>
    </Modal>
  )
}
