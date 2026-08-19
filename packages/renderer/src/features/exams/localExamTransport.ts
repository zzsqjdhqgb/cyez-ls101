import type { ExamArchive } from '@ls101/exam-package'

export interface LocalExamTransport {
  baseUrl: string
  fetcher: typeof fetch
}

export function createLocalExamTransport(archive: ExamArchive): LocalExamTransport {
  const baseUrl = `https://local-exam.invalid/${encodeURIComponent(archive.exam.packageId)}/`
  const base = new URL(baseUrl)
  const manifestUrl = new URL('manifest.json', base).href
  const resources = new Map<string, { data: Uint8Array; mediaType: string }>()
  const entries = Object.entries(archive.exam.examData.resources).map(([key, entry]) => {
    const resolved = new URL(entry.packagePath, base)
    return { key, entry, resolved, url: resolved.href }
  })
  const paths = new Map<string, string>()
  for (const { key, url } of entries) {
    const existing = paths.get(url)
    if (existing) {
      throw new Error(`试卷资源路径规范化后发生冲突：${existing}、${key}`)
    }
    if (url === manifestUrl) throw new Error(`试卷资源路径与 manifest.json 冲突：${key}`)
    paths.set(url, key)
  }
  for (const { entry, resolved, url } of entries) {
    if (
      resolved.search !== '' ||
      resolved.hash !== '' ||
      !url.startsWith(baseUrl) ||
      resolved.pathname !== `${base.pathname}${entry.packagePath}`
    ) {
      throw new Error(`试卷资源路径不是规范的相对 URL：${entry.packagePath}`)
    }
  }
  for (const { key, entry, url } of entries) {
    resources.set(url, {
      data: archive.resources[key],
      mediaType: entry.mediaType ?? ''
    })
  }

  const fetcher: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
    if (method !== 'GET') return new Response(null, { status: 405 })
    if (url === manifestUrl) return Response.json(archive.exam)
    const resource = resources.get(url)
    if (!resource) return new Response(null, { status: 404 })
    return new Response(copyArrayBuffer(resource.data), {
      headers: { 'content-type': resource.mediaType }
    })
  }

  return { baseUrl, fetcher }
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
