import { join } from 'node:path'
import { app } from 'electron'
import { startLabDesktop, type DesktopOptions } from '@ls101/lab-desktop-host/desktop'
import { localServiceHost } from './local-service'

export interface TeacherDesktopOptions {
  releaseVersion: string
  preload?: string
  renderer?: string
  /** Test hosts inject a fixture; the product uses the elevated local service helper. */
  localService?: DesktopOptions['localService']
}

/**
 * Single source of truth for the lab teacher window: the product entry
 * (apps/lab-teacher/main/index.ts) and the Playwright test host
 * (tests/lab/teacher-local-entry.ts) both start the desktop through here, so window options
 * cannot drift apart. Test hosts override the paths because they are bundled elsewhere.
 */
export function startTeacherDesktop(options: TeacherDesktopOptions): void {
  startLabDesktop({
    role: 'teacher',
    frameless: true,
    preload: options.preload ?? join(__dirname, '../preload/index.js'),
    renderer: options.renderer ?? join(__dirname, '../renderer/index.html'),
    developmentUrl: process.env.ELECTRON_RENDERER_URL,
    releaseVersion: options.releaseVersion,
    localService:
      options.localService ??
      localServiceHost(
        app.isPackaged
          ? join(process.resourcesPath, 'lab-server')
          : join(__dirname, '../../lab-server')
      )
  })
}
