import { validateConfigScopeSegment } from '../shared/pathUtils'
import type { ConfigStore, ScopedConfigStore } from '../shared/types'
import { ScopedConfigStoreImpl } from './ScopedConfigStore'

export type { ConfigStore, JsonValue, ScopedConfigStore } from '../shared/types'

export const configStore: ConfigStore = {
  scope(name: string): ScopedConfigStore {
    validateConfigScopeSegment(name)
    return new ScopedConfigStoreImpl([name])
  }
}
