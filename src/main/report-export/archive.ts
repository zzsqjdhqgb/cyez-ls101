import { zipSync } from 'fflate'

export interface ReportArchiveEntry {
  filename: string
  data: Uint8Array
}

/** PDF 自身已经压缩过，这里按存储方式打包，避免一次没有收益的 deflate。 */
export function buildReportArchive(entries: readonly ReportArchiveEntry[]): Uint8Array {
  return zipSync(Object.fromEntries(entries.map((entry) => [entry.filename, entry.data])), {
    level: 0
  })
}
