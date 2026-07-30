import type { JSX } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { EmptyState } from '../components/ui/EmptyState'
import { Page, PageHeader } from '../components/ui/Page'

export function SettingsPlaceholderPage(): JSX.Element {
  return (
    <Page>
      <PageHeader title="设置" />
      <EmptyState icon={SlidersHorizontal} title="暂无设置项" />
    </Page>
  )
}
