import { expect, type ElectronApplication } from '@playwright/test'
import {
  APPLICATION_STARTUP_TIMEOUT,
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
  try {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const workbench = page.getByRole('heading', { level: 1, name: '工作台' })
    const closeReleaseNotes = page.getByRole('button', { name: '关闭版本说明' })
    await expect(closeReleaseNotes.or(workbench)).toBeVisible({
      timeout: APPLICATION_STARTUP_TIMEOUT
    })

    if (await closeReleaseNotes.isVisible()) await closeReleaseNotes.click()
    await expect(workbench).toBeVisible({ timeout: APPLICATION_STARTUP_TIMEOUT })
    return electronApp
  } catch (error) {
    await electronApp.close().catch(() => undefined)
    throw error
  }
}
