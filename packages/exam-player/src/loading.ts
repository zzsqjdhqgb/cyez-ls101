import { validateExamPackage } from '@ls101/exam-package'
import type { ExamPackage } from '@ls101/core-types'

export interface LoadedExam {
  exam: ExamPackage
  resources: Record<string, Uint8Array>
  resourceUrls: Record<string, string>
  dispose(): void
}

export class ExamLoadError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'ExamLoadError'
  }
}

export async function loadExam(
  examBaseUrl: string,
  fetcher: typeof fetch = fetch
): Promise<LoadedExam> {
  const baseUrl = normalizeBaseUrl(examBaseUrl)
  const manifestResponse = await get(fetcher, new URL('manifest.json', baseUrl).href, '考试清单')
  let manifest: unknown
  try {
    manifest = await manifestResponse.json()
  } catch (error) {
    throw new ExamLoadError('考试清单不是有效的 JSON', error)
  }
  try {
    validateExamPackage(manifest)
  } catch (error) {
    throw new ExamLoadError('考试清单校验失败', error)
  }

  const resources: Record<string, Uint8Array> = {}
  const resourceUrls: Record<string, string> = {}
  const createdUrls: string[] = []
  try {
    for (const [assetKey, entry] of Object.entries(manifest.examData.resources)) {
      const resourceUrl = resolvePackageUrl(baseUrl, entry.packagePath)
      const response = await get(fetcher, resourceUrl, `资源 ${assetKey}`)
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength === 0) throw new ExamLoadError(`资源为空：${assetKey}`)
      resources[assetKey] = data
      const blob = new Blob([copyArrayBuffer(data)], {
        type: entry.mediaType || response.headers.get('content-type') || ''
      })
      const objectUrl = URL.createObjectURL(blob)
      createdUrls.push(objectUrl)
      resourceUrls[assetKey] = objectUrl
    }
  } catch (error) {
    createdUrls.forEach((url) => URL.revokeObjectURL(url))
    throw error
  }

  return {
    exam: manifest,
    resources,
    resourceUrls,
    dispose: () => createdUrls.forEach((url) => URL.revokeObjectURL(url))
  }
}

export function resourceKey(uri: string): string | null {
  return /^resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)$/.exec(uri)?.[1] ?? null
}

function normalizeBaseUrl(value: string): URL {
  if (!value.endsWith('/')) throw new ExamLoadError('examBaseUrl 必须以 / 结尾')
  try {
    return new URL(value)
  } catch (error) {
    throw new ExamLoadError('examBaseUrl 不是有效 URL', error)
  }
}

function resolvePackageUrl(baseUrl: URL, packagePath: string): string {
  const resolved = new URL(packagePath, baseUrl)
  if (!resolved.href.startsWith(baseUrl.href)) {
    throw new ExamLoadError(`资源路径超出考试目录：${packagePath}`)
  }
  return resolved.href
}

async function get(fetcher: typeof fetch, url: string, label: string): Promise<Response> {
  let response: Response
  try {
    response = await fetcher(url, { method: 'GET' })
  } catch (error) {
    throw new ExamLoadError(`${label}加载失败`, error)
  }
  if (!response.ok) throw new ExamLoadError(`${label}加载失败（HTTP ${response.status}）`)
  return response
}

function copyArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
}
