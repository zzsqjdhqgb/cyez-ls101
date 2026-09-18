import { expect, type ElectronApplication } from '@playwright/test'
import {
  APPLICATION_STARTUP_TIMEOUT,
  launchIntegrationApp
} from '../../integration/support/electron-app'

const PRODUCT_DOCS_CONTENT_SIZE = { width: 1280, height: 800 } as const
const PRODUCT_DOCS_STARTUP_TIMEOUT =
  process.platform === 'win32' ? 45_000 : APPLICATION_STARTUP_TIMEOUT

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
    const startupError = page.getByRole('heading', { level: 1, name: '应用初始化失败' })
    await expect(closeReleaseNotes.or(workbench).or(startupError)).toBeVisible({
      timeout: PRODUCT_DOCS_STARTUP_TIMEOUT
    })

    if (await startupError.isVisible()) {
      throw new Error(await page.getByRole('alert').innerText())
    }
    if (await closeReleaseNotes.isVisible()) await closeReleaseNotes.click()
    await expect(workbench).toBeVisible({ timeout: PRODUCT_DOCS_STARTUP_TIMEOUT })
    return electronApp
  } catch (error) {
    await electronApp.close().catch(() => undefined)
    throw error
  }
}
