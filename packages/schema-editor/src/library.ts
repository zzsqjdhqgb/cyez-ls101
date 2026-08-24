import type { SchemaDraft, SchemaDraftLibraryDocument } from '@ls101/core-types'

export type SchemaDraftLibraryEditResult =
  | { success: true; library: SchemaDraftLibraryDocument }
  | { success: false; reason: 'duplicate-draft' | 'draft-not-found' }

export function addSchemaDraft(
  library: SchemaDraftLibraryDocument,
  draft: SchemaDraft
): SchemaDraftLibraryEditResult {
  if (library.drafts.some((item) => item.draftId === draft.draftId)) {
    return { success: false, reason: 'duplicate-draft' }
  }
  return {
    success: true,
    library: { ...library, drafts: [...library.drafts, structuredClone(draft)] }
  }
}

export function replaceSchemaDraft(
  library: SchemaDraftLibraryDocument,
  draft: SchemaDraft
): SchemaDraftLibraryEditResult {
  const index = library.drafts.findIndex((item) => item.draftId === draft.draftId)
  if (index < 0) return { success: false, reason: 'draft-not-found' }
  const drafts = [...library.drafts]
  drafts[index] = structuredClone(draft)
  return { success: true, library: { ...library, drafts } }
}

export function removeSchemaDraft(
  library: SchemaDraftLibraryDocument,
  draftId: string
): SchemaDraftLibraryEditResult {
  const index = library.drafts.findIndex((item) => item.draftId === draftId)
  if (index < 0) return { success: false, reason: 'draft-not-found' }
  return {
    success: true,
    library: { ...library, drafts: library.drafts.filter((item) => item.draftId !== draftId) }
  }
}
