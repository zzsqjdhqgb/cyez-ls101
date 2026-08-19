import { FileExamLibraryRepository } from '@ls101/exam-library'
import { fileStore } from '@ls101/file-store/renderer'

export const examLibraryRepository = new FileExamLibraryRepository(fileStore.scope('exam-library'))
