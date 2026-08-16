import { useEffect, useState, type JSX } from 'react'
import type {
  BuiltinTemplateSummary,
  FunctionLibrarySummary,
  TemplateDocument,
  TemplateImportMode,
  TemplateSummary
} from '@ls101/template-editor'
import {
  AlertCircle,
  Braces,
  Copy,
  Download,
  Eye,
  LayoutTemplate,
  Plus,
  Trash2,
  Upload
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { Page, PageHeader } from '../../components/ui/Page'
import { toast } from '../../components/ui/toast'
import { useTemplateApplication } from './TemplateApplicationContext'
import { exportTemplateDocumentFile, readTemplateDocumentFile } from './TemplateDocumentFiles'
import styles from './TemplateBrowserPage.module.css'
import { templateErrorMessage } from './templateUi'

type TemplateBrowserTab = 'builtin' | 'mine' | 'functions'

export function TemplateBrowserPage(): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [builtinTemplates, setBuiltinTemplates] = useState<BuiltinTemplateSummary[]>([])
  const [functionLibraries, setFunctionLibraries] = useState<FunctionLibrarySummary[]>([])
  const [activeTab, setActiveTab] = useState<TemplateBrowserTab>('builtin')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<{
    source: TemplateDocument
    existing: TemplateDocument
  } | null>(null)
  const [importConflictError, setImportConflictError] = useState<string | null>(null)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TemplateSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void Promise.all([
      application.browser.listTemplates(),
      application.browser.listBuiltinTemplates(),
      application.browser.listFunctionLibraries()
    ])
      .then(([templateItems, builtinItems, libraryItems]) => {
        if (!active) return
        setTemplates(templateItems)
        setBuiltinTemplates(builtinItems)
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
    if (creating || importing) return
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

  const importTemplate = async (): Promise<void> => {
    if (creating || importing) return
    setImporting(true)
    setError(null)
    try {
      const source = await readTemplateDocumentFile()
      if (!source) return
      const inspection = await application.templates.inspectImport(source)
      if (inspection.status === 'identical') {
        toast.info(`模板“${source.content.name || '未命名模板'}”已存在`)
        return
      }
      if (inspection.status === 'conflict') {
        setImportConflictError(null)
        setPendingImport({ source, existing: inspection.existing })
        return
      }
      const imported = await application.templates.importDocument(source, 'preserve-id')
      addImportedTemplate(imported)
      setActiveTab('mine')
      toast.success(`已导入模板“${imported.content.name || '未命名模板'}”`)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setImporting(false)
    }
  }

  const commitConflictingImport = async (
    mode: Extract<TemplateImportMode, 'copy' | 'overwrite'>
  ): Promise<void> => {
    if (!pendingImport || importing) return
    setImporting(true)
    setImportConflictError(null)
    try {
      const imported = await application.templates.importDocument(
        pendingImport.source,
        mode,
        mode === 'overwrite' ? pendingImport.existing.revision : undefined
      )
      if (mode === 'overwrite') {
        setTemplates((current) =>
          current.map((item) =>
            item.templateId === imported.templateId ? templateSummary(imported) : item
          )
        )
        toast.success(`已覆盖模板“${imported.content.name || '未命名模板'}”`)
      } else {
        addImportedTemplate(imported)
        toast.success(`已将模板“${imported.content.name || '未命名模板'}”导入为副本`)
      }
      setActiveTab('mine')
      setPendingImport(null)
    } catch (reason) {
      setImportConflictError(templateErrorMessage(reason))
    } finally {
      setImporting(false)
    }
  }

  const addImportedTemplate = (document: TemplateDocument): void => {
    setTemplates((current) => [...current, templateSummary(document)])
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

  const copyBuiltinTemplate = async (templateId: string): Promise<void> => {
    if (copyingId) return
    setCopyingId(templateId)
    setError(null)
    try {
      const copy = await application.builtinTemplates.createCopy(templateId)
      setTemplates((current) => [...current, templateSummary(copy)])
      setActiveTab('mine')
      toast.success(`已创建模板副本“${copy.content.name || '未命名模板'}”`)
    } catch (reason) {
      setError(templateErrorMessage(reason))
    } finally {
      setCopyingId(null)
    }
  }

  return (
    <Page>
      <PageHeader
        title="试卷模板"
        actions={
          <>
            <Button
              icon={Upload}
              disabled={creating || importing}
              onClick={() => void importTemplate()}
            >
              {importing ? '正在导入' : '导入模板'}
            </Button>
            <Button
              icon={Plus}
              variant="primary"
              disabled={creating || importing}
              onClick={() => void createTemplate()}
            >
              {creating ? '正在新建' : '新建模板'}
            </Button>
          </>
        }
      />

      {error ? (
        <div className={styles.notice} role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}
      {loading ? <div className={styles.loading}>正在加载模板...</div> : null}
      {!loading ? (
        <div className={styles.tabs} role="tablist" aria-label="试卷模板分类">
          <button
            aria-controls="builtin-templates-panel"
            aria-selected={activeTab === 'builtin'}
            id="builtin-templates-tab"
            role="tab"
            type="button"
            onClick={() => setActiveTab('builtin')}
          >
            内置模板
          </button>
          <button
            aria-controls="local-templates-panel"
            aria-selected={activeTab === 'mine'}
            id="local-templates-tab"
            role="tab"
            type="button"
            onClick={() => setActiveTab('mine')}
          >
            我的模板
          </button>
          <button
            aria-controls="function-libraries-panel"
            aria-selected={activeTab === 'functions'}
            id="function-libraries-tab"
            role="tab"
            type="button"
            onClick={() => setActiveTab('functions')}
          >
            函数库
          </button>
        </div>
      ) : null}

      {!loading && activeTab === 'builtin' ? (
        <section
          aria-labelledby="builtin-templates-tab"
          id="builtin-templates-panel"
          role="tabpanel"
        >
          {builtinTemplates.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="暂无内置模板" />
          ) : (
            <div className={styles.list}>
              {builtinTemplates.map((item) => (
                <article className={styles.row} key={item.templateId}>
                  <div className={styles.rowMain}>
                    <div className={styles.builtinIdentity}>
                      <span className={styles.rowName}>{item.name || '未命名模板'}</span>
                      <span className={styles.version}>v{item.version}</span>
                    </div>
                    <p className={styles.rowDescription}>
                      {item.available
                        ? item.description || '暂无描述'
                        : '缺少所需的题型或数据结构，当前版本暂不可用'}
                    </p>
                  </div>
                  <div className={styles.rowActions}>
                    <Button
                      icon={Eye}
                      onClick={() => navigate(`/templates/builtin/${item.templateId}`)}
                    >
                      查看
                    </Button>
                    <Button
                      icon={Copy}
                      disabled={copyingId !== null}
                      onClick={() => void copyBuiltinTemplate(item.templateId)}
                    >
                      {copyingId === item.templateId ? '正在创建' : '创建副本'}
                    </Button>
                    <Button
                      disabled={!item.available}
                      title={
                        item.available
                          ? undefined
                          : item.errors.map((error) => error.code).join(', ')
                      }
                      onClick={() => navigate(`/templates/builtin/${item.templateId}/generate`)}
                    >
                      生成试卷
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading && activeTab === 'mine' ? (
        <section aria-labelledby="local-templates-tab" id="local-templates-panel" role="tabpanel">
          {templates.length === 0 ? (
            <EmptyState icon={LayoutTemplate} title="暂无本地模板" />
          ) : (
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
                    <Button onClick={() => navigate(`/templates/${item.templateId}/generate`)}>
                      生成试卷
                    </Button>
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
          )}
        </section>
      ) : null}

      {!loading && activeTab === 'functions' ? (
        <section
          aria-labelledby="function-libraries-tab"
          id="function-libraries-panel"
          role="tabpanel"
        >
          {functionLibraries.length === 0 ? (
            <EmptyState icon={Braces} title="暂无函数库" />
          ) : (
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
          )}
        </section>
      ) : null}

      <ConfirmModal
        busy={importing}
        closeOnConfirm={false}
        confirmLabel="覆盖本地模板"
        danger
        error={importConflictError}
        message={`本地 revision ${pendingImport?.existing.revision ?? 0} 与文件 revision ${pendingImport?.source.revision ?? 0} 的内容不同。覆盖会保留当前模板 ID 并递增本地 revision。`}
        open={pendingImport !== null}
        secondaryLabel="导入为副本"
        title={`模板“${pendingImport?.source.content.name || '未命名模板'}”已存在`}
        onCancel={() => {
          if (!importing) setPendingImport(null)
        }}
        onConfirm={() => void commitConflictingImport('overwrite')}
        onSecondary={() => void commitConflictingImport('copy')}
      />

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

function templateSummary(document: TemplateDocument): TemplateSummary {
  return {
    templateId: document.templateId,
    name: document.content.name,
    description: document.content.description
  }
}
