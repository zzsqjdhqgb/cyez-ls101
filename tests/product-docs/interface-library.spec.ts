import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import stableStringify from 'fast-json-stable-stringify'
import { MockAiServer } from '../integration/support/mock-ai-server'
import { launchIntegrationApp } from '../integration/support/electron-app'

const interfaceContent = {
  name: '英语问答练习',
  description: '用于产品行为文档的文本题型',
  promptTemplate: '生成一组简短的英语问答练习。',
  fields: {
    order: ['title', 'answer'],
    nodes: {
      title: {
        type: 'text' as const,
        varName: 'titleText',
        description: '练习标题',
        example: 'School life'
      },
      answer: {
        type: 'text' as const,
        varName: 'answerText',
        description: '参考答案',
        example: 'I enjoy reading after class.'
      }
    }
  }
}

const mockServer = new MockAiServer()
let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let interfaceId: string
let pageErrors: string[]

test.beforeAll(async () => mockServer.start())
test.afterAll(async () => mockServer.close())

test.beforeEach(async () => {
  mockServer.reset()
  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-docs-interface-'))
  pageErrors = []
  electronApp = await launchIntegrationApp(userDataDir)
  page = await electronApp.firstWindow()
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  interfaceId = await seedInterface()
})

test.afterEach(async () => {
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test(
  'IF-01 从题型库命名创建并保存题组',
  {
    annotation: [
      { type: 'product-area', description: '题型库 / 题组' },
      {
        type: 'summary',
        description:
          '题型详情以题组为默认工作区；用户先命名题组并选择进入方式，再填写和保存具体内容。'
      },
      { type: 'precondition', description: '题型库中已有“英语问答练习”题型。' }
    ]
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
  async ({}, testInfo) => {
    await test.step('从题型库进入题型，默认看到题组工作区', async () => {
      await openInterfaceDetails()
      await expect(page.getByRole('tab', { name: '题组', selected: true })).toBeVisible()
      await expect(page.getByText('暂无题组')).toBeVisible()
    })

    await test.step('填写题组名称并选择手工填写后才正式创建', async () => {
      await createInstance('校园生活第一套', '手工填写')
      await expect(page.getByRole('heading', { level: 1, name: '校园生活第一套' })).toBeVisible()
    })

    await test.step('填写题组内容并明确保存', async () => {
      await page.getByLabel('title 内容').fill('School life')
      await page.getByLabel('answer 内容').fill('I enjoy reading after class.')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('题组已保存')).toBeVisible()
      await page.getByRole('button', { name: '返回题型详情' }).click()
      await expect(page.getByRole('button', { name: '校园生活第一套', exact: true })).toBeVisible()
    })

    await testInfo.attach('题型的题组工作区', {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png'
    })
  }
)

test(
  'IF-02 取消创建不会留下空题组',
  {
    annotation: [
      { type: 'product-area', description: '题型库 / 新建题组' },
      {
        type: 'summary',
        description: '打开新建题组设置不会立即写入空记录；只有确认名称和进入方式后才创建题组。'
      },
      { type: 'precondition', description: '当前题型还没有任何题组。' }
    ]
  },
  async () => {
    await openInterfaceDetails()

    await test.step('打开新建题组设置并填写名称', async () => {
      await page.getByRole('button', { name: '新建题组' }).click()
      const dialog = page.getByRole('dialog', { name: '新建题组' })
      await dialog.getByLabel('题组名称').fill('不会被创建的题组')
      await expect(dialog.getByLabel('手工填写')).toBeChecked()
    })

    await test.step('取消后题组列表和本地记录都保持为空', async () => {
      await page
        .getByRole('dialog', { name: '新建题组' })
        .getByRole('button', { name: '取消' })
        .click()
      await expect(page.getByText('暂无题组')).toBeVisible()
      await expect(page.getByText('不会被创建的题组')).toHaveCount(0)
      expect(await listInstanceIds()).toEqual([])
    })
  }
)

test(
  'IF-03 未保存的题组修改受到保护',
  {
    annotation: [
      { type: 'product-area', description: '题型库 / 题组编辑' },
      {
        type: 'summary',
        description: '手工修改不会静默保存；离开编辑器前可以继续编辑或明确放弃本次修改。'
      },
      { type: 'precondition', description: '已经创建一个尚未填写内容的题组。' }
    ]
  },
  async () => {
    await openInterfaceDetails()
    await createInstance('离开保护题组', '手工填写')

    await test.step('修改字段后离开会提示未保存风险', async () => {
      await page.getByLabel('title 内容').fill('尚未保存的标题')
      await page.getByRole('button', { name: '返回题型详情' }).click()
      await expect(page.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeVisible()
    })

    await test.step('取消离开会保留当前编辑状态', async () => {
      await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
      await expect(page.getByLabel('title 内容')).toHaveValue('尚未保存的标题')
    })

    await test.step('明确放弃后返回题组列表，重新进入时不包含未保存内容', async () => {
      await page.getByRole('button', { name: '返回题型详情' }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click()
      await page.getByRole('button', { name: '离开保护题组', exact: true }).click()
      await expect(page.getByLabel('title 内容')).toHaveValue('')
    })
  }
)

test(
  'IF-04 AI 整组生成明确覆盖并原子保存',
  {
    annotation: [
      { type: 'product-area', description: '题型库 / AI 生成题组' },
      {
        type: 'summary',
        description: 'AI 整组生成使用明确的覆盖语义；已有内容时再次确认，成功后整组结果一次保存。'
      },
      { type: 'precondition', description: '题组已有手工保存的内容，并配置了可用的 AI 文本模型。' }
    ]
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
  async ({}, testInfo) => {
    await configureTextProvider()
    await openInterfaceDetails()
    await createInstance('AI 覆盖题组', '手工填写')
    await page.getByLabel('title 内容').fill('原有标题')
    await page.getByLabel('answer 内容').fill('原有答案')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('题组已保存')).toBeVisible()

    await test.step('打开 AI 生成并覆盖面板并选择模型', async () => {
      await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
      await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json' })
    })

    await test.step('对已有内容执行生成前明确提示会覆盖并立即保存', async () => {
      await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
      const dialog = page.getByRole('alertdialog', { name: '覆盖当前题组内容？' })
      await expect(dialog).toContainText('全部文本')
      await testInfo.attach('AI 覆盖确认', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png'
      })
      await dialog.getByRole('button', { name: '生成并覆盖', exact: true }).click()
    })

    await test.step('AI 成功后整组内容被替换并已经保存', async () => {
      await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
      await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
      await expect(page.getByLabel('answer 内容')).toHaveValue('AI answer')
      await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
    })
  }
)

test(
  'IF-05 从草稿发布稳定题型并保留草稿',
  {
    annotation: [
      { type: 'product-area', description: '题型库 / 题型草稿' },
      {
        type: 'summary',
        description:
          '题型草稿可以不完整地保存；发布前说明稳定契约，发布成功后已发布题型和原草稿同时保留。'
      },
      { type: 'precondition', description: '用户从题型库的“草稿”视图开始创建题型。' }
    ]
  },
  // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture argument destructuring.
  async ({}, testInfo) => {
    await page.getByRole('link', { name: '题型库' }).click()

    await test.step('在题型库切换到草稿视图并新建题型', async () => {
      await page.getByRole('tab', { name: '草稿' }).click()
      await page.getByRole('button', { name: '新建题型' }).click()
      await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
    })

    await test.step('填写题型基本信息、生成要求和字段契约', async () => {
      const content = page.getByLabel('题型内容')
      await content.getByLabel('名称').fill('课堂口语题型')
      await content.getByLabel('描述').fill('用于课堂口语练习')
      await content.getByLabel('生成要求').fill('生成一个适合课堂讨论的英语问题。')
      await page.getByRole('button', { name: '添加字段', exact: true }).click()
      const structure = page.getByLabel('字段结构')
      await structure.getByLabel('变量名').fill('questionText')
      await structure.getByLabel('描述').fill('课堂讨论问题')
      await structure.getByLabel('示例').fill('What makes a good friend?')
      await structure.getByLabel('字段标识').fill('question')
      await structure.getByLabel('字段标识').press('Tab')
    })

    await test.step('发布前明确说明将生成稳定题型并保留当前草稿', async () => {
      await page.getByRole('button', { name: '发布' }).click()
      const dialog = page.getByRole('alertdialog', { name: '发布当前题型草稿？' })
      await expect(dialog).toContainText('不可直接修改的稳定题型')
      await expect(dialog).toContainText('草稿仍会保留')
      await testInfo.attach('题型发布确认', {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png'
      })
      await dialog.getByRole('button', { name: '发布题型' }).click()
    })

    await test.step('发布成功后可以查看稳定题型，并能在草稿视图找到原草稿', async () => {
      await expect(page.getByRole('heading', { level: 1, name: '课堂口语题型' })).toBeVisible()
      await page.getByRole('button', { name: '返回题型' }).click()
      await expect(page.getByRole('button', { name: '课堂口语题型', exact: true })).toBeVisible()
      await page.getByRole('tab', { name: '草稿' }).click()
      await expect(page.getByRole('button', { name: '课堂口语题型', exact: true })).toBeVisible()
    })
  }
)

async function openInterfaceDetails(): Promise<void> {
  await page.getByRole('link', { name: '题型库' }).click()
  await page.getByRole('button', { name: interfaceContent.name, exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: interfaceContent.name })).toBeVisible()
}

async function createInstance(name: string, mode: '手工填写' | 'AI 生成'): Promise<void> {
  await page.getByRole('button', { name: '新建题组' }).click()
  const dialog = page.getByRole('dialog', { name: '新建题组' })
  await dialog.getByLabel('题组名称').fill(name)
  await dialog.getByLabel(mode).check()
  await dialog.getByRole('button', { name: '创建题组' }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
}

async function seedInterface(): Promise<string> {
  const canonical = stableStringify({
    name: normalize(interfaceContent.name),
    description: normalize(interfaceContent.description),
    promptTemplate: normalize(interfaceContent.promptTemplate),
    fields: interfaceContent.fields.order.map((key) => {
      const node = interfaceContent.fields.nodes[key]
      return [
        normalize(key),
        {
          type: node.type,
          varName: normalize(node.varName),
          description: normalize(node.description),
          example: normalize(node.example)
        }
      ]
    })
  })
  const id = `sha256:${createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')}`
  await page.evaluate(
    async ({ scope, definition }) =>
      window.fileStore.invoke(
        'file:write-text',
        { scope, filename: 'interface.json' },
        JSON.stringify(definition)
      ),
    {
      scope: ['interfaces', 'published', id.slice('sha256:'.length)],
      definition: { id, ...interfaceContent }
    }
  )
  return id
}

async function listInstanceIds(): Promise<string[]> {
  return (await page.evaluate(
    (scope) => window.fileStore.invoke('file:list-scopes', scope),
    ['interfaces', 'published', interfaceId.slice('sha256:'.length), 'instances']
  )) as string[]
}

async function configureTextProvider(): Promise<void> {
  await page.evaluate((config) => window.airouter.saveProviderConfig(config), {
    id: 'product-docs-interface',
    name: '产品文档 AI',
    type: 'openai-compatible',
    baseUrl: mockServer.baseUrl,
    models: [{ id: 'mock-json', enabled: true }],
    apiKey: 'product-docs-interface-secret'
  })
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}
