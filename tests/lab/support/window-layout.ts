import { expect, type ElectronApplication, type Page } from '@playwright/test'

/** Compare the renderer with Electron's content area, not an emulated browser viewport. */
export async function expectNativeViewport(app: ElectronApplication, page: Page): Promise<void> {
  const window = await app.browserWindow(page)
  try {
    await expect
      .poll(
        async () => {
          const [width, height] = await window.evaluate((window) => window.getContentSize())
          const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }))
          return {
            widthDifference: viewport.width - width,
            heightDifference: viewport.height - height,
            hasArea: width > 0 && height > 0
          }
        },
        { message: 'Renderer viewport must track the native Electron content area' }
      )
      .toEqual({ widthDifference: 0, heightDifference: 0, hasArea: true })
  } finally {
    await window.dispose()
  }
}

/** setViewportSize enables persistent CDP emulation and breaks subsequent native fullscreen. */
export async function resizeNativeWindow(
  app: ElectronApplication,
  page: Page,
  width: number,
  height: number
): Promise<void> {
  const window = await app.browserWindow(page)
  try {
    await window.evaluate((window, size) => window.setContentSize(size.width, size.height), {
      width,
      height
    })
  } finally {
    await window.dispose()
  }
  await expectNativeViewport(app, page)
}
