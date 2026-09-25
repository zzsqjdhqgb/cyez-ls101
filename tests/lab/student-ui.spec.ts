import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { INVITATION_CODE_HASH } from '../../packages/license/src/index'
import { resizeNativeWindow } from './support/window-layout'

for (const activated of [false, true]) {
  test(`student shared startup and ${activated ? 'enrollment' : 'activation'} gate`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'ls101-student-ui-'))
    const userData = join(root, 'student')
    const data = `${userData}-lab-student`
    if (activated) {
      await mkdir(data, { recursive: true })
      await writeFile(
        join(data, 'license.json'),
        JSON.stringify({
          schemaVersion: 1,
          invitationCodeHash: INVITATION_CODE_HASH,
          activatedAt: new Date().toISOString()
        })
      )
    }
    const env = { ...process.env }
    delete env.ELECTRON_RENDERER_URL
    const app = await electron.launch({
      args: [
        resolve('out/lab-student/main/index.js'),
        '--no-sandbox',
        '--password-store=basic',
        `--user-data-dir=${userData}`
      ],
      env
    })
    try {
      const page = await app.firstWindow()
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      await expect(
        page.getByRole('heading', { name: activated ? '等待入网' : '激活学生端', exact: true })
      ).toBeVisible()
      await expect(page.getByRole('button', { name: '最小化', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: '最大化', exact: true })).toBeEnabled()
      await expect(page.getByRole('navigation', { name: '主导航' })).toHaveCount(0)
      expect(
        await page.evaluate(
          () => performance.getEntriesByName('ls101-startup:startup-logo-ready').length
        )
      ).toBeGreaterThan(0)
      if (!activated) {
        await expect(page.getByRole('button', { name: '激活', exact: true })).toBeDisabled()
        await page.getByLabel('激活码', { exact: true }).fill('invalid-code')
        await page.getByRole('button', { name: '激活', exact: true }).click()
        await expect(page.getByRole('alert')).toContainText('激活码无效')
      } else {
        // The manual enrollment gate is what an unbound and already activated machine shows: both
        // fields start empty, so the submission stays disabled until an operator supplies them, and
        // the picker is opened by the themed button rather than by the native file control.
        await expect(page.getByRole('heading', { name: '手动入网', exact: true })).toBeVisible()
        await expect(page.getByLabel('入网文件', { exact: true })).toBeAttached()
        await expect(page.getByLabel('服务器公钥指纹', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '选择文件', exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '入网', exact: true })).toBeDisabled()
        const picker = page.waitForEvent('filechooser')
        await page.getByRole('button', { name: '选择文件', exact: true }).click()
        await (
          await picker
        ).setFiles({
          name: 'lab.lsjoin',
          mimeType: 'application/x-ls101-enrollment',
          buffer: Buffer.from('header.payload.signature')
        })
        await expect(page.getByText('已选择：lab.lsjoin', { exact: true })).toBeVisible()
        await expect(page.getByRole('button', { name: '重新选择', exact: true })).toBeVisible()
        await page.getByLabel('服务器公钥指纹', { exact: true }).fill('sha256:abc')
        await expect(page.getByRole('button', { name: '入网', exact: true })).toBeEnabled()
      }
      await page.screenshot({
        path: `test-results/lab/student-${activated ? 'unbound' : 'activation'}.png`
      })
      await resizeNativeWindow(app, page, 760, 640)
      await expect(page.getByRole('button', { name: '关闭', exact: true })).toBeInViewport()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).toBe(true)
      await page.screenshot({
        path: `test-results/lab/student-${activated ? 'unbound' : 'activation'}-narrow.png`
      })
      expect(errors).toEqual([])
      await Promise.all([
        page.waitForEvent('close'),
        page.getByRole('button', { name: '关闭', exact: true }).click()
      ])
    } finally {
      await app.close()
      await rm(root, { recursive: true, force: true })
    }
  })
}
