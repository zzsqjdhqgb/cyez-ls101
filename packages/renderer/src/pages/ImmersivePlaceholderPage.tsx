import type { JSX } from 'react'
import { ArrowLeft, Maximize2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ls101/desktop-ui'
import { EmptyState } from '@ls101/desktop-ui'
import { Page, PageHeader } from '@ls101/desktop-ui'

export function ImmersivePlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <Page>
      <PageHeader
        title="沉浸布局"
        actions={
          <Button icon={ArrowLeft} onClick={() => navigate('/grouped-example')}>
            返回分组页面
          </Button>
        }
      />
      <EmptyState icon={Maximize2} title="标题栏和侧边栏已隐藏" />
    </Page>
  )
}
