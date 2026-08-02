import { assetKeyToLocation, assetLocationToUrl } from '../shared/assetKey'
import { FILE_STORE_CHANNELS } from '../shared/constants'
import { validateScopeSegment } from '../shared/pathUtils'
import type { AssetKey, FileStore, ScopedStore } from '../shared/types'
import { getFileStoreBridge } from './bridge'
import { ScopedStoreImpl } from './ScopedStore'

export type { AssetKey, FileStore, ScopedStore } from '../shared/types'

export const fileStore: FileStore = {
  scope(name: string): ScopedStore {
    validateScopeSegment(name)
    return new ScopedStoreImpl([name])
  },

  async readAsset(key: AssetKey): Promise<Uint8Array | null> {
    const value = await getFileStoreBridge().invoke(
      FILE_STORE_CHANNELS.readAsset,
      assetKeyToLocation(key)
    )
    return value === null ? null : new Uint8Array(value as ArrayLike<number>)
  },

  getAssetUrl(key: AssetKey): string {
    return assetLocationToUrl(assetKeyToLocation(key))
  }
}
