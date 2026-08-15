import { useEffect, useState, type JSX } from 'react'
import type { FunctionLibrarySummary, TemplateSummary } from '@ls101/template-editor'
import { AlertCircle, Braces, Download, LayoutTemplate, Plus, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useTemplateApplication } from './TemplateApplicationContext'
import { exportTemplateDocumentFile } from './TemplateDocumentFiles'
import styles from './TemplateBrowserPage.module.css'
import { templateErrorMessage } from './templateUi'

export function TemplateBrowserPage(): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [functionLibraries, setFunctionLibraries] = useState<FunctionLibrarySummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TemplateSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      application.browser.listTemplates(),
      application.browser.listFunctionLibraries()
    ])
      .then(([templateItems, libraryItems]) => {
        if (!active) return
        setTemplates(templateItems)
        setFunctionLibraries(libraryItems)
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [application])

  const createTemplate = async (): Promise<void> => {
    setCreating(true)
    setError(null)
    try {
      const document = await application.templates.create({ name: '未命名模板' })
      navigate(`/templates/${document.templateId}`)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  const deleteTemplate = async (): Promise<void> => {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await application.templates.delete(pendingDelete.templateId)
      setTemplates((current) =>
        current.filter((item) => item.templateId !== pendingDelete.templateId)
      )
      setPendingDelete(null)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setDeleting(false)
    }
  }

  const exportTemplate = async (templateId: string): Promise<void> => {
    if (exportingId) return
    setExportingId(templateId)
    setError(null)
    try {
      if (await exportTemplateDocumentFile(application, templateId)) toast.success('模板已导出')
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setExportingId(null)
    }
  }

  return (
    <Page>
      <PageHeader
        title="试卷模板"
        actions={
          <Button
            icon={Plus}
            variant="primary"
            disabled={creating}
            onClick={() => void createTemplate()}
          >
            {creating ? '正在新建' : '新建模板'}
          </Button>
        }
      />

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? <div className={styles.loading}>正在加载模板...</div> : null}
      {!loading && templates.length === 0 ? (
        <EmptyState icon={LayoutTemplate} title="暂无模板" />
      ) : null}
      {!loading && templates.length > 0 ? (
        <div className={styles.list}>
          {templates.map((item) => (
            <article className={styles.row} key={item.templateId}>
              <div className={styles.rowMain}>
                <button
                  className={styles.rowTitle}
                  onClick={() => navigate(`/templates/${item.templateId}`)}
                  type="button"
                >
                  {item.name || '未命名模板'}
                </button>
                <p className={styles.rowDescription}>{item.description || '暂无描述'}</p>
              </div>
              <div className={styles.rowActions}>
                <Button onClick={() => navigate(`/templates/${item.templateId}`)}>编辑</Button>
                <IconButton
                  icon={Download}
                  label={`导出模板“${item.name || '未命名模板'}”`}
                  disabled={exportingId !== null}
                  onClick={() => void exportTemplate(item.templateId)}
                />
                <IconButton
                  icon={Trash2}
                  label={`删除模板“${item.name || '未命名模板'}”`}
                  variant="danger"
                  onClick={() => setPendingDelete(item)}
                />
              </div>
            </article>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="template-functions-heading">
        <div className={styles.sectionHeader}>
          <h2 id="template-functions-heading">函数库</h2>
        </div>
        {!loading && functionLibraries.length === 0 ? (
          <EmptyState icon={Braces} title="暂无函数库" />
        ) : null}
        {!loading && functionLibraries.length > 0 ? (
          <div className={styles.list}>
            {functionLibraries.map((item) => (
              <article
                className={styles.row}
                key={`${item.source}:${item.libraryId}:${item.version ?? 'local'}`}
              >
                <span className={styles.functionName}>{item.name || '未命名函数库'}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <ConfirmModal
        busy={deleting}
        closeOnConfirm={false}
        confirmLabel="删除"
        danger
        message="模板及其编辑内容会从本地删除，已经导出的试卷不受影响。"
        open={pendingDelete !== null}
        title={`删除模板“${pendingDelete?.name || '未命名模板'}”？`}
        onCancel={() => {
          if (!deleting) setPendingDelete(null)
        }}
        onConfirm={() => void deleteTemplate()}
      />
    </Page>
  )
}
