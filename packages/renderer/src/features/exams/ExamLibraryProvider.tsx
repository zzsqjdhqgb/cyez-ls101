import type { ExamLibraryRepository } from '@ls101/exam-library'
import type { JSX, ReactNode } from 'react'
import { ExamLibraryContext } from './ExamLibraryContext'

interface ExamLibraryProviderProps {
  children: ReactNode
  repository?: ExamLibraryRepository
}

export function ExamLibraryProvider({
  children,
  repository
}: ExamLibraryProviderProps): JSX.Element {
  if (!repository) return <>{children}</>
  return <ExamLibraryContext.Provider value={repository}>{children}</ExamLibraryContext.Provider>
}
