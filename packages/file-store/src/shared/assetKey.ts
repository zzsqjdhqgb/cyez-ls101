import {
  ASSET_PROTOCOL_HOST,
  ASSET_PROTOCOL_SCHEME,
  BUILTIN_ASSET_PROTOCOL_HOST,
  BUILTIN_ASSET_PROTOCOL_SCHEME
} from './constants'
import { validateFilename, validateScope } from './pathUtils'
import type { AssetKey, FileLocation } from './types'

const ASSET_KEY_SCHEME = 'asset-key'
const BUILTIN_ASSET_KEY_SCHEME = 'builtin-asset-key'
const ASSET_KEY_VERSION = 'v1'

export function createAssetKey(location: FileLocation): AssetKey {
  validateLocation(location)
  return `${ASSET_KEY_SCHEME}://${ASSET_KEY_VERSION}/${encodeLocation(location)}`
}

export function assetKeyToLocation(key: AssetKey): FileLocation {
  return parseLocationUrl(key, `${ASSET_KEY_SCHEME}:`, ASSET_KEY_VERSION, 'Invalid asset key')
}

export function assetLocationToUrl(location: FileLocation): string {
  validateLocation(location)
  return `${ASSET_PROTOCOL_SCHEME}://${ASSET_PROTOCOL_HOST}/${encodeLocation(location)}`
}

export function createBuiltinAssetKey(location: FileLocation): AssetKey {
  validateLocation(location)
  return `${BUILTIN_ASSET_KEY_SCHEME}://${ASSET_KEY_VERSION}/${encodeLocation(location)}`
}

export function builtinAssetKeyToLocation(key: AssetKey): FileLocation {
  return parseLocationUrl(
    key,
    `${BUILTIN_ASSET_KEY_SCHEME}:`,
    ASSET_KEY_VERSION,
    'Invalid builtin asset key'
  )
}

export function builtinAssetLocationToUrl(location: FileLocation): string {
  validateLocation(location)
  return `${BUILTIN_ASSET_PROTOCOL_SCHEME}://${BUILTIN_ASSET_PROTOCOL_HOST}/${encodeLocation(location)}`
}

function encodeLocation(location: FileLocation): string {
  return [...location.scope, location.filename].map(encodeURIComponent).join('/')
}

function parseLocationUrl(
  rawValue: string,
  protocol: string,
  hostname: string,
  errorMessage: string
): FileLocation {
  let url: URL
  try {
    url = new URL(rawValue)
  } catch {
    throw new Error(errorMessage)
  }

  if (
    url.protocol !== protocol ||
    url.hostname !== hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error(errorMessage)
  }

  const rawParts = url.pathname.slice(1).split('/')
  if (rawParts.some((part) => part.length === 0)) throw new Error(errorMessage)

  let parts: string[]
  try {
    parts = rawParts.map((part) => decodeURIComponent(part))
  } catch {
    throw new Error(errorMessage)
  }

  const filename = parts.pop()
  if (!filename) throw new Error(errorMessage)

  try {
    validateScope(parts)
    validateFilename(filename)
  } catch {
    throw new Error(errorMessage)
  }

  return { scope: parts, filename }
}

function validateLocation(location: FileLocation): void {
  validateScope(location.scope)
  validateFilename(location.filename)
}
