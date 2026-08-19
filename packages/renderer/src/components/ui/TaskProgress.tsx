import type { TaskProgressItem } from '@ls101/core-types'
import { AlertCircle, Check, Circle, LoaderCircle } from 'lucide-react'
import type { JSX } from 'react'
import styles from './TaskProgress.module.css'

interface TaskProgressProps {
  items: readonly TaskProgressItem[]
  label: string
}

export function TaskProgress({ items, label }: TaskProgressProps): JSX.Element {
  return (
    <section aria-label={label} className={styles.progress}>
      <ol>
        {items.map((item) => (
          <li data-status={item.status} key={item.id}>
            <TaskIcon item={item} />
            <div>
              <strong>{item.label}</strong>
              {item.log?.content ? <pre>{item.log.content}</pre> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

function TaskIcon({ item }: { item: TaskProgressItem }): JSX.Element {
  if (item.status === 'completed') return <Check aria-hidden="true" />
  if (item.status === 'failed') return <AlertCircle aria-hidden="true" />
  if (item.status === 'running') return <LoaderCircle aria-hidden="true" />
  return <Circle aria-hidden="true" />
}
