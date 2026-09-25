import { expect, test } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import {
  stubOpenDialog,
  writeExamFixture,
  writeMixedSubmissionFixture
} from '../../visual/support/fixtures'
import { seedFileStoreText, seedSpeechProvider } from '../../visual/support/seeding'
import { visualGenerationTemplate } from '../../visual/support/fixtures'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'

test('FIG-EL-LIBRARY 试卷库 · 已导入试卷', async () => {
  test.setTimeout(90_000)
  const userDataDir = await prepareManualUserDataDir()
  const examPath = await writeExamFixture(userDataDir)
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await stubOpenDialog(app, examPath)
    await page.getByRole('link', { name: '试卷库' }).click()
    await page.getByRole('button', { name: '导入试卷包' }).click()
    await expect(page.getByRole('button', { name: '开始考试' }).first()).toBeVisible({
      timeout: 30_000
    })
    // 导入成功的提示会自动消失，等它退场后再截图。
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 })

    const file = await captureFigure(page, 'FIG-EL-LIBRARY')
    expect(file).toContain(path.join('FIG-EL-LIBRARY', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-SR-LIBRARY 作答记录 · 已导入作答', async () => {
  test.setTimeout(90_000)
  const userDataDir = await prepareManualUserDataDir()
  const submissionPath = await writeMixedSubmissionFixture(userDataDir)
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await stubOpenDialog(app, submissionPath)
    await page.getByRole('link', { name: '作答记录' }).click()
    await page.getByRole('button', { name: '导入作答包' }).click()
    await expect(page.getByRole('row').filter({ hasText: '李华' })).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 20_000 })

    const file = await captureFigure(page, 'FIG-SR-LIBRARY')
    expect(file).toContain(path.join('FIG-SR-LIBRARY', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-GENERATE 生成试卷 · 生成设置（已配置三组音色）', async () => {
  test.setTimeout(90_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    // 语音服务商必须在生成页挂载前注入，否则语音设置只显示配置告警。
    await seedSpeechProvider(page)
    await seedFileStoreText(
      page,
      ['template-editor', 'templates', MANUAL_TEMPLATE_ID],
      'template.json',
      manualGenerationTemplate(MANUAL_TEMPLATE_ID)
    )

    await page.getByRole('link', { name: '试卷模板' }).click()
    await page.getByRole('tab', { name: '我的模板' }).click()
    await page.getByRole('button', { name: MANUAL_TEMPLATE_NAME, exact: true }).click()
    await page.getByRole('button', { name: '生成试卷' }).click()
    await expect(page.getByText('生成设置')).toBeVisible()
    await expect(page.getByLabel('默认音色服务商')).toHaveValue('visual-speech')
    await expect(page.getByLabel('男声音色服务商')).toHaveValue('visual-speech')
    await expect(page.getByLabel('女声音色服务商')).toHaveValue('visual-speech')

    const file = await captureFigure(page, 'FIG-TP-GENERATE')
    expect(file).toContain(path.join('FIG-TP-GENERATE', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

const MANUAL_TEMPLATE_ID = '82000000-0000-4000-8000-000000000002'
const MANUAL_TEMPLATE_NAME = '上海高考口语模拟卷'

/** 借用视觉套件的生成用模板夹具，改成说明书里更自然的名称。 */
function manualGenerationTemplate(templateId: string): Record<string, unknown> {
  const template = visualGenerationTemplate(templateId) as {
    content: { name: string; description: string }
  }
  template.content.name = MANUAL_TEMPLATE_NAME
  template.content.description = '用于演示生成设置'
  return template
}
