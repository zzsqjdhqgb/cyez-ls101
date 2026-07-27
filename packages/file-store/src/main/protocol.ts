import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { ASSET_PROTOCOL_SCHEME } from '../shared/constants'
import { assetUrlToLocation } from './assetUrl'
import { resolveAssetPath } from './storage'

export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_PROTOCOL_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

export function registerAssetProtocol(baseDir: string): void {
  protocol.handle(ASSET_PROTOCOL_SCHEME, (request) => {
    try {
      const filePath = resolveAssetPath(baseDir, assetUrlToLocation(request.url))
      return net.fetch(pathToFileURL(filePath).toString())
    } catch {
      return new Response('Forbidden', { status: 403 })
    }
  })
}
