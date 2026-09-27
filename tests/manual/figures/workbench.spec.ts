import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

test('FIG-WORKBENCH 工作台 · 空态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '最近工作' })).toBeVisible()
    await expect(page.getByText('还没有最近工作')).toBeVisible()

    const file = await captureFigure(page, 'FIG-WORKBENCH', 'empty')
    expect(file).toContain(path.join('FIG-WORKBENCH', 'empty.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
