import { useId, useState, type JSX, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import styles from './TemplateInspectorSection.module.css'

interface TemplateInspectorSectionProps {
  children: ReactNode
  title: string
  headingId?: string
  defaultExpanded?: boolean
}

export function TemplateInspectorSection({
  children,
  title,
  headingId,
  defaultExpanded = true
}: TemplateInspectorSectionProps): JSX.Element {
  const contentId = useId()
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <section className={styles.section}>
      <h2 className={styles.heading} id={headingId}>
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          className={styles.toggle}
          type="button"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          <span>{title}</span>
        </button>
      </h2>
      {expanded ? (
        <div className={styles.content} id={contentId}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
