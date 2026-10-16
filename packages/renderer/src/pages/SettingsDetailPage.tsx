import type { JSX } from 'react'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'
import { useRegisteredSettingsPages } from '../app/settings-registry'
import styles from './SettingsPage.module.css'

/** 根据路由中的设置页标识，从注册表查找并渲染对应的设置组件。 */
export function SettingsDetailPage(): JSX.Element {
  const navigate = useNavigate()
  const { settingsPageId } = useParams<{ settingsPageId: string }>()
  const pages = useRegisteredSettingsPages()
  const page = pages.find((candidate) => candidate.id === settingsPageId)

  // 设置项可能尚未注册或已被移除，此时保留返回设置总览的入口。
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

  // 详情页只负责通用布局，具体设置表单由注册的业务组件提供。
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
