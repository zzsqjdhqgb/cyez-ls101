import { expect, test } from '@playwright/test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  captureFigure,
  launchFigureApp,
  normalizeEnvironmentArtifacts,
  prepareManualUserDataDir
} from '../support/manual-app'

test('FIG-ACTIVATION 激活界面 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir, {
    license: 'not-activated',
    closeReleaseNotes: false
  })
  try {
    await expect(page.getByRole('heading', { name: '激活曹二听说101' })).toBeVisible()
    await expect(page.getByLabel('邀请码')).toBeVisible()

    const file = await captureFigure(page, 'FIG-ACTIVATION')
    expect(file).toContain(path.join('FIG-ACTIVATION', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-RELEASE-NOTES 版本说明对话框 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir, { closeReleaseNotes: false })
  try {
    const dialog = page.getByRole('dialog', { name: /^曹二听说101 v\d+\.\d+\.\d+$/ })
    await expect(dialog).toBeVisible()
    await expect(page.getByText(/^已安装 /)).toBeVisible()
    await normalizeEnvironmentArtifacts(page)

    const file = await captureFigure(page, 'FIG-RELEASE-NOTES')
    expect(file).toContain(path.join('FIG-RELEASE-NOTES', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-LEGACY-ARCHIVE 旧数据归档提示 · 默认态', async () => {
  const userDataDir = await prepareManualUserDataDir()
  // 旧版本数据目录：与集成测试使用相同的识别方式（version 标记 + 旧业务目录）。
  await writeFile(path.join(userDataDir, 'version'), '0.3.2')
  await mkdir(path.join(userDataDir, 'drafts'), { recursive: true })
  await writeFile(path.join(userDataDir, 'drafts', 'kept-draft.json'), '{"legacy":true}')

  const { app, page } = await launchFigureApp(userDataDir, { closeReleaseNotes: false })
  try {
    await expect(page.getByRole('heading', { name: '旧数据已归档' })).toBeVisible()

    const file = await captureFigure(page, 'FIG-LEGACY-ARCHIVE')
    expect(file).toContain(path.join('FIG-LEGACY-ARCHIVE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
