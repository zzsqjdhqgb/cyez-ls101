import { createContext, useContext } from 'react'
import type { InterfaceApplication } from '@ls101/interface-editor'
import { interfaceApplication } from './InterfaceApplicationRuntime'

export const InterfaceApplicationContext = createContext<InterfaceApplication>(interfaceApplication)

export function useInterfaceApplication(): InterfaceApplication {
  const application = useContext(InterfaceApplicationContext)
  if (!application) throw new Error('InterfaceApplicationProvider is missing')
  return application
}
