import type { JSX } from 'react'
import { ArrowLeft, PanelLeftClose } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ls101/desktop-ui'
import { EmptyState } from '@ls101/desktop-ui'
import { Page, PageHeader } from '@ls101/desktop-ui'

export function FocusPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <Page>
      <PageHeader
        title="专注布局"
        actions={
          <Button icon={ArrowLeft} onClick={() => navigate('/grouped-example')}>
            返回分组页面
          </Button>
        }
      />
      <EmptyState icon={PanelLeftClose} title="侧边栏已隐藏" />
    </Page>
  )
}
