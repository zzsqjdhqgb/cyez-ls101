import type { JSX } from 'react'
import { ArrowLeft, PanelLeftClose } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/**
 * 专注布局示例页：对应 `layout: 'focus'` 外壳，保留标题栏、移除侧边栏，
 * 页面因此占据标题栏下方的全部空间；空状态里的图标与文案描述的是外壳状态，而非页面内容。
 *
 * 该页原先注册在 `/layout-example/focus`，用于在没有真实编辑器时演示路由级布局切换；
 * 真实专注页面接入后该注册已被移除，目前没有进入它的界面入口。
 */
export function FocusPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  // 返回目标 `/grouped-example` 同样未注册，点击后会落入 `*` 兜底路由显示 404 页面。
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
