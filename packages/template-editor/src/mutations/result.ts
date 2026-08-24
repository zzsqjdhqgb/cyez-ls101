import type { DocumentEditChange, DocumentEditError, DocumentEditResult } from './types'

export function applied<TDocument, TOperation>(
  previousDocument: TDocument,
  operation: TOperation,
  document: TDocument,
  changes: readonly DocumentEditChange[]
): DocumentEditResult<TDocument, TOperation> {
  return { applied: true, document, previousDocument, operation, changes }
}

export function rejected<TDocument, TOperation>(
  document: TDocument,
  operation: TOperation,
  editError: DocumentEditError
): DocumentEditResult<TDocument, TOperation> {
  return { applied: false, document, operation, error: editError }
}
