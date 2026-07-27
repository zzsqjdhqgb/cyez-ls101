import { ASSET_PROTOCOL_HOST, ASSET_PROTOCOL_SCHEME } from '../shared/constants'
import { validateFilename, validateScope } from '../shared/pathUtils'
import type { FileLocation } from '../shared/types'

export function assetUrlToLocation(rawUrl: string): FileLocation {
  const url = new URL(rawUrl)
  if (
    url.protocol !== `${ASSET_PROTOCOL_SCHEME}:` ||
    url.hostname !== ASSET_PROTOCOL_HOST ||
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
