import { createContext, useContext } from 'react'
import type { ExamLibraryRepository } from '@ls101/exam-library'
import { examLibraryRepository } from './ExamLibraryRuntime'

export const ExamLibraryContext = createContext<ExamLibraryRepository>(examLibraryRepository)

export function useExamLibrary(): ExamLibraryRepository {
  return useContext(ExamLibraryContext)
}
