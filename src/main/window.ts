import { app, BrowserWindow, Menu, shell } from 'electron'
import { join } from 'node:path'
import type { Logger } from '@ls101/logger/main'
import { bindWindowControlEvents } from './window-controls'

const DEVELOPMENT_RENDERER_URL = process.env['ELECTRON_RENDERER_URL']

type LoggerSource = Logger | (() => Logger | null)
export type MainWindowLifecycleEvent =
  | 'renderer-dom-ready'
  | 'ready-to-show'
  | 'shown'
  | 'destroyed-before-shown'
  | 'load-failed-before-shown'

export function createMainWindow(
  logger?: LoggerSource,
  onLifecycleEvent?: (event: MainWindowLifecycleEvent) => void
): BrowserWindow {
  const getLogger = typeof logger === 'function' ? logger : () => logger ?? null
  Menu.setApplicationMenu(null)

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 760,
    minHeight: 560,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    title: '曹二听说101',
    backgroundColor: '#ffffff',
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'resources', 'icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  bindWindowControlEvents(window)

  let startupTerminated = false
  let shownEmitted = false
  const emitShown = (): void => {
    if (shownEmitted || startupTerminated) return
    shownEmitted = true
    onLifecycleEvent?.('shown')
  }

  window.webContents.once('dom-ready', () => {
    onLifecycleEvent?.('renderer-dom-ready')
    setImmediate(() => {
      if (startupTerminated) return
      if (window.isDestroyed()) {
        startupTerminated = true
        onLifecycleEvent?.('destroyed-before-shown')
        return
      }
      if (!window.isVisible()) window.show()
      emitShown()
      getLogger()?.info('Main window shown after renderer DOM ready')
    })
  })

  window.once('ready-to-show', () => {
    onLifecycleEvent?.('ready-to-show')
  })

  window.once('closed', () => {
    if (shownEmitted || startupTerminated) return
    startupTerminated = true
    onLifecycleEvent?.('destroyed-before-shown')
  })

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      getLogger()?.error('Renderer failed to load', undefined, {
        errorCode,
        errorDescription,
        validatedURL
      })
      if (isMainFrame && !shownEmitted && !startupTerminated) {
        startupTerminated = true
        onLifecycleEvent?.('load-failed-before-shown')
      }
    }
  )

  window.webContents.on('render-process-gone', (_event, details) => {
    getLogger()?.error('Renderer process exited', undefined, {
      reason: details.reason,
      exitCode: details.exitCode
    })
  })

  window.on('unresponsive', () => getLogger()?.warn('Main window became unresponsive'))
  window.on('responsive', () => getLogger()?.info('Main window became responsive'))

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (currentUrl && url !== currentUrl) {
      event.preventDefault()
    }
  })

  if (DEVELOPMENT_RENDERER_URL) {
    void window.loadURL(DEVELOPMENT_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
