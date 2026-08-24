import type { ElectronApplication } from '@playwright/test'
import {
  closeStartupReleaseNotes,
  launchIntegrationApp
} from '../../integration/support/electron-app'

const PRODUCT_DOCS_CONTENT_SIZE = { width: 1280, height: 800 } as const

export async function launchProductDocsApp(userDataDir: string): Promise<ElectronApplication> {
  const electronApp = await launchIntegrationApp(userDataDir, {
    contentSize: PRODUCT_DOCS_CONTENT_SIZE,
    deviceScaleFactor: 1,
    extraArgs: ['--disable-gpu'],
    randomSeed: 1
  })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await closeStartupReleaseNotes(page)
  return electronApp
}
