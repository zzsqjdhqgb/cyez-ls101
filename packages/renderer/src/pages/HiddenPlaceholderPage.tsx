import type { JSX } from 'react'
import { ArrowLeft, EyeOff } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ls101/desktop-ui'
import { EmptyState } from '@ls101/desktop-ui'
import { Page, PageHeader } from '@ls101/desktop-ui'

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
