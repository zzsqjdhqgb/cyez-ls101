import type { TemplateApplication } from '@ls101/template-editor'
import type { JSX, ReactNode } from 'react'
import { TemplateApplicationContext } from './TemplateApplicationContext'

interface TemplateApplicationProviderProps {
  children: ReactNode
  application?: TemplateApplication
}

export function TemplateApplicationProvider({
  children,
  application
}: TemplateApplicationProviderProps): JSX.Element {
  if (!application) return <>{children}</>
  return (
    <TemplateApplicationContext.Provider value={application}>
      {children}
    </TemplateApplicationContext.Provider>
  )
}
