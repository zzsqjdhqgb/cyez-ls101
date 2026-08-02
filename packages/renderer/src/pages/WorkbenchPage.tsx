import type { JSX } from 'react'
import { Bell, Layers3, Shapes } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'
import { toast } from '../components/ui/toast'

export function WorkbenchPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <Page>
      <PageHeader
        title="工作台"
        actions={
          <>
            <Button
              icon={Bell}
              onClick={() =>
                toast.info('工作台通知', {
                  description: 'Toast 组件运行正常'
                })
              }
            >
              显示通知
            </Button>
            <Button icon={Shapes} onClick={() => navigate('/interfaces')}>
              打开题型
            </Button>
          </>
        }
      />
      <EmptyState icon={Layers3} title="暂无内容" />
    </Page>
  )
}
