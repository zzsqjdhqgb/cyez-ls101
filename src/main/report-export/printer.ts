import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'

/** 单份报告打印超时；超时按该份失败处理，不拖住整批。 */
const PRINT_TIMEOUT_MS = 30_000
const PRINT_OPTIONS = { printBackground: true, pageSize: 'A4' } as const

export interface PdfPrinter {
  /** 把一份自包含 HTML 打印成 PDF；失败时抛错，由调用方按份记录。 */
  print(html: string): Promise<Uint8Array>
  dispose(): Promise<void>
}

/**
 * 报告 PDF 打印器：复用同一个隐藏窗口逐份打印。
 * 窗口只加载本地生成的静态 HTML：禁用 JS、无 preload、沙箱开启，并拒绝一切导航。
 */
export async function createPdfPrinter(): Promise<PdfPrinter> {
  const directory = await mkdtemp(join(tmpdir(), 'ls101-report-'))
  const window = createPrintWindow()
  let sequence = 0

  return {
    async print(html: string): Promise<Uint8Array> {
      const file = join(directory, `report-${sequence}.html`)
      sequence += 1
      await writeFile(file, html, 'utf8')
      await window.loadFile(file)
      const pdf = await withTimeout(
        window.webContents.printToPDF({ ...PRINT_OPTIONS }),
        PRINT_TIMEOUT_MS
      )
      return new Uint8Array(pdf)
    },
    async dispose(): Promise<void> {
      if (!window.isDestroyed()) window.destroy()
      await rm(directory, { recursive: true, force: true })
    }
  }
}

function createPrintWindow(): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: 1024,
    height: 768,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      javascript: false,
      spellcheck: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  return window
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('报告打印超时')), timeoutMs)
    operation.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    )
  })
}
