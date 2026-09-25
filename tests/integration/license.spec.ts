import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  closeStartupReleaseNotes,
  INTEGRATION_LICENSE_CODE,
  INTEGRATION_LICENSE_CODE_HASH,
  launchIntegrationApp
} from './support/electron-app'

test('activates with an invitation code and reuses the hash receipt after restart', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-license-'))
  let electronApp: ElectronApplication | undefined
  const pageErrors: string[] = []

  try {
    await writeFile(path.join(userDataDir, 'version'), '0.3.2')
    await mkdir(path.join(userDataDir, 'drafts'))
    await writeFile(path.join(userDataDir, 'drafts', 'before-license.json'), '{"legacy":true}')
    electronApp = await launchIntegrationApp(userDataDir, { license: 'not-activated' })
    let page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: '激活曹二听说101' })).toBeVisible()
    await expect(page.getByRole('button', { name: '参与激活方式意见征集' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toHaveCount(0)
    await expect(
      readFile(path.join(userDataDir, 'legacy-migration.json'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      readFile(path.join(userDataDir, '.ls101-installation.json'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })

    const guideWindowPromise = electronApp.waitForEvent('window')
    await page.getByRole('button', { name: '参与激活方式意见征集' }).click()
    const guideWindow = await guideWindowPromise
    await guideWindow.waitForLoadState('domcontentloaded')
    await expect(
      guideWindow.getByRole('heading', { name: '一起选出更方便的软件激活方式' })
    ).toBeVisible()
    await expect.poll(() => guideWindow.title()).toBe('软件激活方式意见征集')
    const surveyLinks = guideWindow.getByRole('link', { name: '打开问卷' })
    await expect(surveyLinks).toHaveCount(2)
    await expect(surveyLinks.first()).toHaveAttribute(
      'href',
      'https://forms.cloud.microsoft/r/QJw61zh8dn'
    )
    await expect(surveyLinks.last()).toHaveAttribute(
      'href',
      'https://forms.cloud.microsoft/r/QJw61zh8dn'
    )
    const guideUrl = guideWindow.url()
    await expect(guideWindow.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
      'content',
      /default-src 'none'/
    )
    const blockedUrls = [
      'https://example.com/constructed-link',
      page.url(),
      'asset://local/integration/constructed-link'
    ]
    for (const blockedUrl of blockedUrls) {
      await guideWindow.evaluate((url) => {
        const link = document.createElement('a')
        link.href = url
        document.body.append(link)
        link.click()
      }, blockedUrl)
      await expect.poll(() => guideWindow.url()).toBe(guideUrl)
    }
    await guideWindow.close()

    await page.getByLabel('邀请码').fill('not-the-code')
    await page.getByRole('button', { name: '激活并进入' }).click()
    await expect(page.getByRole('alert')).toHaveText('邀请码不正确，请检查后重试。')

    await page.getByLabel('邀请码').fill(`  ${INTEGRATION_LICENSE_CODE.toLowerCase()}  `)
    await page.getByRole('button', { name: '激活并进入' }).click()
    await expect(page.getByRole('heading', { name: '旧数据已归档' })).toBeVisible()
    await expect(
      readFile(path.join(userDataDir, 'legacy-migration.json'), 'utf8')
    ).resolves.toContain('"state": "archived"')
    await expect(
      readFile(path.join(userDataDir, '.ls101-installation.json'), 'utf8')
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await page.getByRole('button', { name: '清理并继续' }).click()
    await closeStartupReleaseNotes(page)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()

    const installationMarker = JSON.parse(
      await readFile(path.join(userDataDir, '.ls101-installation.json'), 'utf8')
    ) as Record<string, unknown>
    expect(installationMarker).toMatchObject({
      kind: 'ls101-installation',
      formatVersion: 1,
      firstAppVersion: expect.stringContaining('0.4.1'),
      lastAppVersion: expect.stringContaining('0.4.1')
    })

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

test('deactivates from settings, removes the receipt and requires activation after restart', async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-license-deactivate-'))
  const receiptPath = path.join(userDataDir, 'license.json')
  let electronApp: ElectronApplication | undefined
  const pageErrors: string[] = []

  try {
    electronApp = await launchIntegrationApp(userDataDir, {
      environment: { LS101_DISABLE_AUTO_RELAUNCH: '1' }
    })
    let page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await closeStartupReleaseNotes(page)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(readFile(receiptPath, 'utf8')).resolves.toContain(INTEGRATION_LICENSE_CODE_HASH)

    await page.getByRole('link', { name: '设置' }).click()
    await page.getByRole('button', { name: /^许可/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: '许可' })).toBeVisible()
    await expect(page.getByText('当前软件已激活。')).toBeVisible()

    const guideWindowPromise = electronApp.waitForEvent('window')
    await page.getByRole('button', { name: '参与意见征集' }).click()
    const guideWindow = await guideWindowPromise
    await guideWindow.waitForLoadState('domcontentloaded')
    await expect.poll(() => guideWindow.title()).toBe('软件激活方式意见征集')
    await guideWindow.close()
    await expect(readFile(receiptPath, 'utf8')).resolves.toContain(INTEGRATION_LICENSE_CODE_HASH)

    await page.getByRole('button', { name: '取消激活', exact: true }).click()
    await expect(page.getByRole('heading', { name: '取消激活？' })).toBeVisible()
    await expect(
      page.getByText(
        '当前设备上的激活信息将被删除，软件随后重新启动。再次使用时需要输入邀请码，其他软件数据不会被删除。'
      )
    ).toBeVisible()
    await page.getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.getByRole('heading', { name: '取消激活？' })).toHaveCount(0)
    await expect(readFile(receiptPath, 'utf8')).resolves.toContain(INTEGRATION_LICENSE_CODE_HASH)

    const closePromise = electronApp.waitForEvent('close')
    await page.getByRole('button', { name: '取消激活', exact: true }).click()
    await page.getByRole('button', { name: '取消激活并重启', exact: true }).click()
    await closePromise
    electronApp = undefined
    await expect(readFile(receiptPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    electronApp = await launchIntegrationApp(userDataDir, { license: 'not-activated' })
    page = await electronApp.firstWindow()
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByRole('heading', { name: '激活曹二听说101' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toHaveCount(0)
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
    await expect(page.getByRole('button', { name: '参与激活方式意见征集' })).toBeVisible()
    await expect(page.getByLabel('邀请码')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { force: true, recursive: true })
  }
})
