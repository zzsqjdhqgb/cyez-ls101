import { useEffect, useState, type JSX } from 'react'
import type { FunctionSummary, TemplateSummary } from '@ls101/template-editor'
import { AlertCircle, Braces, LayoutTemplate, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Page, PageHeader } from '../../components/ui/Page'
import { useTemplateApplication } from './TemplateApplicationContext'
import styles from './TemplateBrowserPage.module.css'
import { templateErrorMessage } from './templateUi'

export function TemplateBrowserPage(): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [functions, setFunctions] = useState<FunctionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([application.browser.listTemplates(), application.browser.listFunctions()])
      .then(([templateItems, functionItems]) => {
        if (!active) return
        setTemplates(templateItems)
        setFunctions(functionItems)
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

  return (
    <Page>
      <PageHeader
        title="模板"
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
              <Button onClick={() => navigate(`/templates/${item.templateId}`)}>编辑</Button>
            </article>
          ))}
        </div>
      ) : null}

      <section aria-labelledby="template-functions-heading">
        <div className={styles.sectionHeader}>
          <h2 id="template-functions-heading">函数</h2>
        </div>
        {!loading && functions.length === 0 ? <EmptyState icon={Braces} title="暂无函数" /> : null}
        {!loading && functions.length > 0 ? (
          <div className={styles.list}>
            {functions.map((item) => (
              <article className={styles.row} key={item.functionId}>
                <span className={styles.functionName}>{item.name || '未命名函数'}</span>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </Page>
  )
}
