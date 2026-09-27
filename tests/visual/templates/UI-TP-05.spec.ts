import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { visualGenerationTemplate } from '../support/fixtures'
import { seedFileStoreText, seedSpeechProvider } from '../support/seeding'
import {
  captureState,
  launchVisualApp,
  navigateTo,
  prepareVisualUserDataDir
} from '../support/visual-app'

const TEMPLATE_ID = '82000000-0000-4000-8000-000000000001'

test('UI-TP-05 生成试卷 · 生成设置默认态（含三组音色）', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareVisualUserDataDir()
  const { app, page } = await launchVisualApp(userDataDir)
  try {
    // 语音服务商必须在页面挂载前注入，否则生成设置只显示「没有可用的语音服务商」。
    await seedSpeechProvider(page)
    await seedFileStoreText(
      page,
      ['template-editor', 'templates', TEMPLATE_ID],
      'template.json',
      visualGenerationTemplate(TEMPLATE_ID)
    )

    await navigateTo(page, '试卷模板')
    await expect(page.getByText('正在加载模板...')).toBeHidden()
    await page.getByRole('tab', { name: '我的模板' }).click()
    await page.getByRole('button', { name: '视觉生成模板', exact: true }).click()
    await page.getByRole('button', { name: '生成试卷' }).click()

    await expect(page.getByRole('heading', { level: 1, name: '视觉生成模板' })).toBeVisible()
    await expect(page.getByRole('list', { name: '试卷生成阶段' })).toContainText('生成设置')
    await expect(page.getByLabel('试卷名称')).toHaveValue('视觉生成模板')
    await expect(page.getByLabel('默认音色服务商')).toHaveValue('visual-speech')
    await expect(page.getByLabel('男声音色服务商')).toHaveValue('visual-speech')
    await expect(page.getByLabel('女声音色服务商')).toHaveValue('visual-speech')

    const file = await captureState(page, 'UI-TP-05', 'default')
    expect(file).toContain(path.join('UI-TP-05', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
