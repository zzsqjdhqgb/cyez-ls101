import type { SubmissionLibraryRepository } from '@ls101/submission-library'
import type { JSX, ReactNode } from 'react'
import { SubmissionLibraryContext } from './SubmissionLibraryContext'

interface SubmissionLibraryProviderProps {
  children: ReactNode
  repository?: SubmissionLibraryRepository
}

export function SubmissionLibraryProvider({
  children,
  repository
}: SubmissionLibraryProviderProps): JSX.Element {
  if (!repository) return <>{children}</>
  return (
    <SubmissionLibraryContext.Provider value={repository}>
      {children}
    </SubmissionLibraryContext.Provider>
  )
}
