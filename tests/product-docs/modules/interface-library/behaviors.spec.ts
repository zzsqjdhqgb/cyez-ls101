import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import stableStringify from 'fast-json-stable-stringify'
import { MockAiServer } from '../../../integration/support/mock-ai-server'
import { launchIntegrationApp } from '../../../integration/support/electron-app'
import { evidence, prepareProductPage, productTest } from '../../support/product-test'

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
  await prepareProductPage(page)
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
  ...productTest(
    {
      id: 'IF-01',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题组创建',
      title: '从题型库命名创建并保存题组',
      purpose: '题型详情以题组为默认工作区；用户先命名题组并选择进入方式，再填写和保存具体内容。',
      preconditions: ['题型库中已有“英语问答练习”题型。'],
      outcomes: [
        '题组只有在确认名称和进入方式后才正式创建。',
        '手工填写内容需要明确保存，并能从题型详情重新进入。'
      ],
      manual: [{ chapter: 'prepare-content', order: 30 }],
      steps: [
        {
          key: 'open-instance-workspace',
          action: '从“题型库”打开要使用的题型。',
          expected: '题型详情默认显示题组工作区；没有题组时会显示空状态。'
        },
        {
          key: 'name-instance',
          action: '选择“新建题组”，填写名称并选择“手工填写”，然后确认创建。',
          expected: '应用在确认后创建题组并打开内容编辑页面。'
        },
        {
          key: 'save-instance',
          action: '填写题组中的各项内容并选择“保存”。',
          expected: '页面提示题组已经保存；返回题型详情后可以再次找到该题组。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await productStep('open-instance-workspace', async () => {
        await openInterfaceDetails()
        await expect(page.getByRole('tab', { name: '题组', selected: true })).toBeVisible()
        await expect(page.getByText('暂无题组')).toBeVisible()
      })

      await productStep('name-instance', async () => {
        await page.getByRole('button', { name: '新建题组' }).click()
        const dialog = page.getByRole('dialog', { name: '新建题组' })
        await dialog.getByLabel('题组名称').fill('校园生活第一套')
        await dialog.getByLabel('手工填写').check()
        await evidence(testInfo, page, {
          key: 'creation-settings',
          kind: 'decision',
          step: 'name-instance',
          caption: '创建前先确认题组名称和进入方式'
        })
        await dialog.getByRole('button', { name: '创建题组' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '校园生活第一套' })).toBeVisible()
      })

      await productStep('save-instance', async () => {
        await page.getByLabel('title 内容').fill('School life')
        await page.getByLabel('answer 内容').fill('I enjoy reading after class.')
        await page.getByRole('button', { name: '保存' }).click()
        await expect(page.getByText('题组已保存')).toBeVisible()
        await page.getByRole('button', { name: '返回题型详情' }).click()
        await expect(
          page.getByRole('button', { name: '校园生活第一套', exact: true })
        ).toBeVisible()
        await evidence(testInfo, page, {
          key: 'saved-instance',
          kind: 'result',
          step: 'save-instance',
          caption: '保存后的题组出现在题型详情工作区'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-02',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题组创建',
      title: '取消创建不会留下空题组',
      purpose: '需要退出新建题组设置而不保留尚未确认的题组时使用。',
      preconditions: ['当前题型还没有任何题组。'],
      outcomes: ['取消新建题组后，题组列表保持不变，可以稍后重新创建。'],
      manual: [{ chapter: 'prepare-content', order: 31 }],
      steps: [
        {
          key: 'prepare-instance',
          action: '选择“新建题组”，填写一个题组名称，但不要确认创建。',
          expected: '设置仍停留在新建题组对话框中，题组尚未出现在列表里。'
        },
        {
          key: 'cancel-creation',
          action: '选择“取消”。',
          expected: '对话框关闭，题组列表仍为空，不会出现刚才填写的名称。'
        }
      ]
    },
    async (_testInfo, productStep) => {
      await openInterfaceDetails()

      await productStep('prepare-instance', async () => {
        await page.getByRole('button', { name: '新建题组' }).click()
        const dialog = page.getByRole('dialog', { name: '新建题组' })
        await dialog.getByLabel('题组名称').fill('不会被创建的题组')
        await expect(dialog.getByLabel('手工填写')).toBeChecked()
      })

      await productStep('cancel-creation', async () => {
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
)

test(
  ...productTest(
    {
      id: 'IF-03',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题组编辑',
      title: '未保存的题组修改受到保护',
      purpose: '手工修改不会静默保存；离开编辑器前可以继续编辑或明确放弃本次修改。',
      preconditions: ['已经创建一个尚未填写内容的题组。'],
      outcomes: [
        '离开包含未保存修改的题组前必须确认。',
        '取消离开保留编辑状态，放弃修改不会写入题组。'
      ],
      manual: [{ chapter: 'prepare-content', order: 40 }],
      steps: [
        {
          key: 'request-leave',
          action: '修改题组内容但不保存，然后选择返回题型详情。',
          expected: '应用提示离开将放弃未保存的修改。'
        },
        {
          key: 'continue-editing',
          action: '在提示中选择“取消”。',
          expected: '应用返回编辑页面，并保留刚才尚未保存的内容。'
        },
        {
          key: 'discard-changes',
          action: '再次返回，并明确选择“放弃修改”，然后重新打开该题组。',
          expected: '题组只显示上次保存的内容，不包含已经放弃的修改。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await openInterfaceDetails()
      await createInstance('离开保护题组', '手工填写')

      await productStep('request-leave', async () => {
        await page.getByLabel('title 内容').fill('尚未保存的标题')
        await page.getByRole('button', { name: '返回题型详情' }).click()
        await expect(page.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'unsaved-confirmation',
          kind: 'decision',
          step: 'request-leave',
          caption: '离开前明确提示未保存修改会被放弃'
        })
      })

      await productStep('continue-editing', async () => {
        await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
        await expect(page.getByLabel('title 内容')).toHaveValue('尚未保存的标题')
      })

      await productStep('discard-changes', async () => {
        await page.getByRole('button', { name: '返回题型详情' }).click()
        await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click()
        await page.getByRole('button', { name: '离开保护题组', exact: true }).click()
        await expect(page.getByLabel('title 内容')).toHaveValue('')
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-04',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: 'AI 生成题组',
      title: '使用 AI 生成并覆盖题组内容',
      purpose: '需要使用 AI 一次生成整组内容，并用生成结果替换当前题组时使用。',
      preconditions: ['题组已有手工保存的内容，并配置了可用的 AI 文本模型。'],
      outcomes: [
        '已有内容时，生成前明确确认覆盖范围和立即保存语义。',
        '生成成功后，新内容会替换当前题组并立即保存。'
      ],
      manual: [{ chapter: 'prepare-content', order: 50 }],
      steps: [
        {
          key: 'configure-generation',
          action: '在已有内容的题组中选择“AI 生成并覆盖”，再选择生成模型。',
          expected: '页面显示本次 AI 生成任务的设置。'
        },
        {
          key: 'confirm-overwrite',
          action: '选择“生成并覆盖”，阅读覆盖说明后再次确认。',
          expected: '应用明确说明现有内容将被全部替换，并在成功后立即保存。'
        },
        {
          key: 'complete-generation',
          action: '等待 AI 生成完成。',
          expected: '页面显示生成的新内容和保存成功提示，不需要再次手工保存。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await configureTextProvider()
      await openInterfaceDetails()
      await createInstance('AI 覆盖题组', '手工填写')
      await page.getByLabel('title 内容').fill('原有标题')
      await page.getByLabel('answer 内容').fill('原有答案')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('题组已保存')).toBeVisible()

      await productStep('configure-generation', async () => {
        await page.getByRole('button', { name: 'AI 生成并覆盖' }).click()
        await page.getByLabel('生成模型', { exact: true }).selectOption({ label: 'mock-json' })
      })

      await productStep('confirm-overwrite', async () => {
        await page.getByRole('button', { name: '生成并覆盖', exact: true }).click()
        const dialog = page.getByRole('alertdialog', { name: '覆盖当前题组内容？' })
        await expect(dialog).toContainText('全部文本')
        await evidence(testInfo, page, {
          key: 'overwrite-confirmation',
          kind: 'decision',
          step: 'confirm-overwrite',
          caption: 'AI 生成前确认将覆盖当前题组并立即保存'
        })
        await dialog.getByRole('button', { name: '生成并覆盖', exact: true }).click()
      })

      await productStep('complete-generation', async () => {
        await expect(page.getByText('生成完成', { exact: true })).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('AI 生成内容已保存')).toBeVisible()
        await expect(page.getByLabel('title 内容')).toHaveValue('AI 标题')
        await expect(page.getByLabel('answer 内容')).toHaveValue('AI answer')
        await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'saved-result',
          kind: 'result',
          step: 'complete-generation',
          caption: 'AI 结果通过校验并保存到当前题组'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-05',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型发布',
      title: '从草稿发布稳定题型并保留草稿',
      purpose:
        '题型草稿可以不完整地保存；发布前说明稳定契约，发布成功后已发布题型和原草稿同时保留。',
      preconditions: ['用户从题型库的“草稿”视图开始创建题型。'],
      outcomes: [
        '发布前明确说明将创建稳定题型，并保留当前草稿。',
        '发布成功后，稳定题型和原草稿可以分别找到。'
      ],
      manual: [{ chapter: 'prepare-content', order: 20 }],
      steps: [
        {
          key: 'create-draft',
          action: '进入“题型库”的“草稿”视图，选择“新建题型”。',
          expected: '应用打开一个未命名题型草稿。'
        },
        {
          key: 'define-contract',
          action: '填写题型基本信息、生成要求和字段契约。',
          expected: '题型草稿具备发布所需的名称、说明、生成要求和内容字段。'
        },
        {
          key: 'confirm-publish',
          action: '选择“发布”，阅读说明后确认发布题型。',
          expected: '应用说明将创建不可直接修改的稳定题型，同时保留当前草稿。'
        },
        {
          key: 'verify-published-draft',
          action: '返回题型库，分别查看已发布题型和“草稿”视图。',
          expected: '稳定题型和原草稿都可以找到。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await page.getByRole('link', { name: '题型库' }).click()

      await productStep('create-draft', async () => {
        await page.getByRole('tab', { name: '草稿' }).click()
        await page.getByRole('button', { name: '新建题型' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
      })

      await productStep('define-contract', async () => {
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

      await productStep('confirm-publish', async () => {
        await page.getByRole('button', { name: '发布' }).click()
        const dialog = page.getByRole('alertdialog', { name: '发布当前题型草稿？' })
        await expect(dialog).toContainText('不可直接修改的稳定题型')
        await expect(dialog).toContainText('草稿仍会保留')
        await evidence(testInfo, page, {
          key: 'publish-confirmation',
          kind: 'decision',
          step: 'confirm-publish',
          caption: '发布前说明稳定题型与原草稿的关系'
        })
        await dialog.getByRole('button', { name: '发布题型' }).click()
      })

      await productStep('verify-published-draft', async () => {
        await expect(page.getByRole('heading', { level: 1, name: '课堂口语题型' })).toBeVisible()
        await page.getByRole('button', { name: '返回题型' }).click()
        await expect(page.getByRole('button', { name: '课堂口语题型', exact: true })).toBeVisible()
        await page.getByRole('tab', { name: '草稿' }).click()
        await expect(page.getByRole('button', { name: '课堂口语题型', exact: true })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'retained-draft',
          kind: 'result',
          step: 'verify-published-draft',
          caption: '发布后原题型草稿仍保留在草稿视图'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-06',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题组导入',
      title: '从 JSON 导入并替换题组内容',
      purpose:
        '已经准备好符合题型字段要求的 JSON 内容时，可以一次替换当前题组；校验失败不会改变原内容。',
      preconditions: ['题组已有手工保存的内容。'],
      outcomes: [
        '校验失败时保留临时输入和错误，原题组保持不变。',
        '取消导入会清空临时状态。',
        '合法 JSON 经确认后替换并保存题组，然后关闭对话框。'
      ],
      manual: [{ chapter: 'prepare-content', order: 60 }],
      steps: [
        {
          key: 'open-import',
          action: '在题组中打开“从 JSON 覆盖题组”。',
          expected: '对话框说明校验通过后会覆盖整组内容并立即保存。'
        },
        {
          key: 'reject-invalid-json',
          action: '输入格式错误的 JSON，选择“校验并覆盖”并确认。',
          expected: '对话框保留输入并显示格式错误，原题组内容保持不变。'
        },
        {
          key: 'cancel-import',
          action: '取消导入，然后重新打开 JSON 导入对话框。',
          expected: '上次临时输入和错误已经清空。'
        },
        {
          key: 'replace-instance',
          action: '输入符合字段要求的 JSON，选择“校验并覆盖”并确认。',
          expected: '对话框关闭，新内容替换当前题组并已经保存。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await openInterfaceDetails()
      await createInstance('JSON 覆盖题组', '手工填写')
      await page.getByLabel('title 内容').fill('原有标题')
      await page.getByLabel('answer 内容').fill('原有答案')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('题组已保存')).toBeVisible()

      await productStep('open-import', async () => {
        await openJsonReplacementDialog()
        const dialog = page.getByRole('dialog', { name: '从 JSON 覆盖题组' })
        await expect(dialog).toContainText('校验通过后将覆盖整组内容并立即保存')
      })

      await productStep('reject-invalid-json', async () => {
        const dialog = page.getByRole('dialog', { name: '从 JSON 覆盖题组' })
        await dialog.getByLabel('JSON 内容').fill('{"title":')
        await dialog.getByRole('button', { name: '校验并覆盖' }).click()
        await page
          .getByRole('alertdialog', { name: '覆盖当前题组内容？' })
          .getByRole('button', { name: '校验并覆盖' })
          .click()
        await expect(dialog.getByRole('alert')).toContainText('JSON 格式不合法')
        await expect(dialog.getByLabel('JSON 内容')).toHaveValue('{"title":')
        await expect(page.getByLabel('title 内容')).toHaveValue('原有标题')
        await expect(page.getByLabel('answer 内容')).toHaveValue('原有答案')
        await evidence(testInfo, page, {
          key: 'validation-error',
          kind: 'exception',
          step: 'reject-invalid-json',
          caption: '非法 JSON 保留在导入对话框中，原题组内容不变'
        })
      })

      await productStep('cancel-import', async () => {
        await page
          .getByRole('dialog', { name: '从 JSON 覆盖题组' })
          .getByRole('button', { name: '取消' })
          .click()
        await openJsonReplacementDialog()
        const dialog = page.getByRole('dialog', { name: '从 JSON 覆盖题组' })
        await expect(dialog.getByLabel('JSON 内容')).toHaveValue('')
        await expect(dialog.getByRole('alert')).toHaveCount(0)
      })

      await productStep('replace-instance', async () => {
        const dialog = page.getByRole('dialog', { name: '从 JSON 覆盖题组' })
        await dialog.getByLabel('JSON 内容').fill('{"title":"JSON 新标题","answer":"JSON 新答案"}')
        await dialog.getByRole('button', { name: '校验并覆盖' }).click()
        const confirmation = page.getByRole('alertdialog', { name: '覆盖当前题组内容？' })
        await expect(confirmation).toContainText('立即保存')
        await confirmation.getByRole('button', { name: '校验并覆盖' }).click()

        await expect(page.getByRole('dialog', { name: '从 JSON 覆盖题组' })).toHaveCount(0)
        await expect(page.getByText('已从 JSON 更新题组')).toBeVisible()
        await expect(page.getByLabel('title 内容')).toHaveValue('JSON 新标题')
        await expect(page.getByLabel('answer 内容')).toHaveValue('JSON 新答案')
        await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'replacement-result',
          kind: 'result',
          step: 'replace-instance',
          caption: 'JSON 内容已替换当前题组并完成保存'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-07',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型文件交换',
      title: '在全屏工作页选择题组并导入到另一套 LS101',
      purpose: '把题型和用户选择的题组作为一个文件交付，在另一套 LS101 中审查后继续使用。',
      preconditions: ['题型库中已有“英语问答练习”题型。'],
      outcomes: [
        '导出前可以查看题型身份并选择需要交付的题组。',
        '导入前可以查看文件内题型和题组状态，确认后题组及其内容可以继续使用。'
      ],
      manual: [{ chapter: 'prepare-content', order: 70 }],
      steps: [
        {
          key: 'prepare-export',
          action: '打开“英语问答练习”，新建题组“交付练习”，填写内容并保存。',
          expected: '题组出现在题型详情中，并可以进入导出工作页。'
        },
        {
          key: 'select-export-items',
          action: '在导出题型工作页查看题型身份，只勾选“交付练习”，然后选择“导出题型”。',
          expected: '页面显示已选择一个题组；确认后题型文件保存成功。'
        },
        {
          key: 'review-import-items',
          action: '在接收方题型库选择“导入题型”，打开刚才的题型文件。',
          expected: '全屏审查页列出题型和文件内题组，并将可导入题组默认选中。'
        },
        {
          key: 'confirm-import',
          action: '确认导入选中的题组，再打开导入的题型和“交付练习”。',
          expected: '题型和题组进入接收方题型库，已经保存的内容保持不变。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await openInterfaceDetails()
      await createInstance('交付练习', '手工填写')
      await page.getByLabel('title 内容').fill('Shared lesson')
      await page.getByLabel('answer 内容').fill('The saved answer travels with the interface.')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('题组已保存')).toBeVisible()
      await page.getByRole('button', { name: '返回题型详情' }).click()

      await productStep('prepare-export', async () => {
        await page.getByRole('tab', { name: '题型定义' }).click()
        await page.getByRole('button', { name: '导出题型' }).click()
        await expect(page.getByRole('heading', { name: '选择要交付的题组' })).toBeVisible()
      })

      const exportPath = path.join(userDataDir, 'delivery.lsinterface')
      await productStep('select-export-items', async () => {
        await expect(page.getByText('已选择 1 个')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'export-selection',
          kind: 'decision',
          step: 'select-export-items',
          caption: '导出前只选择需要交付的题组'
        })
        await configureSaveDialog(exportPath)
        await page.getByRole('button', { name: '导出题型' }).click()
        await expect(page.getByText('题型已导出')).toBeVisible()
        expect((await readFile(exportPath)).length).toBeGreaterThan(0)
      })

      await productStep('review-import-items', async () => {
        await page.evaluate(
          (scope) => window.fileStore.invoke('file:clear-scope', scope),
          ['interfaces', 'published', interfaceId.slice('sha256:'.length)]
        )
        await page.reload()
        await configureOpenDialog(exportPath)
        await page.getByRole('link', { name: '题型库' }).click()
        await page.getByRole('button', { name: '题型库操作' }).click()
        await page.getByRole('menuitem', { name: '导入题型' }).click()
        await expect(page.getByRole('heading', { name: '审查题型文件' })).toBeVisible()
        await expect(page.getByText('交付练习')).toBeVisible()
        await expect(page.getByText('可以导入')).toBeVisible()
        await evidence(testInfo, page, {
          key: 'import-review',
          kind: 'result',
          step: 'review-import-items',
          caption: '导入前全屏列出题型和可导入题组'
        })
      })

      await productStep('confirm-import', async () => {
        await page.getByRole('button', { name: '导入选中的题组' }).click()
        await expect(page.getByText('题型已导入')).toBeVisible()
        await page.getByRole('button', { name: interfaceContent.name, exact: true }).click()
        await page.getByRole('button', { name: '交付练习', exact: true }).click()
        await expect(page.getByLabel('title 内容')).toHaveValue('Shared lesson')
        await expect(page.getByLabel('answer 内容')).toHaveValue(
          'The saved answer travels with the interface.'
        )
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-08',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型文件交换',
      title: '识别已经存在和发生分叉的题组',
      purpose: '重复导入题型文件时，区分完全相同的题组和同一身份下内容不同的题组。',
      preconditions: ['题型库中已有“英语问答练习”题型和一个保存完成的题组。'],
      outcomes: [
        '同一 UUID 且内容完全相同的题组显示为已经存在，不重复写入。',
        '同一 UUID 但内容不同的题组显示身份冲突，不允许勾选或覆盖本地内容。'
      ],
      manual: [{ chapter: 'prepare-content', order: 71 }],
      steps: [
        {
          key: 'export-reference-file',
          action: '保存题组“身份检查题组”，从导出工作页把它保存为题型文件。',
          expected: '题型文件保留题组当前的身份和内容。'
        },
        {
          key: 'recognize-existing',
          action: '不修改本地题组，立即导入刚导出的题型文件。',
          expected: '审查页把该题组标记为本地已经存在相同内容，不能重复勾选。'
        },
        {
          key: 'fork-local-content',
          action: '取消导入，修改并保存本地“身份检查题组”的内容。',
          expected: '本地题组保留原 UUID，但内容已经与题型文件中的版本不同。'
        },
        {
          key: 'reject-identity-conflict',
          action: '再次导入原来的题型文件。',
          expected: '审查页显示同一题组标识对应的内容不同，题组不可勾选，也不能覆盖本地内容。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await openInterfaceDetails()
      await createInstance('身份检查题组', '手工填写')
      await page.getByLabel('title 内容').fill('Original identity content')
      await page.getByLabel('answer 内容').fill('Original answer')
      await page.getByRole('button', { name: '保存' }).click()
      await expect(page.getByText('题组已保存')).toBeVisible()
      await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
      await expect(page.getByText(`${interfaceContent.name} · 编辑`)).toBeVisible()
      await page.getByRole('button', { name: '返回题型详情' }).click()

      const exportPath = path.join(userDataDir, 'identity-check.lsinterface')
      await productStep('export-reference-file', async () => {
        await page.getByRole('tab', { name: '题型定义' }).click()
        await page.getByRole('button', { name: '导出题型' }).click()
        await expect(page.getByText('已选择 1 个')).toBeVisible()
        await configureSaveDialog(exportPath)
        await page.getByRole('button', { name: '导出题型' }).click()
        await expect(page.getByText('题型已导出')).toBeVisible()
      })

      await productStep('recognize-existing', async () => {
        await openImportReview(exportPath)
        await expect(page.getByText('本地已经存在相同内容')).toBeVisible()
        await expect(page.getByRole('checkbox', { name: /身份检查题组/ })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'existing-instance',
          kind: 'result',
          step: 'recognize-existing',
          caption: '完全相同的题组显示为本地已经存在'
        })
      })

      await productStep('fork-local-content', async () => {
        await page.getByRole('button', { name: '取消导入' }).click()
        await page.getByRole('button', { name: interfaceContent.name, exact: true }).click()
        await page.getByRole('button', { name: '身份检查题组', exact: true }).click()
        await page.getByLabel('answer 内容').fill('Locally revised answer')
        await page.getByRole('button', { name: '保存' }).click()
        await expect(page.getByText('题组已保存')).toBeVisible()
        await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()
        await expect(page.getByText(`${interfaceContent.name} · 编辑`)).toBeVisible()
        await page.getByRole('button', { name: '返回题型详情' }).click()
      })

      await productStep('reject-identity-conflict', async () => {
        await openImportReview(exportPath)
        await expect(page.getByText('同一题组标识对应的内容不同')).toBeVisible()
        await expect(page.getByRole('checkbox', { name: /身份检查题组/ })).toBeDisabled()
        await evidence(testInfo, page, {
          key: 'identity-conflict',
          kind: 'exception',
          step: 'reject-identity-conflict',
          caption: '同一 UUID 内容不同的题组不可导入或覆盖'
        })
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-09',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型草稿编辑',
      title: '在草稿编辑器维护字段结构和属性',
      purpose: '题型草稿需要在一个可检查的编辑器中同时维护基本信息、生成要求和字段契约。',
      preconditions: ['题型库中没有需要继续编辑的本地草稿。'],
      outcomes: [
        '字段组和字段的层级关系在字段树中保持可见。',
        '字段属性修改保存后，重新打开草稿仍然保持。',
        '折叠字段组只影响浏览，不会删除其中的字段。'
      ],
      manual: [{ chapter: 'prepare-content', order: 72 }],
      steps: [
        {
          key: 'open-draft-editor',
          action: '进入题型库的“草稿”视图并选择“新建题型”。',
          expected: '应用打开未命名题型草稿，并同时显示题型内容区和字段结构区。'
        },
        {
          key: 'define-field-structure',
          action: '填写题型名称、说明和生成要求，添加字段组“lesson”，再在组内添加字段“question”。',
          expected: '字段树明确显示字段组和字段的层级，属性面板显示当前选中节点。'
        },
        {
          key: 'edit-field-properties',
          action:
            '把“question”设置为文本字段，填写变量名、字段描述和示例，然后折叠并重新展开“lesson”。',
          expected: '字段属性和层级关系保持不变，折叠不会删除字段。'
        },
        {
          key: 'save-and-reopen',
          action: '保存草稿，返回草稿列表后重新打开“课堂问答题型”。',
          expected: '题型基本信息、字段组和字段属性都按上次保存的内容重新显示。'
        }
      ]
    },
    async (testInfo, productStep) => {
      await page.getByRole('link', { name: '题型库' }).click()

      await productStep('open-draft-editor', async () => {
        await page.getByRole('tab', { name: '草稿' }).click()
        await page.getByRole('button', { name: '新建题型' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()
        await expect(page.getByRole('region', { name: '题型内容' })).toBeVisible()
        await expect(page.getByRole('region', { name: '字段结构' })).toBeVisible()
      })

      await productStep('define-field-structure', async () => {
        const content = page.getByLabel('题型内容')
        await content.getByLabel('名称').fill('课堂问答题型')
        await content.getByLabel('描述').fill('用于课堂问答练习')
        await content.getByLabel('生成要求').fill('生成一组适合课堂讨论的英语问题。')

        const structure = page.getByLabel('字段结构')
        await structure.getByRole('button', { name: '添加字段组' }).click()
        await structure.getByLabel('字段标识').fill('lesson')
        await structure.getByLabel('字段标识').press('Tab')
        await expect(structure.getByText('添加到：lesson')).toBeVisible()
        await structure.getByRole('button', { name: '添加字段', exact: true }).click()
        await structure.getByLabel('字段标识').fill('question')
        await structure.getByLabel('字段标识').press('Tab')
        await expect(structure.getByRole('button', { name: /question/ })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'draft-field-tree',
          kind: 'decision',
          step: 'define-field-structure',
          caption: '字段组和字段在草稿结构树中形成明确层级'
        })
      })

      await productStep('edit-field-properties', async () => {
        const structure = page.getByLabel('字段结构')
        await structure.getByLabel('变量名').fill('questionText')
        await structure.getByLabel('描述').fill('课堂讨论问题')
        await structure.getByLabel('示例').fill('What makes a good friend?')
        await structure.getByRole('button', { name: '折叠字段组“lesson”' }).click()
        await expect(structure.getByRole('button', { name: /question/ })).toHaveCount(0)
        await structure.getByRole('button', { name: '展开字段组“lesson”' }).click()
        await expect(structure.getByRole('button', { name: /question/ })).toBeVisible()
        await evidence(testInfo, page, {
          key: 'draft-field-properties',
          kind: 'result',
          step: 'edit-field-properties',
          caption: '字段属性保存于可折叠的字段结构中'
        })
      })

      await productStep('save-and-reopen', async () => {
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('草稿已保存')).toBeVisible()
        await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
        await page.getByRole('button', { name: '返回草稿列表' }).click()
        await expect(page.getByRole('button', { name: '课堂问答题型', exact: true })).toBeVisible()
        await page.getByRole('button', { name: '课堂问答题型', exact: true }).click()
        await expect(page.getByRole('heading', { level: 1, name: '课堂问答题型' })).toBeVisible()
        const structure = page.getByLabel('字段结构')
        await expect(structure.locator('[data-field-path="lesson"]')).toBeVisible()
        await expect(structure.locator('[data-field-path="lesson.question"]')).toBeVisible()
        await structure.locator('[data-field-path="lesson.question"]').click()
        await expect(structure.getByLabel('变量名')).toHaveValue('questionText')
        await expect(structure.getByLabel('描述')).toHaveValue('课堂讨论问题')
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-10',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型草稿编辑',
      title: '发布前定位草稿字段校验错误',
      purpose: '草稿可以先保存不完整内容，但发布必须明确指出具体字段需要修正的位置。',
      preconditions: ['题型库中没有需要继续编辑的本地草稿。'],
      outcomes: [
        '发布校验失败时，草稿内容不会被发布或静默修正。',
        '错误消息关联到具体字段，用户可以直接回到该字段修正。',
        '修正字段后可以再次发布，得到稳定题型。'
      ],
      manual: [{ chapter: 'prepare-content', order: 73 }],
      steps: [
        {
          key: 'prepare-incomplete-draft',
          action: '新建草稿，填写名称、说明、生成要求和字段标识，但故意不填写变量名。',
          expected: '草稿可以保存，编辑器保留这个尚未完成的字段。'
        },
        {
          key: 'review-validation-error',
          action: '选择“发布”并确认发布题型。',
          expected: '页面显示“变量名不能为空”，并标明错误字段路径；题型不会被发布。'
        },
        {
          key: 'fix-and-publish',
          action: '从校验错误进入字段，填写变量名后再次发布并确认。',
          expected: '题型发布成功，进入稳定题型详情。'
        }
      ]
    },
    async (_testInfo, productStep) => {
      await page.getByRole('link', { name: '题型库' }).click()
      await page.getByRole('tab', { name: '草稿' }).click()
      await page.getByRole('button', { name: '新建题型' }).click()

      await productStep('prepare-incomplete-draft', async () => {
        const content = page.getByLabel('题型内容')
        await content.getByLabel('名称').fill('校验定位题型')
        await content.getByLabel('描述').fill('用于验证字段错误定位')
        await content.getByLabel('生成要求').fill('生成一个课堂问题。')
        const structure = page.getByLabel('字段结构')
        await structure.getByRole('button', { name: '添加字段', exact: true }).click()
        await structure.getByLabel('字段标识').fill('question')
        await structure.getByLabel('字段标识').press('Tab')
        await structure.getByLabel('描述').fill('课堂问题')
        await structure.getByLabel('示例').fill('What is your idea?')
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('草稿已保存')).toBeVisible()
      })

      await productStep('review-validation-error', async () => {
        await page.getByRole('button', { name: '发布', exact: true }).click()
        await page
          .getByRole('alertdialog', { name: '发布当前题型草稿？' })
          .getByRole('button', {
            name: '发布题型'
          })
          .click()
        await expect(
          page.getByRole('region', { name: '题型内容' }).getByRole('alert')
        ).toContainText('变量名不能为空')
        await expect(page.getByRole('button', { name: /变量名不能为空/ })).toBeVisible()
      })

      await productStep('fix-and-publish', async () => {
        await page.getByRole('button', { name: /变量名不能为空/ }).click()
        const structure = page.getByLabel('字段结构')
        await expect(structure.locator('[data-field-path="question"]')).toBeFocused()
        await structure.getByLabel('变量名').fill('questionText')
        await page.getByRole('button', { name: '发布', exact: true }).click()
        await page
          .getByRole('alertdialog', { name: '发布当前题型草稿？' })
          .getByRole('button', {
            name: '发布题型'
          })
          .click()
        await expect(page.getByRole('heading', { level: 1, name: '校验定位题型' })).toBeVisible()
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-11',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型草稿编辑',
      title: '未保存的草稿修改受到保护',
      purpose: '草稿编辑器不能因为返回列表或切换页面而静默丢弃用户正在编辑的题型定义。',
      preconditions: ['题型库中已有一个保存完成的题型草稿。'],
      outcomes: [
        '离开包含未保存修改的草稿前必须确认。',
        '取消离开会保留编辑状态和未保存内容。',
        '明确放弃后重新打开草稿只显示上次保存的内容。'
      ],
      manual: [{ chapter: 'prepare-content', order: 74 }],
      steps: [
        {
          key: 'make-unsaved-change',
          action: '打开已保存草稿，修改题型说明但不保存，然后返回草稿列表。',
          expected: '应用提示离开会丢失未保存修改。'
        },
        {
          key: 'continue-editing',
          action: '在提示中选择“取消”。',
          expected: '应用留在编辑器中，刚才的未保存说明仍然存在。'
        },
        {
          key: 'discard-and-reopen',
          action: '再次返回并选择“放弃修改”，重新打开草稿。',
          expected: '草稿恢复到上次保存的说明，未保存内容没有写入。'
        }
      ]
    },
    async (_testInfo, productStep) => {
      await page.getByRole('link', { name: '题型库' }).click()
      await page.getByRole('tab', { name: '草稿' }).click()
      await page.getByRole('button', { name: '新建题型' }).click()
      const content = page.getByLabel('题型内容')
      await content.getByLabel('名称').fill('草稿退出保护题型')
      await content.getByLabel('描述').fill('已保存的原始说明')
      await content.getByLabel('生成要求').fill('生成一组课堂问题。')
      const structure = page.getByLabel('字段结构')
      await structure.getByRole('button', { name: '添加字段', exact: true }).click()
      await structure.getByLabel('字段标识').fill('question')
      await structure.getByLabel('字段标识').press('Tab')
      await structure.getByLabel('变量名').fill('questionText')
      await structure.getByLabel('描述').fill('课堂问题')
      await structure.getByLabel('示例').fill('What is your idea?')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByText('草稿已保存')).toBeVisible()
      await page.getByRole('button', { name: '返回草稿列表' }).click()
      await page.getByRole('button', { name: '草稿退出保护题型', exact: true }).click()

      await productStep('make-unsaved-change', async () => {
        await page.getByLabel('题型内容').getByLabel('描述').fill('尚未保存的新说明')
        await page.getByRole('button', { name: '返回草稿列表' }).click()
        await expect(page.getByRole('alertdialog', { name: '放弃未保存的修改？' })).toBeVisible()
      })

      await productStep('continue-editing', async () => {
        await page
          .getByRole('alertdialog', { name: '放弃未保存的修改？' })
          .getByRole('button', {
            name: '取消'
          })
          .click()
        await expect(page.getByLabel('题型内容').getByLabel('描述')).toHaveValue('尚未保存的新说明')
      })

      await productStep('discard-and-reopen', async () => {
        await page.getByRole('button', { name: '返回草稿列表' }).click()
        await page
          .getByRole('alertdialog', { name: '放弃未保存的修改？' })
          .getByRole('button', {
            name: '放弃修改'
          })
          .click()
        await page.getByRole('button', { name: '草稿退出保护题型', exact: true }).click()
        await expect(page.getByLabel('题型内容').getByLabel('描述')).toHaveValue('已保存的原始说明')
      })
    }
  )
)

test(
  ...productTest(
    {
      id: 'IF-12',
      owner: { kind: 'module', slug: 'interface-library', title: '题型库', order: 40 },
      section: '题型草稿编辑',
      title: '删除非空字段组前需要确认',
      purpose: '删除字段组会同时删除其子字段，属于需要明确确认的破坏性编辑操作。',
      preconditions: ['草稿编辑器中已有一个包含字段的字段组。'],
      outcomes: [
        '删除非空字段组时明确说明子字段也会被删除。',
        '取消确认不会改变字段树。',
        '确认后字段组及其子字段一起从当前草稿移除。'
      ],
      manual: [{ chapter: 'prepare-content', order: 75 }],
      steps: [
        {
          key: 'prepare-group',
          action: '新建草稿，添加字段组“lesson”，再在组内添加字段“question”。',
          expected: '字段树显示一个包含子字段的字段组。'
        },
        {
          key: 'review-delete',
          action: '选中“lesson”并选择删除节点。',
          expected: '应用提示字段组及其所有子字段将一并删除。'
        },
        {
          key: 'cancel-delete',
          action: '取消删除确认。',
          expected: '字段组和子字段仍然存在。'
        },
        {
          key: 'confirm-delete',
          action: '再次选择删除节点并确认删除字段组。',
          expected: '字段组和其中的“question”同时从字段树消失。'
        }
      ]
    },
    async (_testInfo, productStep) => {
      await page.getByRole('link', { name: '题型库' }).click()
      await page.getByRole('tab', { name: '草稿' }).click()
      await page.getByRole('button', { name: '新建题型' }).click()
      const structure = page.getByLabel('字段结构')
      await productStep('prepare-group', async () => {
        await structure.getByRole('button', { name: '添加字段组' }).click()
        await structure.getByLabel('字段标识').fill('lesson')
        await structure.getByLabel('字段标识').press('Tab')
        await structure.getByRole('button', { name: '添加字段', exact: true }).click()
        await structure.getByLabel('字段标识').fill('question')
        await structure.getByLabel('字段标识').press('Tab')
        await expect(structure.locator('[data-field-path="lesson.question"]')).toBeVisible()
      })

      await structure.locator('[data-field-path="lesson"]').click()
      await productStep('review-delete', async () => {
        await structure.getByRole('button', { name: '删除节点' }).click()
        const dialog = page.getByRole('alertdialog', { name: '删除字段组“lesson”？' })
        await expect(dialog).toContainText('所有子字段')
      })

      await productStep('cancel-delete', async () => {
        await page
          .getByRole('alertdialog', { name: '删除字段组“lesson”？' })
          .getByRole('button', {
            name: '取消'
          })
          .click()
        await expect(structure.locator('[data-field-path="lesson.question"]')).toBeVisible()
      })

      await productStep('confirm-delete', async () => {
        await structure.getByRole('button', { name: '删除节点' }).click()
        await page
          .getByRole('alertdialog', { name: '删除字段组“lesson”？' })
          .getByRole('button', {
            name: '删除字段组'
          })
          .click()
        await expect(structure.locator('[data-field-path="lesson"]')).toHaveCount(0)
        await expect(structure.locator('[data-field-path="lesson.question"]')).toHaveCount(0)
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('草稿已保存')).toBeVisible()
      })
    }
  )
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

async function openJsonReplacementDialog(): Promise<void> {
  await page.getByRole('button', { name: '高级操作' }).click()
  await page.getByRole('menuitem', { name: '从 JSON 覆盖' }).click()
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

async function configureSaveDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    })
  }, filePath)
}

async function configureOpenDialog(filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath], bookmarks: [] })
    })
  }, filePath)
}

async function openImportReview(filePath: string): Promise<void> {
  await configureOpenDialog(filePath)
  await page.getByRole('link', { name: '题型库' }).click()
  await expect(page.getByRole('heading', { level: 1, name: '题型库' })).toBeVisible()
  await page.getByRole('button', { name: '题型库操作' }).click()
  await page.getByRole('menuitem', { name: '导入题型' }).click()
  await expect(page.getByRole('heading', { name: '审查题型文件' })).toBeVisible()
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
