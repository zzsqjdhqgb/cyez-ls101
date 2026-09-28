import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { unzipSync } from 'fflate'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REPORT_EXPORT_CHANNELS,
  REPORT_EXPORT_EVENTS,
  type ReportExportProgress
} from '@ls101/core-types'

type IpcHandler = (event: { sender: FakeSender }, ...args: never[]) => unknown

interface FakeSender {
  destroyed: boolean
  isDestroyed(): boolean
  send(channel: string, payload: unknown): void
}

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, IpcHandler>()
  const printToPDF = vi.fn()
  const loadFile = vi.fn()
  const destroy = vi.fn()

  class BrowserWindowMock {
    static fromWebContents(): null {
      return null
    }

    webContents = {
      loadFile: (file: string) => loadFile(file),
      on: vi.fn(),
      printToPDF: (...args: unknown[]) => printToPDF(...args),
      setWindowOpenHandler: vi.fn()
    }
    isDestroyed = vi.fn(() => false)
    destroy = (): void => {
      destroy()
    }
    loadFile = (file: string): Promise<void> => loadFile(file)
  }

  return {
    BrowserWindow: BrowserWindowMock,
    destroy,
    dialog: { showSaveDialog: vi.fn() },
    handlers,
    ipcMain: {
      handle: vi.fn((channel: string, handler: IpcHandler) => handlers.set(channel, handler))
    },
    loadFile,
    printToPDF
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
  dialog: electronMocks.dialog,
  ipcMain: electronMocks.ipcMain
}))

import {
  buildReportArchive,
  exportReportBatch,
  parseReportExportRequest,
  registerReportExportHandlers,
  type PdfPrinter
} from '../../src/main/report-export'

const PDF_HEADER = new Uint8Array([0x25, 0x50, 0x44, 0x46])

let directory = ''

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'report-export-test-'))
  electronMocks.destroy.mockClear()
  electronMocks.loadFile.mockReset().mockResolvedValue(undefined)
  electronMocks.printToPDF.mockReset().mockResolvedValue(Buffer.from(PDF_HEADER))
  electronMocks.dialog.showSaveDialog.mockReset()
  registerReportExportHandlers()
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

function item(filename: string, html = '<p>report</p>'): { filename: string; html: string } {
  return { filename, html }
}

function sender(): FakeSender & { events: Array<[string, unknown]> } {
  const events: Array<[string, unknown]> = []
  return {
    destroyed: false,
    events,
    isDestroyed: () => false,
    send: (channel, payload) => events.push([channel, payload])
  }
}

function fixedPrinter(): PdfPrinter {
  return {
    print: vi.fn().mockResolvedValue(PDF_HEADER),
    dispose: vi.fn().mockResolvedValue(undefined)
  }
}

describe('parseReportExportRequest', () => {
  it('接受合法请求并原样保留文件名', () => {
    expect(parseReportExportRequest({ items: [item('张三-001-报告.pdf')] })).toEqual([
      item('张三-001-报告.pdf')
    ])
  })

  it('同批内重名文件追加序号', () => {
    const parsed = parseReportExportRequest({
      items: [item('报告.pdf'), item('报告.pdf'), item('报告.PDF')]
    })

    expect(parsed.map((entry) => entry.filename)).toEqual([
      '报告.pdf',
      '报告 (2).pdf',
      '报告 (3).pdf'
    ])
  })

  it('拒绝越界文件名与非法请求', () => {
    for (const request of [
      { items: [item('../escape.pdf')] },
      { items: [item('nested/report.pdf')] },
      { items: [item('report.txt')] },
      { items: [{ filename: 'report.pdf' }] },
      { items: 'nope' },
      null
    ]) {
      expect(() => parseReportExportRequest(request)).toThrow()
    }
  })

  it('限制单份与整批体积以及份数', () => {
    expect(() =>
      parseReportExportRequest({ items: [item('a.pdf', 'x'.repeat(16 * 1024 * 1024 + 1))] })
    ).toThrow('单份体积上限')
    expect(() =>
      parseReportExportRequest({ items: Array.from({ length: 301 }, (_, i) => item(`${i}.pdf`)) })
    ).toThrow('一次最多导出')
  })
})

describe('buildReportArchive', () => {
  it('按文件名打包 PDF', () => {
    const bytes = buildReportArchive([
      { filename: '甲.pdf', data: new Uint8Array([1, 2, 3]) },
      { filename: '乙.pdf', data: new Uint8Array([4, 5]) }
    ])

    const entries = unzipSync(bytes)
    expect(Object.keys(entries)).toHaveLength(2)
    expect(entries['甲.pdf']).toEqual(new Uint8Array([1, 2, 3]))
    expect(entries['乙.pdf']).toEqual(new Uint8Array([4, 5]))
  })
})

describe('exportReportBatch', () => {
  it('逐份打印并打包成 ZIP，同时上报进度', async () => {
    const target = join(directory, 'reports.zip')
    const printer = fixedPrinter()
    const progress: ReportExportProgress[] = []
    const result = await exportReportBatch({
      request: { items: [item('甲.pdf'), item('乙.pdf')] },
      chooseTarget: async () => target,
      notify: (value) => progress.push(value),
      createPrinter: async () => printer
    })

    expect(result).toEqual({ status: 'exported', exportedCount: 2, failures: [] })
    expect(printer.print).toHaveBeenCalledTimes(2)
    expect(printer.dispose).toHaveBeenCalledOnce()
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(target))))).toEqual([
      '甲.pdf',
      '乙.pdf'
    ])
    expect(progress[0]).toEqual({
      phase: 'printing',
      completed: 0,
      total: 2,
      current: '甲.pdf'
    })
    expect(progress.at(-1)).toEqual({ phase: 'saving', completed: 2, total: 2 })
  })

  it('单份失败不阻断整批，只打包成功的报告', async () => {
    const target = join(directory, 'partial.zip')
    const print = vi
      .fn()
      .mockResolvedValueOnce(PDF_HEADER)
      .mockRejectedValueOnce(new Error('打印超时'))
    const printer: PdfPrinter = { print, dispose: vi.fn().mockResolvedValue(undefined) }
    const result = await exportReportBatch({
      request: { items: [item('甲.pdf'), item('乙.pdf')] },
      chooseTarget: async () => target,
      notify: () => undefined,
      createPrinter: async () => printer
    })

    expect(result).toEqual({
      status: 'exported',
      exportedCount: 1,
      failures: [{ filename: '乙.pdf', reason: '打印超时' }]
    })
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(target))))).toEqual(['甲.pdf'])
  })

  it('全部失败时不写文件', async () => {
    const target = join(directory, 'none.zip')
    const printer: PdfPrinter = {
      print: vi.fn().mockRejectedValue(new Error('打印失败')),
      dispose: vi.fn().mockResolvedValue(undefined)
    }
    const result = await exportReportBatch({
      request: { items: [item('甲.pdf')] },
      chooseTarget: async () => target,
      notify: () => undefined,
      createPrinter: async () => printer
    })

    expect(result).toEqual({
      status: 'exported',
      exportedCount: 0,
      failures: [{ filename: '甲.pdf', reason: '打印失败' }]
    })
    expect(await readdir(directory)).toEqual([])
  })

  it('用户取消保存时不打印任何报告', async () => {
    const createPrinter = vi.fn()
    const result = await exportReportBatch({
      request: { items: [item('甲.pdf')] },
      chooseTarget: async () => null,
      notify: () => undefined,
      createPrinter
    })

    expect(result).toEqual({ status: 'cancelled' })
    expect(createPrinter).not.toHaveBeenCalled()
  })
})

describe('registerReportExportHandlers', () => {
  it('通过 IPC 通道导出并写入选定路径', async () => {
    const target = join(directory, 'ipc.zip')
    electronMocks.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    registerReportExportHandlers()

    const handler = electronMocks.handlers.get(REPORT_EXPORT_CHANNELS.exportBatch)
    expect(handler).toBeDefined()
    const events = sender()
    const result = await handler!(
      { sender: events } as never,
      {
        items: [item('甲.pdf'), item('乙.pdf')]
      } as never
    )

    expect(result).toEqual({ status: 'exported', exportedCount: 2, failures: [] })
    expect(Object.keys(unzipSync(new Uint8Array(await readFile(target))))).toEqual([
      '甲.pdf',
      '乙.pdf'
    ])
    expect(electronMocks.printToPDF).toHaveBeenCalledTimes(2)
    const progress = events.events
      .filter(([channel]) => channel === REPORT_EXPORT_EVENTS.progress)
      .map(([, payload]) => payload as ReportExportProgress)
    expect(progress.at(-1)).toEqual({ phase: 'saving', completed: 2, total: 2 })
  })

  it('保存对话框取消时返回取消状态', async () => {
    electronMocks.dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
    registerReportExportHandlers()

    const handler = electronMocks.handlers.get(REPORT_EXPORT_CHANNELS.exportBatch)
    const result = await handler!(
      { sender: sender() } as never,
      {
        items: [item('甲.pdf')]
      } as never
    )

    expect(result).toEqual({ status: 'cancelled' })
    expect(electronMocks.printToPDF).not.toHaveBeenCalled()
  })

  it('打印器把 HTML 写到临时文件并销毁窗口', async () => {
    const target = join(directory, 'printer.zip')
    electronMocks.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    registerReportExportHandlers()

    const handler = electronMocks.handlers.get(REPORT_EXPORT_CHANNELS.exportBatch)
    await handler!({ sender: sender() } as never, { items: [item('甲.pdf', '<p>甲</p>')] } as never)

    expect(electronMocks.loadFile).toHaveBeenCalledOnce()
    const htmlPath = electronMocks.loadFile.mock.calls[0][0] as string
    expect(htmlPath.endsWith('.html')).toBe(true)
    expect(await readFile(htmlPath, 'utf8').catch(() => null)).toBeNull()
    expect(electronMocks.printToPDF).toHaveBeenCalledWith({
      printBackground: true,
      pageSize: 'A4'
    })
    expect(electronMocks.destroy).toHaveBeenCalledOnce()
  })

  it('临时文件写入失败时按份记录失败', async () => {
    const target = join(directory, 'broken.zip')
    electronMocks.dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    electronMocks.loadFile.mockRejectedValue(new Error('页面加载失败'))
    registerReportExportHandlers()

    const handler = electronMocks.handlers.get(REPORT_EXPORT_CHANNELS.exportBatch)
    const result = await handler!(
      { sender: sender() } as never,
      {
        items: [item('甲.pdf')]
      } as never
    )

    expect(result).toEqual({
      status: 'exported',
      exportedCount: 0,
      failures: [{ filename: '甲.pdf', reason: '页面加载失败' }]
    })
  })
})

describe('report export helper guard', () => {
  it('空请求直接返回，不弹保存对话框', async () => {
    const chooseTarget = vi.fn()
    const result = await exportReportBatch({
      request: { items: [] },
      chooseTarget,
      notify: () => undefined
    })

    expect(result).toEqual({ status: 'exported', exportedCount: 0, failures: [] })
    expect(chooseTarget).not.toHaveBeenCalled()
  })

  it('写文件失败时仍然释放打印器', async () => {
    const printer = fixedPrinter()

    await expect(
      exportReportBatch({
        request: { items: [item('甲.pdf')] },
        chooseTarget: async () => join(directory, 'missing', 'x.zip'),
        notify: () => undefined,
        createPrinter: async () => printer
      })
    ).rejects.toThrow()
    expect(printer.dispose).toHaveBeenCalledOnce()
  })
})
