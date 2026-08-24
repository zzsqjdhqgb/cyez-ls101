/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { net } from 'electron'
import { join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'

async function serveFile(normalizedPath: string, baseDir: string): Promise<Response> {
  if (!normalizedPath.startsWith(normalize(baseDir))) {
    return new Response('Forbidden', { status: 403 })
  }
  try {
    const fileUrl = pathToFileURL(normalizedPath).href
    const response = await net.fetch(fileUrl)
    if (response.status === 200 || response.status === 206) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      })
    }
  } catch {
    /* ignore */
  }
  return new Response('Not found', { status: 404 })
}

export function createSimpleProtocolHandler(baseDir: string) {
  const normalizedBase = normalize(baseDir)

  return async (request: Request): Promise<Response> => {
    let relativePath = request.url.replace(/^[a-z-]+:\/\//, '')
    if (relativePath.startsWith('/')) relativePath = relativePath.slice(1)
    relativePath = relativePath.replace(/\/+$/, '')

    const fullPath = join(normalizedBase, relativePath)
    const normalized = normalize(fullPath)
    return serveFile(normalized, normalizedBase)
  }
}

export function createResourceProtocolHandler(getBaseDir: (id: string) => string) {
  return async (request: Request): Promise<Response> => {
    const rawUrl = request.url.replace(/^[a-z-]+:\/\//, '')
    const slashIndex = rawUrl.indexOf('/')
    if (slashIndex === -1) return new Response('Bad request', { status: 400 })

    const id = rawUrl.substring(0, slashIndex)
    let relativePath = rawUrl.substring(slashIndex + 1)
    relativePath = relativePath.replace(/\/+$/, '')

    const baseDir = getBaseDir(id)
    const fullPath = join(baseDir, relativePath)
    const normalized = normalize(fullPath)
    return serveFile(normalized, baseDir)
  }
}
