import { expect, test } from '@playwright/test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { captureState, launchVisualApp } from '../support/visual-app'

test('UI-OV-02 旧数据迁移 · 已归档待清理态', async () => {
  test.setTimeout(90_000)
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ls101-visual-'))
  // 夹具：旧版版本标记 + 一个旧版本业务数据目录，触发启动时的旧数据整理流程。
  await writeFile(path.join(userDataDir, 'version'), '0.3.2\n', 'utf8')
  await mkdir(path.join(userDataDir, 'drafts'), { recursive: true })
  await writeFile(
    path.join(userDataDir, 'drafts', 'legacy-draft.json'),
    `${JSON.stringify({ legacy: true })}\n`,
    'utf8'
  )

  const { app, page } = await launchVisualApp(userDataDir, { closeReleaseNotes: false })
  try {
    await expect(page.getByRole('button', { name: '清理并继续' })).toBeVisible({
      timeout: 60_000
    })
    await expect(page.getByRole('button', { name: '导出旧数据' })).toBeVisible()

    const file = await captureState(page, 'UI-OV-02', 'default')
    expect(file).toContain(path.join('UI-OV-02', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
