import { protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { ASSET_PROTOCOL_SCHEME, BUILTIN_ASSET_PROTOCOL_SCHEME } from '../shared/constants'
import { assetUrlToLocation, builtinAssetUrlToLocation } from './assetUrl'
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

export function registerBuiltinAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: BUILTIN_ASSET_PROTOCOL_SCHEME,
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
  protocol.handle(ASSET_PROTOCOL_SCHEME, (request) =>
    readAssetResponse(baseDir, request.url, assetUrlToLocation)
  )
}

export function registerBuiltinAssetProtocol(baseDir: string): void {
  protocol.handle(BUILTIN_ASSET_PROTOCOL_SCHEME, (request) =>
    readAssetResponse(baseDir, request.url, builtinAssetUrlToLocation)
  )
}

async function readAssetResponse(
  baseDir: string,
  rawUrl: string,
  parseUrl: typeof assetUrlToLocation
): Promise<Response> {
  let filePath: string
  try {
    filePath = resolveAssetPath(baseDir, parseUrl(rawUrl))
  } catch {
    return new Response('Forbidden', { status: 403 })
  }

  try {
    const bytes = await readFile(filePath)
    return new Response(new Uint8Array(bytes), {
      headers: { 'content-type': contentTypeFor(filePath) }
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return new Response('Not Found', { status: 404 })
    }
    return new Response('Internal Server Error', { status: 500 })
  }
}

function contentTypeFor(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.gif':
      return 'image/gif'
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg'
    case '.png':
      return 'image/png'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}
