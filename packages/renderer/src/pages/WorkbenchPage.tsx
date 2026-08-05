import type { JSX } from 'react'
import { Layers3, LayoutTemplate, Shapes } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function WorkbenchPage(): JSX.Element {
  const navigate = useNavigate()

  return (
    <Page>
      <PageHeader
        title="工作台"
        actions={
          <>
            <Button icon={Shapes} onClick={() => navigate('/interfaces')}>
              打开题型
            </Button>
            <Button icon={LayoutTemplate} onClick={() => navigate('/templates')}>
              打开模板
            </Button>
          </>
        }
      />
      <EmptyState icon={Layers3} title="暂无内容" />
    </Page>
  )
}
