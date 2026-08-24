import { createContext, useContext } from 'react'
import type { SubmissionLibraryRepository } from '@ls101/submission-library'
import { submissionLibraryRepository } from './SubmissionLibraryRuntime'

export const SubmissionLibraryContext = createContext<SubmissionLibraryRepository>(
  submissionLibraryRepository
)

export function useSubmissionLibrary(): SubmissionLibraryRepository {
  return useContext(SubmissionLibraryContext)
}
