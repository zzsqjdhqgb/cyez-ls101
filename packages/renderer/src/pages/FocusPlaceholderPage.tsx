import type { JSX } from 'react'
import { ArrowLeft, PanelLeftClose } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/** 早期演示用的专注布局示例页；当前未注册路由，因此无法访问。 */
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
