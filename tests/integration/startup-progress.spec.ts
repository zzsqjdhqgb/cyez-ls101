import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { closeStartupReleaseNotes, launchIntegrationApp } from './support/electron-app'

let electronApp: ElectronApplication
let userDataDir: string

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
})

test('keeps the startup animation visible for its full animation and settle delay', async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-startup-minimum-duration-'))
  electronApp = await launchIntegrationApp(userDataDir)
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByRole('dialog', { name: '曹二听说101 v0.4.0' })).toBeVisible()
  const elapsed = await page.evaluate(() => performance.now())
  expect(elapsed).toBeGreaterThanOrEqual(2_400)
  const startupMilestones = await page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .map((entry) => entry.name)
      .filter((name) => name.startsWith('ls101-startup:'))
  )
  expect(startupMilestones).toEqual(
    expect.arrayContaining([
      'ls101-startup:document-script-started',
      'ls101-startup:startup-logo-ready',
      'ls101-startup:application-bundle-requested',
      'ls101-startup:application-bundle-loaded',
      'ls101-startup:main-process-ready',
      'ls101-startup:main-interface-render-requested',
      'ls101-startup:main-interface-first-frame'
    ])
  )
})

test('shows an animated progress indicator while application initialization is pending', async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-startup-progress-'))
  electronApp = await launchIntegrationApp(userDataDir, {
    environment: { LS101_INTEGRATION_STARTUP_DELAY_MS: '4000' }
  })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  const progress = page.getByRole('progressbar', { name: '正在加载' })
  await expect(progress).toBeAttached()
  await expect
    .poll(() =>
      progress.evaluate((element) => ({
        opacity: getComputedStyle(element).opacity,
        revealDelay: getComputedStyle(element).animationDelay
      }))
    )
    .toEqual({ opacity: '0', revealDelay: '2.5s' })
  await expect
    .poll(() => progress.evaluate((element) => getComputedStyle(element).opacity), {
      timeout: 3_000
    })
    .toBe('1')
  const initialTransform = await progress.evaluate(
    (element) => getComputedStyle(element, '::after').transform
  )
  await expect
    .poll(() => progress.evaluate((element) => getComputedStyle(element, '::after').transform))
    .not.toBe(initialTransform)

  await closeStartupReleaseNotes(page)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})
