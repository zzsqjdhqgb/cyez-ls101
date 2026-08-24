import {
  assetKeyToLocation,
  assetLocationToUrl,
  builtinAssetKeyToLocation,
  builtinAssetLocationToUrl
} from '../shared/assetKey'
import { BUILTIN_FILE_STORE_CHANNELS, FILE_STORE_CHANNELS } from '../shared/constants'
import { validateScopeSegment } from '../shared/pathUtils'
import type {
  AssetKey,
  BuiltinFileStore,
  FileStore,
  ReadonlyScopedStore,
  ScopedStore
} from '../shared/types'
import { getBuiltinFileStoreBridge } from './builtinBridge'
import { BuiltinScopedStoreImpl } from './BuiltinScopedStore'
import { getFileStoreBridge } from './bridge'
import { ScopedStoreImpl } from './ScopedStore'

export type {
  AssetKey,
  BuiltinFileStore,
  FileStore,
  ReadonlyScopedStore,
  ScopedStore
} from '../shared/types'
export { assetUrlToKey } from '../shared/assetKey'

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

export const builtinFileStore: BuiltinFileStore = {
  scope(name: string): ReadonlyScopedStore {
    validateScopeSegment(name)
    return new BuiltinScopedStoreImpl([name])
  },

  async readAsset(key: AssetKey): Promise<Uint8Array | null> {
    const value = await getBuiltinFileStoreBridge().invoke(
      BUILTIN_FILE_STORE_CHANNELS.readAsset,
      builtinAssetKeyToLocation(key)
    )
    return value === null ? null : new Uint8Array(value as ArrayLike<number>)
  },

  getAssetUrl(key: AssetKey): string {
    return builtinAssetLocationToUrl(builtinAssetKeyToLocation(key))
  }
}
