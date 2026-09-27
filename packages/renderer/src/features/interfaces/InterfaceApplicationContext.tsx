import { createContext, useContext } from 'react'
import type { InterfaceApplication } from '@ls101/interface-editor'
import { interfaceApplication } from './InterfaceApplicationRuntime'

export const InterfaceApplicationContext = createContext<InterfaceApplication>(interfaceApplication)

export function useInterfaceApplication(): InterfaceApplication {
  const application = useContext(InterfaceApplicationContext)
  if (!application) throw new Error('题型应用上下文缺失，请在应用内打开本页。')
  return application
}
