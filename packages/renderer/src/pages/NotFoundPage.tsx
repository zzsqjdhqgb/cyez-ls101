import type { JSX } from 'react'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

/**
 * 未匹配到有效页面时展示空状态，并提供返回工作台的入口。
 *
 * 它是这组页面中唯一仍在使用的：`App.tsx` 通过 `<Route path="*">` 把它挂在
 * `AppShell` 内部，所以未注册的地址会落在 `standard` 外壳里，而不是脱离外壳的错误页。
 */
export function NotFoundPage(): JSX.Element {
  const navigate = useNavigate()

  // 兜底路由位于 `AppShell` 内部，页面仍显示侧边栏，返回按钮是回到工作台的最短路径。
  return (
    <Page>
      <PageHeader
        title="页面不存在"
        actions={
          <Button icon={ArrowLeft} onClick={() => navigate('/')}>
            返回
          </Button>
        }
      />
      <EmptyState icon={FileQuestion} title="未找到该页面" />
    </Page>
  )
}
