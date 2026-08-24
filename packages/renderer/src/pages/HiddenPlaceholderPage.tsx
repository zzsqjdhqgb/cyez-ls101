import type { JSX } from 'react'
import { ArrowLeft, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function HiddenPlaceholderPage(): JSX.Element {
  const navigate = useNavigate()

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
