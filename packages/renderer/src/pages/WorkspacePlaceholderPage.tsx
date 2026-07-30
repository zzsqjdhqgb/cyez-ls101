import type { JSX } from 'react'
import { Layers3 } from 'lucide-react'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function WorkspacePlaceholderPage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="工作区" />
      <EmptyState icon={Layers3} title="暂无内容" />
    </Page>
  )
}
