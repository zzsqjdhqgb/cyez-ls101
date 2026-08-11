import type { ExamArchive } from '@ls101/exam-package'

export interface LocalExamTransport {
  baseUrl: string
  fetcher: typeof fetch
}

export function createLocalExamTransport(archive: ExamArchive): LocalExamTransport {
  const baseUrl = `https://local-exam.invalid/${encodeURIComponent(archive.exam.packageId)}/`
  const manifestUrl = new URL('manifest.json', baseUrl).href
  const resources = new Map<string, { data: Uint8Array; mediaType: string }>()
  for (const [key, entry] of Object.entries(archive.exam.examData.resources)) {
    resources.set(new URL(entry.packagePath, baseUrl).href, {
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
