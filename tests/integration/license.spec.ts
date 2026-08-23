import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  INTEGRATION_LICENSE_CODE,
  INTEGRATION_LICENSE_CODE_HASH,
  launchIntegrationApp
} from './support/electron-app'

test('activates with an invitation code and reuses the hash receipt after restart', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-license-'))
  let electronApp: ElectronApplication | undefined
  const pageErrors: string[] = []

  try {
    electronApp = await launchIntegrationApp(userDataDir, { license: 'not-activated' })
    let page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: '激活曹二听说101' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toHaveCount(0)

    await page.getByLabel('邀请码').fill('not-the-code')
    await page.getByRole('button', { name: '激活并进入' }).click()
    await expect(page.getByRole('alert')).toHaveText('邀请码不正确，请检查后重试。')

    await page.getByLabel('邀请码').fill(`  ${INTEGRATION_LICENSE_CODE.toLowerCase()}  `)
    await page.getByRole('button', { name: '激活并进入' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()

    const receipt = await readFile(path.join(userDataDir, 'license.json'), 'utf8')
    expect(receipt).toContain(INTEGRATION_LICENSE_CODE_HASH)
    expect(receipt.toLowerCase()).not.toContain(INTEGRATION_LICENSE_CODE.toLowerCase())

    await electronApp.close()
    electronApp = await launchIntegrationApp(userDataDir, { license: 'not-activated' })
    page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '激活曹二听说101' })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp?.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
  }
})

test('blocks activation and application access after the license deadline', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-license-expired-'))
  const electronApp = await launchIntegrationApp(userDataDir, {
    environment: { LS101_LICENSE_TEST_NOW: '2026-10-01T16:00:00.000Z' },
    license: 'not-activated'
  })
  const pageErrors: string[] = []

  try {
    const page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: '使用权限已到期' })).toBeVisible()
    await expect(page.getByText(/2026年10月1日 23:59/)).toBeVisible()
    await expect(page.getByLabel('邀请码')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
  }
})
