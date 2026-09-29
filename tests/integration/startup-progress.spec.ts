import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  APPLICATION_STARTUP_TIMEOUT,
  closeStartupReleaseNotes,
  launchIntegrationApp
} from './support/electron-app'

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

  await expect(page.getByRole('dialog', { name: '曹二听说101 v0.4.1' })).toBeVisible({
    timeout: APPLICATION_STARTUP_TIMEOUT
  })
  const elapsed = await page.evaluate(() => performance.now())
  expect(elapsed).toBeGreaterThanOrEqual(2_400)
  const startupMilestones = await page.evaluate(() =>
    performance
      .getEntriesByType('mark')
      .filter((entry) => entry.name.startsWith('ls101-startup:'))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime }))
  )
  const expectedMilestones = [
    'ls101-startup:document-script-started',
    'ls101-startup:startup-logo-ready',
    'ls101-startup:application-bundle-requested',
    'ls101-startup:application-bundle-loaded',
    'ls101-startup:main-process-ready',
    'ls101-startup:main-interface-render-requested',
    'ls101-startup:main-interface-first-frame'
  ]
  for (const expectedMilestone of expectedMilestones) {
    expect(startupMilestones.filter(({ name }) => name === expectedMilestone)).toHaveLength(1)
  }
  expect(
    startupMilestones.map(({ name }) => name).filter((name) => expectedMilestones.includes(name))
  ).toEqual(expectedMilestones)
  expect(
    startupMilestones.every(
      (entry, index) => index === 0 || entry.startTime >= startupMilestones[index - 1]!.startTime
    )
  ).toBe(true)
})

test('shows an animated progress indicator while application initialization is pending', async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-startup-progress-'))
  electronApp = await launchIntegrationApp(userDataDir, {
    environment: { LS101_INTEGRATION_STARTUP_DELAY_MS: '4000' }
  })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  await expect(page.getByLabel('曹二听说101 正在启动')).toBeVisible()
  await expect
    .poll(() =>
      electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible())
    )
    .toBe(true)
  expect(
    await page.evaluate(async () => {
      const readiness = window.startup!.whenReady().then(() => 'ready')
      return Promise.race([
        readiness,
        new Promise<'pending'>((resolve) => window.setTimeout(() => resolve('pending'), 100))
      ])
    })
  ).toBe('pending')

  const progress = page.getByRole('progressbar', { name: '正在加载' })
  await expect(progress).toBeAttached()

  // 用 Web Animations 时间轴验证两条动画，而不是按墙钟等满 2.5s 延迟：
  // CI 上渲染进程会被并行用例抢占，实时等待会随机失败。
  const animations = await progress.evaluate((element) => {
    const entries = element.ownerDocument.getAnimations()
    const reveal = entries.find((entry) => entry.animationName === 'startup-progress-reveal')
    const marquee = entries.find((entry) => entry.animationName === 'startup-progress')
    const readOpacity = (time: number): string | null => {
      if (!reveal) return null
      reveal.pause()
      reveal.currentTime = time
      return getComputedStyle(element).opacity
    }
    const readTransform = (time: number): string | null => {
      if (!marquee) return null
      marquee.pause()
      marquee.currentTime = time
      return getComputedStyle(element, '::after').transform
    }
    return {
      revealDelay: reveal?.effect?.getTiming().delay ?? null,
      hiddenOpacity: readOpacity(0),
      revealedOpacity: readOpacity(2_600),
      marqueeIterations: marquee?.effect?.getTiming().iterations ?? null,
      marqueeMoved: readTransform(0) !== readTransform(500)
    }
  })

  expect(animations).toEqual({
    revealDelay: 2_500,
    hiddenOpacity: '0',
    revealedOpacity: '1',
    marqueeIterations: Number.POSITIVE_INFINITY,
    marqueeMoved: true
  })

  await closeStartupReleaseNotes(page)
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
})
