import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron'
import {
  REPORT_EXPORT_CHANNELS,
  REPORT_EXPORT_EVENTS,
  type ReportExportProgress
} from '@ls101/core-types'
import { exportReportBatch, exportSingleReport } from './service'

let registered = false

export function registerReportExportHandlers(): void {
  if (registered) return
  registered = true
  ipcMain.handle(REPORT_EXPORT_CHANNELS.exportBatch, (event, request: unknown) =>
    exportReportBatch({
      request,
      chooseTarget: () => chooseArchiveTarget(event.sender),
      notify: (progress) => sendProgress(event.sender, progress)
    })
  )
  ipcMain.handle(REPORT_EXPORT_CHANNELS.exportSingle, (event, item: unknown) =>
    exportSingleReport({
      request: item,
      chooseTarget: (defaultName) => choosePdfTarget(event.sender, defaultName)
    })
  )
}

async function chooseArchiveTarget(sender: WebContents): Promise<string | null> {
  const options = {
    title: '导出作答报告',
    defaultPath: `作答报告-${new Date().toISOString().slice(0, 10)}.zip`,
    filters: [{ name: 'ZIP 压缩包', extensions: ['zip'] }]
  }
  return chooseTarget(sender, options)
}

async function choosePdfTarget(sender: WebContents, defaultName: string): Promise<string | null> {
  const options = {
    title: '导出作答报告',
    defaultPath: defaultName,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
  }
  return chooseTarget(sender, options)
}

async function chooseTarget(
  sender: WebContents,
  options: {
    title: string
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
  }
): Promise<string | null> {
  const parent = BrowserWindow.fromWebContents(sender)
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  return result.canceled || !result.filePath ? null : result.filePath
}

function sendProgress(sender: WebContents, progress: ReportExportProgress): void {
  if (!sender.isDestroyed()) sender.send(REPORT_EXPORT_EVENTS.progress, progress)
}
