import type { JSX } from 'react'
import { Boxes } from 'lucide-react'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function GroupedPlaceholderPage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="分组页面" />
      <EmptyState icon={Boxes} title="暂无内容" />
    </Page>
  )
}
