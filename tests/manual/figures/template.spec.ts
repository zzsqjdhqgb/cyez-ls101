import { expect, test, type Page } from '@playwright/test'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { captureFigure, launchFigureApp, prepareManualUserDataDir } from '../support/manual-app'
import { fillStoredInstanceValues } from '../support/manual-fixtures'

/** 新建本地模板，并声明上海高考英语口语题型（别名 data，接受全部变量）。 */
async function createSpeakingTemplate(page: Page): Promise<void> {
  await page.getByRole('link', { name: '试卷模板' }).click()
  await page.getByRole('button', { name: '新建模板' }).click()
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible()
  await expect(page.getByText('正在加载题型...')).toBeHidden({ timeout: 10_000 })
  await page.getByRole('button', { name: '添加题型' }).click()
  await page.getByLabel('选择题型').selectOption({ label: '上海高考英语口语' })
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect(page.getByRole('button', { name: '移除题型 data' })).toBeVisible()
  await setName(page, '名称', '口语练习模板')
}

/** 模板编辑器里的名称输入靠 label 文本定位，填完失焦提交。 */
async function setName(page: Page, label: string, value: string): Promise<void> {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(value)
  await field.blur()
}

/** 保存模板，让编辑器回到干净状态，关闭窗口时不会再弹未保存确认。 */
async function saveTemplate(page: Page): Promise<void> {
  const save = page.getByRole('button', { name: '保存', exact: true })
  await page.keyboard.press('Escape')
  await save.click()
  await expect(save).toBeDisabled()
}

async function setBlockField(page: Page, label: string, value: number): Promise<void> {
  const field = page.getByLabel(label, { exact: true })
  await field.fill(String(value))
  await field.blur()
}

test('FIG-TP-VARIABLES 模板编辑器 · 变量补全', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await createSpeakingTemplate(page)
    await page.getByRole('button', { name: '添加页面' }).click()
    await setName(page, '节点名称', '朗读句子')
    await page.getByRole('tab', { name: '页面' }).click()

    // 标题块
    await page.getByRole('button', { name: '添加内容块' }).click()
    await page.getByRole('button', { name: '添加文本' }).click()
    await page.getByLabel('内容块文本').fill('第一部分　朗读句子')
    await setBlockField(page, 'X', 8)
    await setBlockField(page, 'Y', 8)
    await setBlockField(page, '宽度', 84)
    await setBlockField(page, '字号', 32)
    await page.getByRole('button', { name: '粗体' }).click()
    await page.getByRole('button', { name: '居中' }).click()

    // 变量块：正文来自题型变量，输入 @ 时补全列表给出候选。
    await page.getByRole('button', { name: '添加内容块' }).click()
    await page.getByRole('button', { name: '添加文本' }).click()
    const textField = page.getByLabel('内容块文本')
    await textField.fill('请朗读下面的句子：')
    await setBlockField(page, 'X', 8)
    await setBlockField(page, 'Y', 26)
    await setBlockField(page, '宽度', 84)
    await setBlockField(page, '字号', 20)

    await textField.click()
    await page.keyboard.press('End')
    await page.keyboard.type('@data.s')
    await expect(page.locator('div[role="listbox"]')).toBeVisible()
    await textField.evaluate((element) => element.scrollIntoView({ block: 'center' }))

    const file = await captureFigure(page, 'FIG-TP-VARIABLES')
    expect(file).toContain(path.join('FIG-TP-VARIABLES', 'default.png'))
    await saveTemplate(page)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-PAGE 模板编辑器 · 页面视图', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await createSpeakingTemplate(page)
    await page.getByRole('button', { name: '添加页面' }).click()
    await setName(page, '节点名称', '朗读句子')
    await page.getByRole('tab', { name: '页面' }).click()

    await page.getByRole('button', { name: '添加内容块' }).click()
    await page.getByRole('button', { name: '添加文本' }).click()
    await page.getByLabel('内容块文本').fill('第一部分　朗读句子')
    await setBlockField(page, 'X', 8)
    await setBlockField(page, 'Y', 8)
    await setBlockField(page, '宽度', 84)
    await setBlockField(page, '字号', 32)
    await page.getByRole('button', { name: '粗体' }).click()
    await page.getByRole('button', { name: '居中' }).click()

    await page.getByRole('button', { name: '添加内容块' }).click()
    await page.getByRole('button', { name: '添加文本' }).click()
    const textField = page.getByLabel('内容块文本')
    await textField.fill('请朗读下面的句子：')
    await setBlockField(page, 'X', 8)
    await setBlockField(page, 'Y', 26)
    await setBlockField(page, '宽度', 84)
    await setBlockField(page, '字号', 20)
    await textField.click()
    await page.keyboard.press('End')
    await page.keyboard.type('@data.s')
    await expect(page.locator('div[role="listbox"]')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(textField).toHaveValue('请朗读下面的句子：[@data.sentence_1]')

    // 选中标题块，右侧属性面板显示内容块的属性。
    await page.getByRole('button', { name: '文本 text', exact: true }).click()
    await expect(page.getByLabel('内容块文本')).toHaveValue('第一部分　朗读句子')

    const file = await captureFigure(page, 'FIG-TP-PAGE')
    expect(file).toContain(path.join('FIG-TP-PAGE', 'default.png'))
    await saveTemplate(page)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-PREVIEW 模板编辑器 · 预览视图', async () => {
  test.setTimeout(90_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    // 预览按编译结果渲染，需要一个内容完整的题组。
    await page.getByRole('link', { name: '题型库' }).click()
    await page
      .getByRole('button', { name: /^上海高考英语听力/ })
      .first()
      .click()
    await page.getByRole('button', { name: '新建题组' }).click()
    await page.getByLabel('题组名称').fill('听力模拟第一套')
    await page.getByRole('button', { name: '创建题组' }).click()
    await expect(page.getByRole('dialog', { name: '新建题组' })).toBeHidden()
    await page.getByRole('button', { name: '返回题型详情' }).click()
    await fillStoredInstanceValues(userDataDir, '听力模拟第一套')

    await page.getByRole('link', { name: '试卷模板' }).click()
    const row = page
      .getByText('上海高考英语听力标准题型', { exact: true })
      .locator('xpath=ancestor::article')
    await row.getByRole('button', { name: '查看' }).click()
    await expect(page.getByText('内置模板 · 只读')).toBeVisible()

    await page.getByRole('tab', { name: '预览' }).click()
    const instanceSelect = page.getByRole('combobox', { name: /^预览题组 data/ })
    await expect(instanceSelect).toBeVisible()
    await instanceSelect.selectOption({ label: '听力模拟第一套' })
    await expect(page.getByText('正在生成预览...')).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^预览画面/ }).first()).toBeVisible()

    const file = await captureFigure(page, 'FIG-TP-PREVIEW')
    expect(file).toContain(path.join('FIG-TP-PREVIEW', 'default.png'))
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-FUNCTION 函数编辑器 · 函数签名', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await page.getByRole('link', { name: '试卷模板' }).click()
    await page.getByRole('button', { name: '新建模板' }).click()
    await expect(page.getByRole('button', { name: '新建本地函数库' })).toBeEnabled()
    await page.getByRole('button', { name: '新建本地函数库' }).click()

    // 函数库是带版本号的独立文档，先给它一个说得清楚的名称。
    await page.getByRole('button', { name: '重命名本地函数库“未命名函数库”' }).click()
    const libraryName = page.getByLabel('函数库“未命名函数库”名称')
    await libraryName.fill('口语评分函数库')
    await libraryName.press('Enter')

    await page.getByRole('button', { name: '在“口语评分函数库”中新建函数' }).click()
    await page.getByRole('button', { name: '编辑未命名函数' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '未命名函数' })).toBeVisible()

    // 函数签名：一个文本输入，一个数字输出。
    await page.getByRole('textbox', { name: '函数名称' }).fill('计算朗读得分')
    await page.getByRole('button', { name: '添加输入' }).click()
    await page.getByLabel('输入 1 名称').fill('passage')
    await page.getByRole('button', { name: '添加输出' }).click()
    await page.getByLabel('输出 1 名称').fill('score')
    await page.getByLabel('输出 1 类型').selectOption({ label: '数字' })

    const file = await captureFigure(page, 'FIG-TP-FUNCTION')
    expect(file).toContain(path.join('FIG-TP-FUNCTION', 'default.png'))
    await saveTemplate(page)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})

test('FIG-TP-INTERFACES 模板编辑器 · 题型配置', async () => {
  test.setTimeout(60_000)
  const userDataDir = await prepareManualUserDataDir()
  const { app, page } = await launchFigureApp(userDataDir)
  try {
    await createSpeakingTemplate(page)
    // 右栏滚到题型配置：这里决定模板引用哪个题型、题型别名与可用变量。
    const remove = page.getByRole('button', { name: '移除题型 data' })
    await remove.evaluate((element) => element.scrollIntoView({ block: 'center' }))

    const file = await captureFigure(page, 'FIG-TP-INTERFACES')
    expect(file).toContain(path.join('FIG-TP-INTERFACES', 'default.png'))
    await saveTemplate(page)
  } finally {
    await app.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true })
  }
})
