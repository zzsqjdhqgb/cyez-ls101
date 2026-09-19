import { expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp } from '../support/visual-app'

test('UI-OV-01 许可激活 · 未激活默认态', async () => {
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  const { app, page } = await launchVisualApp(userDataDir, {
    license: 'not-activated',
    closeReleaseNotes: false
  })
  try {
    await expect(page.getByLabel('邀请码')).toBeVisible()
    await expect(page.getByRole('button', { name: '激活并进入' })).toBeVisible()

    const file = await captureState(page, 'UI-OV-01', 'default')
    expect(file).toContain(path.join('UI-OV-01', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
