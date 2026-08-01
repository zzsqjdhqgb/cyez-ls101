import type { InterfaceApplication } from '@ls101/interface-editor'
import type { JSX, ReactNode } from 'react'
import { InterfaceApplicationContext } from './InterfaceApplicationContext'

interface InterfaceApplicationProviderProps {
  children: ReactNode
  application?: InterfaceApplication
}

export function InterfaceApplicationProvider({
  children,
  application
}: InterfaceApplicationProviderProps): JSX.Element {
  if (!application) return <>{children}</>
  return (
    <InterfaceApplicationContext.Provider value={application}>
      {children}
    </InterfaceApplicationContext.Provider>
  )
}
