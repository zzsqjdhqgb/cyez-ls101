import { useEffect, useRef, useState, type JSX } from 'react'
import {
  editTemplateDocument,
  type TemplateDocument,
  type TemplateNode
} from '@ls101/template-editor'
import { ArrowLeft, Layers3, Save } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { ConfirmModal } from '../../components/ui/ConfirmModal'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconButton } from '../../components/ui/IconButton'
import { useTemplateApplication } from './TemplateApplicationContext'
import styles from './TemplateDocumentPage.module.css'
import { templateErrorMessage } from './templateUi'

export function TemplateDocumentPage(): JSX.Element {
  const { templateId = '' } = useParams()
  return <TemplateDocumentEditor key={templateId} templateId={templateId} />
}

function TemplateDocumentEditor({ templateId }: { templateId: string }): JSX.Element {
  const application = useTemplateApplication()
  const navigate = useNavigate()
  const [document, setDocument] = useState<TemplateDocument | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const editVersionRef = useRef(0)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let active = true
    void application.templates
      .get(templateId)
      .then((value) => {
        if (!active) return
        if (!value) {
          setError('模板不存在。')
          return
        }
        setDocument(value)
      })
      .catch((reason: unknown) => {
        if (active) setError(templateErrorMessage(reason))
      })
    return () => {
      active = false
    }
  }, [application, templateId])

  const edit = (type: 'set-template-name' | 'set-template-description', value: string): void => {
    if (!document) return
    const result = editTemplateDocument(document, { type, value })
    if (!result.applied) {
      setError(`${result.error.code}: ${result.error.path}`)
      return
    }
    setDocument(result.document)
    editVersionRef.current += 1
    setDirty(true)
    setError(null)
  }

  const save = async (): Promise<void> => {
    if (!document) return
    const snapshot = document
    const savedEditVersion = editVersionRef.current
    setSaving(true)
    setError(null)
    try {
      const saved = await application.templates.save(snapshot)
      if (!mountedRef.current) return
      const hasNewerEdits = editVersionRef.current !== savedEditVersion
      setDocument((current) => {
        if (!current || current.templateId !== saved.templateId) return current
        return hasNewerEdits ? { ...current, revision: saved.revision } : saved
      })
      setDirty(hasNewerEdits)
    } catch (reason) {
      if (mountedRef.current) setError(templateErrorMessage(reason))
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  const leave = (): void => {
    if (dirty) {
      setConfirmLeave(true)
      return
    }
    navigate('/templates')
  }

  return (
    <div className={styles.editor}>
      <header className={styles.toolbar}>
        <div className={styles.identity}>
          <IconButton icon={ArrowLeft} label="返回模板" onClick={leave} />
          <div>
            <h1>{document?.content.name || '未命名模板'}</h1>
            <span>{document ? `Revision ${document.revision}` : '正在加载'}</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Button
            icon={Save}
            variant="primary"
            disabled={!document || !dirty || saving}
            onClick={() => void save()}
          >
            {saving ? '正在保存' : '保存'}
          </Button>
        </div>
      </header>

      <div className={styles.workspace}>
        <section className={styles.properties} aria-labelledby="template-properties-heading">
          <h2 id="template-properties-heading">属性</h2>
          {error ? (
            <div className={styles.notice} role="alert">
              {error}
            </div>
          ) : null}
          <label>
            名称
            <input
              disabled={!document}
              value={document?.content.name ?? ''}
              onChange={(event) => edit('set-template-name', event.target.value)}
            />
          </label>
          <label>
            描述
            <textarea
              disabled={!document}
              value={document?.content.description ?? ''}
              onChange={(event) => edit('set-template-description', event.target.value)}
            />
          </label>
        </section>

        <section className={styles.structure} aria-labelledby="template-structure-heading">
          <h2 id="template-structure-heading">结构</h2>
          {document && document.content.root.children.length > 0 ? (
            <NodeTree nodes={document.content.root.children} />
          ) : null}
          {document && document.content.root.children.length === 0 ? (
            <EmptyState icon={Layers3} title="暂无节点" />
          ) : null}
        </section>
      </div>
      <ConfirmModal
        confirmLabel="放弃修改"
        danger
        message="离开后，本次尚未保存的修改会丢失。"
        open={confirmLeave}
        title="放弃未保存的修改？"
        onCancel={() => setConfirmLeave(false)}
        onConfirm={() => navigate('/templates')}
      />
    </div>
  )
}

function NodeTree({ nodes }: { nodes: readonly TemplateNode[] }): JSX.Element {
  return (
    <ul className={styles.nodeList}>
      {nodes.map((node) => (
        <li key={node.id}>
          <div className={styles.node}>
            <span>{node.id}</span>
            <span className={styles.nodeType}>{nodeTypeLabel(node.type)}</span>
          </div>
          {node.type === 'frame' && node.children.length > 0 ? (
            <NodeTree nodes={node.children} />
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function nodeTypeLabel(type: TemplateNode['type']): string {
  if (type === 'frame') return '框架'
  if (type === 'page') return '页面'
  if (type === 'choice-question') return '选择题'
  return '函数'
}
