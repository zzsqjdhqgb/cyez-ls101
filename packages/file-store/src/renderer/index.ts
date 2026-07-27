import { validateScopeSegment } from '../shared/pathUtils'
import type { FileStore, ScopedStore } from '../shared/types'
import { ScopedStoreImpl } from './ScopedStore'

export type { FileStore, ScopedStore } from '../shared/types'

export const fileStore: FileStore = {
  scope(name: string): ScopedStore {
    validateScopeSegment(name)
    return new ScopedStoreImpl([name])
  }
}
