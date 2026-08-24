import { createContext, useContext } from 'react'
import type { TemplateApplication } from '@ls101/template-editor'
import { templateApplication } from './TemplateApplicationRuntime'

export const TemplateApplicationContext = createContext<TemplateApplication>(templateApplication)

export function useTemplateApplication(): TemplateApplication {
  const application = useContext(TemplateApplicationContext)
  if (!application) throw new Error('TemplateApplicationProvider is missing')
  return application
}
