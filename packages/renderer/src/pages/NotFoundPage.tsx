import type { JSX } from 'react'
import { ArrowLeft, FileQuestion } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@ls101/desktop-ui'
import { EmptyState } from '@ls101/desktop-ui'
import { Page, PageHeader } from '@ls101/desktop-ui'

export function NotFoundPage(): JSX.Element {
  const navigate = useNavigate()

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
