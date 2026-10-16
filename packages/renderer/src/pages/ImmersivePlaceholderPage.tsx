import type { JSX } from 'react'
import { ArrowLeft, Maximize2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/**
 * 沉浸布局示例页：对应 `layout: 'immersive'` 外壳，标题栏与侧边栏同时隐藏，
 * 页面占据整个 renderer 区域。
 *
 * 外壳隐藏标题栏后也不再提供窗口控制和拖拽区域，沉浸页面必须自带离开入口，
 * 这里的返回按钮就是该约定的示例；它只改变路由，不调用原生全屏或 kiosk API。
 */
export function ImmersivePlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  // 返回目标 `/grouped-example` 同样未注册，点击后会由 `*` 兜底路由显示 404 页面。
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
