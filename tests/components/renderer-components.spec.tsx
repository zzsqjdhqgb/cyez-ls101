import { expect, test, type Locator, type Page } from '@playwright/test'

async function openComponent(page: Page, name: string): Promise<Locator> {
  await page.goto(`/?component=${name}`)
  const component = page.getByTestId('component-root')
  await expect(component).toBeVisible()
  return component
}

test('FE-01 buttons expose semantic defaults and keyboard activation', async ({ page }) => {
  const component = await openComponent(page, 'button')
  const button = component.getByRole('button', { name: '保存' })

  await expect(button).toHaveAttribute('type', 'button')
  await expect(button.locator('svg')).toHaveAttribute('aria-hidden', 'true')
  await button.focus()
  await expect(button).toBeFocused()
  await button.press('Enter')
  await expect(component.getByRole('status')).toHaveText('已保存')
})

test('FE-02 icon buttons remain discoverable through focus and tooltips', async ({ page }) => {
  const component = await openComponent(page, 'icon-button')
  const button = component.getByRole('button', { name: '删除 Provider' })

  await expect(button).toHaveAccessibleName('删除 Provider')
  await button.focus()
  const tooltip = page.getByRole('tooltip', { name: '删除 Provider' })
  await expect(tooltip).toBeVisible()
  const tooltipId = await tooltip.getAttribute('id')
  expect(tooltipId).toBeTruthy()
  await expect(button).toHaveAttribute('aria-describedby', tooltipId as string)
})

test('FE-03 confirmation modal requires an explicit action and restores focus', async ({
  page
}) => {
  const component = await openComponent(page, 'confirm-modal')
  const trigger = component.getByRole('button', { name: '打开确认框' })
  const dialog = page.getByRole('alertdialog', { name: '删除 Provider？' })

  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(dialog).toContainText('删除后将无法恢复。')
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
  await dialog.getByRole('button', { name: '删除' }).click()
  await expect(dialog).toBeHidden()

  await trigger.click()
  await expect(dialog.getByRole('button', { name: '取消' })).toBeFocused()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '取消' }).click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('FE-04 shared modal blocks Escape and outside clicks until explicit close', async ({
  page
}) => {
  const component = await openComponent(page, 'modal')
  const trigger = component.getByRole('button', { name: '打开通用弹窗' })
  const dialog = page.getByRole('dialog', { name: '通用弹窗' })
  const secondary = dialog.getByRole('button', { name: '次要操作' })
  const close = dialog.getByRole('button', { name: '关闭通用弹窗' })

  await trigger.click()
  await expect(dialog).toHaveAttribute('aria-modal', 'true')
  await expect(secondary).toBeFocused()
  await secondary.press('Tab')
  await expect(close).toBeFocused()
  await close.press('Tab')
  await expect(secondary).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  const overlay = page.locator('div[role="presentation"]').filter({ has: dialog })
  await overlay.click({ position: { x: 1, y: 1 } })
  await expect(dialog).toBeVisible()
  await close.click()
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('FE-05 resizable split responds to keyboard resizing without leaving its bounds', async ({
  page
}) => {
  const component = await openComponent(page, 'resizable-split')
  const separator = component.getByRole('separator', { name: '调整分栏宽度' })

  await expect(separator).toHaveAttribute('aria-orientation', 'vertical')
  await expect(separator).toHaveAttribute('aria-valuemin', '180')
  await expect(separator).toHaveAttribute('aria-valuenow', '300')

  await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '316')
  await separator.press('Shift+ArrowLeft')
  await expect(separator).toHaveAttribute('aria-valuenow', '252')

  for (let index = 0; index < 20; index += 1) await separator.press('ArrowLeft')
  await expect(separator).toHaveAttribute('aria-valuenow', '180')
  for (let index = 0; index < 30; index += 1) await separator.press('ArrowRight')
  await expect(separator).toHaveAttribute('aria-valuenow', '552')
})

test('FE-06 model selector groups providers and reports selection and refresh', async ({
  page
}) => {
  const component = await openComponent(page, 'ai-model-select')
  const select = component.getByRole('combobox', { name: '生成模型' })

  await expect(select).toBeEnabled()
  await expect(select.locator('optgroup')).toHaveCount(2)
  await expect(select.locator('option')).toHaveText([
    '轻量模型 (gpt-4o-mini)',
    'Sonnet (claude-3-5-sonnet)'
  ])

  await select.selectOption('1')
  await expect(component.getByLabel('当前模型')).toHaveText('anthropic/claude-3-5-sonnet')

  await component.getByRole('button', { name: '刷新生成模型' }).click()
  await expect(component.getByLabel('刷新次数')).toHaveText('1')
})

test('FE-07 application shell keeps navigation usable while changing layouts', async ({ page }) => {
  const component = await openComponent(page, 'shell')
  const sidebar = component.locator('aside')

  await expect(component.getByRole('heading', { name: '首页' })).toBeVisible()
  await expect(component.getByRole('navigation', { name: '主导航' })).toBeVisible()
  await component.getByRole('button', { name: '收起侧边栏' }).click()
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true')
  await expect(component.getByRole('link', { name: '首页' })).toBeVisible()

  await component.getByRole('link', { exact: true, name: '专注' }).click()
  await expect(component.getByRole('heading', { name: '专注页面' })).toBeVisible()
  await expect(sidebar).toBeHidden()
  await expect(component.getByRole('button', { name: '最小化' })).toBeVisible()

  await component.getByRole('link', { name: '打开沉浸页面' }).click()
  await expect(component.getByRole('heading', { name: '沉浸页面' })).toBeVisible()
  await expect(component.getByRole('button', { name: '最小化' })).toHaveCount(0)
  await expect(component.locator('aside')).toHaveCount(0)
})

test('FE-08 settings rows remain usable in a narrow component viewport', async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 720 })
  const component = await openComponent(page, 'settings')
  const select = component.getByRole('combobox', { name: '界面主题' })
  const switchControl = component.getByRole('switch', { name: '减少动态效果' })

  await expect(select).toBeVisible()
  await expect(switchControl).toBeVisible()
  const selectBox = await select.boundingBox()
  const switchBox = await switchControl.boundingBox()
  expect(selectBox).not.toBeNull()
  expect(switchBox).not.toBeNull()
  expect(selectBox?.x).toBeGreaterThanOrEqual(0)
  expect((selectBox?.x ?? 0) + (selectBox?.width ?? 0)).toBeLessThanOrEqual(720)
  expect(switchBox?.x).toBeGreaterThanOrEqual(0)
  expect((switchBox?.x ?? 0) + (switchBox?.width ?? 0)).toBeLessThanOrEqual(720)
})

test('FE-09 page compositions retain a heading and empty-state reading order', async ({ page }) => {
  const component = await openComponent(page, 'page')

  await expect(component.getByRole('heading', { level: 1, name: '页面标题' })).toBeVisible()
  await expect(component.getByRole('button', { name: '检查状态' })).toBeVisible()
  await expect(component.getByText('暂无内容')).toBeVisible()
})
