/**
 * 报告导出契约：渲染层把报告渲染成自包含 HTML，主进程只负责打印、打包和保存。
 * 主进程不理解报告内容，因此这里只描述"文档 + 文件名"以及导出进度。
 */

/** 一份待打印的报告文档；HTML 必须自包含（图片内联为 data URL，不依赖外部资源）。 */
export interface ReportExportItem {
  /** 输出 PDF 的文件名，主进程会校验、去重 */
  filename: string
  html: string
}

export interface ReportExportRequest {
  items: ReportExportItem[]
}

export type ReportExportPhase = 'printing' | 'saving'

export interface ReportExportProgress {
  phase: ReportExportPhase
  /** 已处理完的份数 */
  completed: number
  total: number
  /** 正在打印的文件名；仅 printing 阶段提供 */
  current?: string
}

/** 单份报告失败不阻断整批导出，逐份汇报原因。 */
export interface ReportExportFailure {
  filename: string
  reason: string
}

export type ReportExportResult =
  | { status: 'exported'; exportedCount: number; failures: ReportExportFailure[] }
  | { status: 'cancelled' }

/** 单份导出直接产出 PDF；打印或写入失败时给出原因而不是丢弃用户操作。 */
export type ReportExportSingleResult =
  | { status: 'exported' }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string }

export const REPORT_EXPORT_CHANNELS = {
  exportBatch: 'report-export:export-batch',
  exportSingle: 'report-export:export-single'
} as const

export const REPORT_EXPORT_EVENTS = {
  progress: 'report-export:progress'
} as const

export interface ReportExportBridge {
  exportBatch(request: ReportExportRequest): Promise<ReportExportResult>
  exportSingle(item: ReportExportItem): Promise<ReportExportSingleResult>
  onProgress(listener: (progress: ReportExportProgress) => void): () => void
}
