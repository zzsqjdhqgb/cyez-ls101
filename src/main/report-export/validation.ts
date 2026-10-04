import type { ReportExportItem } from '@ls101/core-types'

/** 一次导出的份数上限；超过说明调用方有问题，直接拒绝而不是慢慢打印。 */
const MAX_ITEMS = 300
/** 单份报告 HTML 上限，避免把超大文档送进打印窗口。 */
const MAX_HTML_BYTES = 16 * 1024 * 1024
/** 整批 HTML 上限，避免 IPC 载荷失控。 */
const MAX_TOTAL_BYTES = 128 * 1024 * 1024
const PDF_FILENAME_PATTERN = /^[^/\\]{1,120}\.pdf$/i

/** 校验并规范化导出请求；文件名在同批内去重，保留调用方给出的名字。 */
export function parseReportExportRequest(value: unknown): ReportExportItem[] {
  if (!isRecord(value) || !Array.isArray(value.items)) throw new Error('报告导出请求无效')
  if (value.items.length === 0) return []
  if (value.items.length > MAX_ITEMS) throw new Error(`一次最多导出 ${MAX_ITEMS} 份报告`)

  const usedNames = new Set<string>()
  let totalBytes = 0
  return value.items.map((item, index) => {
    const position = index + 1
    if (!isRecord(item) || typeof item.filename !== 'string' || typeof item.html !== 'string') {
      throw new Error(`第 ${position} 份报告的内容无效`)
    }
    if (!PDF_FILENAME_PATTERN.test(item.filename)) {
      throw new Error(`第 ${position} 份报告的文件名无效`)
    }
    const bytes = Buffer.byteLength(item.html, 'utf8')
    if (bytes > MAX_HTML_BYTES) throw new Error(`第 ${position} 份报告超出单份体积上限`)
    totalBytes += bytes
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('本批次报告总体积超出上限')

    const filename = uniqueFilename(usedNames, item.filename)
    usedNames.add(filename.toLocaleLowerCase())
    return { filename, html: item.html }
  })
}

function uniqueFilename(usedNames: ReadonlySet<string>, filename: string): string {
  if (!usedNames.has(filename.toLocaleLowerCase())) return filename
  const stem = filename.replace(/\.pdf$/i, '')
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem} (${suffix}).pdf`
    if (!usedNames.has(candidate.toLocaleLowerCase())) return candidate
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
