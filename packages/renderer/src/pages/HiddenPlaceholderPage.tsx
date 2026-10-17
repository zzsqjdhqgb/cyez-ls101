import type { JSX } from 'react'
import { ArrowLeft, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/**
 * 隐藏路由示例页：注册时省略 `navigation`，因此不出现在侧边栏，只能由程序导航进入，
 * 用于对照 `Sidebar` 中「隐藏路由可访问但不可见」的行为。
 *
 * 它原先注册在 `/hidden-example`，该注册与另外几个示例页一起被真实流程取代。
 * 返回按钮指向工作台 `/`，是这几个示例中唯一不跳回其他示例的页面。
 */
export function HiddenPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

  // 返回目标 `/` 由工作台路由占用，这几个示例页里只有它回到主界面。
  return (
    <Page>
      <PageHeader
        title="隐藏页面"
        actions={
          <Button icon={ArrowLeft} onClick={() => navigate('/')}>
            返回
          </Button>
        }
      />
      <EmptyState icon={EyeOff} title="暂无内容" />
    </Page>
  )
}
