import type { JSX } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'
import { useRegisteredSettingsPages } from '../app/settings-registry'
import styles from './SettingsPage.module.css'

export function SettingsDetailPage(): JSX.Element {
  const navigate = useNavigate()
  const { settingsPageId } = useParams<{ settingsPageId: string }>()
  const pages = useRegisteredSettingsPages()
  const page = pages.find((candidate) => candidate.id === settingsPageId)

  if (!page) {
    return (
      <Page>
        <PageHeader
          title="设置"
          actions={
            <Button icon={ArrowLeft} onClick={() => navigate('/settings')}>
              返回设置
            </Button>
          }
        />
        <EmptyState icon={SlidersHorizontal} title="设置项不存在" />
      </Page>
    )
  }

  const Component = page.component

  return (
    <Page>
      <PageHeader
        title={page.title}
        actions={
          <Button icon={ArrowLeft} onClick={() => navigate('/settings')}>
            返回设置
          </Button>
        }
      />
      {page.description ? <p className={styles.detailDescription}>{page.description}</p> : null}
      <div className={styles.detailBody}>
        <Component />
      </div>
    </Page>
  )
}
