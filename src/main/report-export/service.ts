import { writeFile } from 'node:fs/promises'
import {
  type ReportExportFailure,
  type ReportExportProgress,
  type ReportExportResult
} from '@ls101/core-types'
import { buildReportArchive, type ReportArchiveEntry } from './archive'
import { createPdfPrinter, type PdfPrinter } from './printer'
import { parseReportExportRequest } from './validation'

export interface ExportReportBatchOptions {
  /** 渲染层传来的原始请求，由本模块校验 */
  request: unknown
  /** 选择 ZIP 落盘位置；返回 null 表示用户取消 */
  chooseTarget(): Promise<string | null>
  /** 进度上报；默认实现是发给发起请求的渲染进程 */
  notify(progress: ReportExportProgress): void
  /** 测试可注入打印器；默认使用隐藏窗口打印 */
  createPrinter?: () => Promise<PdfPrinter>
}

/**
 * 批量导出报告：逐份打印 PDF，全部成功后打包成一个 ZIP 写到用户选定位置。
 * 单份失败不阻断整批，失败原因随结果返回。
 */
export async function exportReportBatch(
  options: ExportReportBatchOptions
): Promise<ReportExportResult> {
  const items = parseReportExportRequest(options.request)
  if (items.length === 0) return { status: 'exported', exportedCount: 0, failures: [] }

  const target = await options.chooseTarget()
  if (!target) return { status: 'cancelled' }

  const print = options.createPrinter ?? createPdfPrinter
  const printer = await print()
  try {
    const entries: ReportArchiveEntry[] = []
    const failures: ReportExportFailure[] = []
    for (const [index, item] of items.entries()) {
      options.notify({
        phase: 'printing',
        completed: index,
        total: items.length,
        current: item.filename
      })
      try {
        entries.push({ filename: item.filename, data: await printer.print(item.html) })
      } catch (error) {
        failures.push({ filename: item.filename, reason: describeError(error) })
      }
      options.notify({ phase: 'printing', completed: index + 1, total: items.length })
    }

    if (entries.length > 0) {
      options.notify({ phase: 'saving', completed: items.length, total: items.length })
      await writeFile(target, buildReportArchive(entries))
    }
    return { status: 'exported', exportedCount: entries.length, failures }
  } finally {
    await printer.dispose()
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return '报告打印失败'
}
