import type { JSX } from 'react'
import { Boxes, Maximize2, PanelLeftClose } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function GroupedPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <Page>
      <PageHeader
        title="分组页面"
        actions={
          <>
            <Button icon={PanelLeftClose} onClick={() => navigate('/layout-example/focus')}>
              打开专注布局
            </Button>
            <Button icon={Maximize2} onClick={() => navigate('/layout-example/immersive')}>
              打开沉浸布局
            </Button>
          </>
        }
      />
      <EmptyState icon={Boxes} title="暂无内容" />
    </Page>
  )
}
