import {
  ASSET_PROTOCOL_HOST,
  ASSET_PROTOCOL_SCHEME,
  BUILTIN_ASSET_PROTOCOL_HOST,
  BUILTIN_ASSET_PROTOCOL_SCHEME
} from '../shared/constants'
import { validateFilename, validateScope } from '../shared/pathUtils'
import type { FileLocation } from '../shared/types'

export function assetUrlToLocation(rawUrl: string): FileLocation {
  return parseAssetUrl(rawUrl, ASSET_PROTOCOL_SCHEME, ASSET_PROTOCOL_HOST)
}

export function builtinAssetUrlToLocation(rawUrl: string): FileLocation {
  return parseAssetUrl(rawUrl, BUILTIN_ASSET_PROTOCOL_SCHEME, BUILTIN_ASSET_PROTOCOL_HOST)
}

function parseAssetUrl(rawUrl: string, scheme: string, host: string): FileLocation {
  const url = new URL(rawUrl)
  if (
    url.protocol !== `${scheme}:` ||
    url.hostname !== host ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash
  ) {
    throw new Error('Invalid asset URL')
  }

  const rawParts = url.pathname.slice(1).split('/')
  if (rawParts.some((part) => part.length === 0)) throw new Error('Invalid asset URL')

  const parts = rawParts.map((part) => decodeURIComponent(part))
  const filename = parts.pop()
  if (!filename) throw new Error('Invalid asset URL')

  validateScope(parts)
  validateFilename(filename)
  return { scope: parts, filename }
}
