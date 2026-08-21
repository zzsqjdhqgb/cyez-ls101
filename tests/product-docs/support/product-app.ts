import type { ElectronApplication } from '@playwright/test'
import { launchIntegrationApp } from '../../integration/support/electron-app'

const PRODUCT_DOCS_CONTENT_SIZE = { width: 1280, height: 800 } as const

export function launchProductDocsApp(userDataDir: string): Promise<ElectronApplication> {
  return launchIntegrationApp(userDataDir, {
    contentSize: PRODUCT_DOCS_CONTENT_SIZE,
    deviceScaleFactor: 1,
    extraArgs: ['--disable-gpu'],
    randomSeed: 1
  })
}
