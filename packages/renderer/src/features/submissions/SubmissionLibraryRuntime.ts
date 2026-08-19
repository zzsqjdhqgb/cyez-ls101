import { fileStore } from '@ls101/file-store/renderer'
import { FileSubmissionLibraryRepository } from '@ls101/submission-library'

export const submissionLibraryRepository = new FileSubmissionLibraryRepository(
  fileStore.scope('submission-library')
)
