import type { JSX } from 'react'
import { Boxes, Maximize2, PanelLeftClose } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/**
 * 布局示例的入口页：它是唯一同时提供两个跳转的示例，分别打开专注与沉浸布局。
 *
 * 原先以 `/grouped-example` 注册，并带 `group: '示例分组'`，用于演示侧边栏按
 * `navigation.group` 分组后的主导航；该注册随后被真实业务流程取代。
 * 页面主体只渲染空状态，不读取任何业务 Context。
 */
export function GroupedPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  // 两个跳转目标 `/layout-example/*` 均已不再注册，点击后会由 `*` 兜底路由显示 404 页面。
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
