import type { JSX } from 'react'
import { Construction } from 'lucide-react'
import { EmptyState, Page, PageHeader } from '@ls101/desktop-ui'

export function WorkspacePage({
  title,
  description
}: {
  title: string
  description: string
}): JSX.Element {
  return (
    <Page>
      <PageHeader title={title} />
      <EmptyState icon={Construction} title={description} />
    </Page>
  )
}
