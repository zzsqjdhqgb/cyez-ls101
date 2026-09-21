import { createContext, useContext } from 'react'
import type { LabAction } from '@ls101/lab-renderer'
import type { StudentController, StudentView } from '../../controller'

export const WorkspaceContext = createContext<{
  controller: StudentController
  view: StudentView
  gate: string
  action: LabAction
} | null>(null)

export function useWorkspace(): NonNullable<React.ContextType<typeof WorkspaceContext>> {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('Student workspace is unavailable')
  return value
}
