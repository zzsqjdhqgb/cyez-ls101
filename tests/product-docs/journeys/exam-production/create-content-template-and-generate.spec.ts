import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { launchProductDocsApp } from '../../support/product-app'
import { evidence, prepareProductPage, productJourney } from '../../support/product-test'

const GRADING_UNIT_NAME = '口语表达评分单元'
const INTERFACE_NAME = '口语表达题型'
const INSTANCE_NAME = '口语表达题组'
const TEMPLATE_NAME = '口语表达试卷模板'
const EXAM_NAME = '口语表达练习试卷'
const QUESTION_TEXT = 'What do you enjoy most about school?'
const SPEECH_TEXT = 'Please answer the question.'

let electronApp: ElectronApplication
let page: Page
let userDataDir: string
let server: Server
let serverOrigin: string
let pageErrors: string[]

test.beforeEach(async () => {
  server = createSpeechServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  serverOrigin = `http://127.0.0.1:${address.port}`

  userDataDir = await mkdtemp(path.join(tmpdir(), 'ls101-product-journey-exam-production-'))
  pageErrors = []
  electronApp = await launchProductDocsApp(userDataDir)
  page = await electronApp.firstWindow()
  await prepareProductPage(page)
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByRole('heading', { level: 1, name: '工作台' })).toBeVisible()
  await configureSpeechProviders()
})

test.afterEach(async () => {
  server?.closeAllConnections()
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  await electronApp?.close().catch(() => undefined)
  await rm(userDataDir, { force: true, recursive: true })
  expect(pageErrors).toEqual([])
})

test(
  ...productJourney(
    {
      id: 'EP-01',
      owner: {
        kind: 'journey',
        slug: 'template-library',
        title: '试卷制作',
        order: 45
      },
      section: '从内容到试卷',
      title: '从评分单元与题型出发生成可加入试卷库的试卷',
      purpose:
        '从全新的应用数据目录开始，依次建立评分单元、题型与题组，再把它们绑定到一个新的试卷模板中，最后生成一份可以加入试卷库的试卷。',
      preconditions: [
        '没有预先创建的评分单元、题型、题组或试卷模板。',
        '已经配置好可用于合成语音的服务商、模型和音色。'
      ],
      outcomes: [
        '评分单元、题型、题组和试卷模板都在同一个数据目录中由界面依次创建。',
        '模板同时引用已发布的题型和已保存的评分单元，并用题组为题型提供具体内容。',
        '生成出的试卷通过模板校验并完成语音合成，加入试卷库后可以立即在试卷库中找到。'
      ],
      manual: [{ chapter: 'build-generate-exam', order: 5 }],
      steps: [
        {
          key: 'create-grading-unit',
          action:
            '进入“评分单元”，选择“新建评分单元”，把评分管道切换为“自由口语”，填写名称、描述、答案槽位说明和评分标准，再选择“添加到我的评分单元”。',
          expected:
            '页面提示“已添加到我的评分单元”，该评分单元出现在“我的评分单元”中，可以立即被模板引用。'
        },
        {
          key: 'create-interface-draft',
          action:
            '进入“题型库”的“草稿”视图，选择“新建题型”，填写题型名称、描述和生成要求，添加一个文本字段并保存草稿。',
          expected: '页面提示“草稿已保存”，题型内容和字段契约可以继续编辑。'
        },
        {
          key: 'publish-interface',
          action: '选择“发布”，阅读发布说明后确认“发布题型”。',
          expected: '应用打开刚发布的稳定题型，并默认进入空的题组工作区。'
        },
        {
          key: 'create-instance',
          action:
            '选择“新建题组”，填写题组名称并选择“手工填写”，选择“创建题组”，填写字段内容后再选择“保存”。',
          expected: '页面提示“题组已保存”，题组内容可以重新打开并供试卷模板使用。'
        },
        {
          key: 'create-template',
          action: '进入“试卷模板”，选择“新建模板”，填写模板名称和描述。',
          expected: '模板编辑器显示填写后的基本信息，并等待保存。'
        },
        {
          key: 'add-exam-page',
          action:
            '在“函数库”的“基础组件库”中选择“添加页面”，为这个页面依次添加“TTS 播放”和“录音”两个时间线项目，再填写要合成语音的文本。',
          expected:
            '结构视图出现一个页面节点，其时间线同时包含“TTS 播放”和“录音”，录音输出采用默认名称。'
        },
        {
          key: 'bind-interface',
          action: '在“全局属性”的“题型”区域选择“添加题型”，选择题型后确认“添加”。',
          expected: '题型要求出现在模板中，并接受该题型的全部字段变量。'
        },
        {
          key: 'bind-grading-unit',
          action:
            '展开“评分单元”，选择“添加”，选中刚保存的评分单元并确认“添加评分单元”；把评分单元的题目描述绑定到题型的字段变量，再把答案槽位绑定到这个页面的录音输出。',
          expected:
            '模板引用评分单元，评分输入取自题组内容，答案槽位与页面时间线中的录音输出一一对应。'
        },
        {
          key: 'save-template',
          action: '选择“保存”。',
          expected: '模板显示“版本 1”，保存按钮变为不可用。'
        },
        {
          key: 'generate-exam',
          action:
            '选择“生成试卷”，确认题型使用刚保存的题组，为默认、男声和女声音色分别选择服务商、模型和音色，填写试卷名称后选择“开始生成”。',
          expected: '生成流程显示“试卷生成完成”，并给出页面、资源和试卷包统计。'
        },
        {
          key: 'add-to-exam-library',
          action: '选择“加入试卷库”，关闭生成结果，返回模板列表后进入“试卷库”。',
          expected: '试卷库中出现刚生成的试卷，并可以开始考试。'
        }
      ]
    },
    async (testInfo, productStep) => {
      test.setTimeout(90_000)

      await productStep('create-grading-unit', async () => {
        await page.getByRole('link', { name: '评分单元' }).click()
        await page.getByRole('tab', { name: '我的评分单元' }).click()
        await page.getByRole('button', { name: '新建评分单元' }).click()
        await expect(page.getByRole('heading', { name: '未命名评分单元' })).toBeVisible()

        await page.getByRole('button', { name: '自由口语' }).click()
        await page.getByLabel('名称').fill(GRADING_UNIT_NAME)
        await page.getByLabel('描述').fill('用于课堂口语表达的人工评分')
        await page.getByLabel('answer', { exact: true }).fill('学生录制的口语作答')
        await page.getByLabel('评分标准（Markdown）').fill('根据发音、流利度和内容完整性评分。')
        await page.getByRole('button', { name: '添加到我的评分单元' }).click()
        await expect(page.getByText('已添加到我的评分单元')).toBeVisible()

        await page.getByRole('button', { name: '返回评分单元列表' }).click()
        await page.getByRole('tab', { name: '我的评分单元' }).click()
        await expect(page.getByRole('button', { name: GRADING_UNIT_NAME })).toBeVisible()
      })

      await productStep('create-interface-draft', async () => {
        await page.getByRole('link', { name: '题型库' }).click()
        await page.getByRole('tab', { name: '草稿' }).click()
        await page.getByRole('button', { name: '新建题型' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名题型' })).toBeVisible()

        const content = page.getByLabel('题型内容')
        await content.getByLabel('名称').fill(INTERFACE_NAME)
        await content.getByLabel('描述').fill('用于口语表达题的可复用题型')
        await content.getByLabel('生成要求').fill('生成一个适合学生用英语描述校园生活的问题。')

        await page.getByRole('button', { name: '添加字段', exact: true }).click()
        const structure = page.getByLabel('字段结构')
        await structure.getByLabel('变量名').fill('questionText')
        await structure.getByLabel('描述').fill('需要学生回答的英语问题')
        await structure.getByLabel('示例').fill('What do you enjoy most about school?')
        await structure.getByLabel('字段标识').fill('question')
        await structure.getByLabel('字段标识').press('Tab')

        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('草稿已保存')).toBeVisible()
      })

      await productStep('publish-interface', async () => {
        await page.getByRole('button', { name: '发布', exact: true }).click()
        const confirmation = page.getByRole('alertdialog', { name: '发布当前题型草稿？' })
        await expect(confirmation).toContainText('不可直接修改的稳定题型')
        await expect(confirmation).toContainText('当前草稿仍会保留')
        await confirmation.getByRole('button', { name: '发布题型' }).click()

        await expect(page.getByRole('heading', { level: 1, name: INTERFACE_NAME })).toBeVisible()
        await expect(page.getByRole('tab', { name: '题组', selected: true })).toBeVisible()
        await expect(page.getByText('暂无题组')).toBeVisible()
      })

      await productStep('create-instance', async () => {
        await page.getByRole('button', { name: '新建题组' }).click()
        const dialog = page.getByRole('dialog', { name: '新建题组' })
        await dialog.getByLabel('题组名称').fill(INSTANCE_NAME)
        await dialog.getByLabel('手工填写').check()
        await dialog.getByRole('button', { name: '创建题组' }).click()
        await expect(page.getByRole('heading', { level: 1, name: INSTANCE_NAME })).toBeVisible()

        await page.getByLabel('question 内容').fill(QUESTION_TEXT)
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('题组已保存')).toBeVisible()

        await page.getByRole('button', { name: '返回题型详情' }).click()
        await expect(page.getByRole('button', { name: INSTANCE_NAME, exact: true })).toBeVisible()
      })

      await productStep('create-template', async () => {
        await page.getByRole('link', { name: '试卷模板' }).click()
        await page.getByRole('button', { name: '新建模板' }).click()
        await expect(page.getByRole('heading', { level: 1, name: '未命名模板' })).toBeVisible()
        await page.getByRole('textbox', { name: '名称', exact: true }).fill(TEMPLATE_NAME)
        await page
          .getByRole('textbox', { name: '描述' })
          .fill('绑定题型与评分单元的口语表达试卷模板')
      })

      await productStep('add-exam-page', async () => {
        await page.getByRole('button', { name: '添加页面', exact: true }).click()
        await expect(page.getByRole('button', { name: '选择节点 page' })).toBeVisible()

        await page.getByRole('button', { name: '添加节点 page 时间线项目' }).click()
        await page.getByRole('button', { name: '添加 TTS 播放' }).click()
        await page.getByLabel('节点 page 时间线项目 1 TTS 文本').fill(SPEECH_TEXT)

        await page.getByRole('button', { name: '添加节点 page 时间线项目' }).click()
        await page.getByRole('button', { name: '添加 录音' }).click()
        await expect(page.getByLabel('节点 page 时间线项目 2 录音输出名称')).toHaveValue(
          'recording'
        )
      })

      await productStep('bind-interface', async () => {
        await page.getByRole('button', { name: '添加题型' }).click()
        await page.getByLabel('选择题型').selectOption({ label: INTERFACE_NAME })
        await page.getByRole('button', { name: '添加', exact: true }).click()
        await expect(page.getByRole('region', { name: '题型配置' })).toContainText(INTERFACE_NAME)
      })

      await productStep('bind-grading-unit', async () => {
        await page.getByRole('button', { name: '评分单元' }).click()
        await page.getByRole('button', { name: '添加', exact: true }).click()
        await page.getByLabel('正式评分单元').selectOption({ label: GRADING_UNIT_NAME })
        await page.getByRole('button', { name: '添加评分单元' }).click()

        const use = page.getByRole('region', { name: '评分单元 schema-use-1' })
        await expect(use).toContainText(GRADING_UNIT_NAME)

        const questionInput = use.getByLabel('schema-use-1 question-description')
        await questionInput.fill('[@data.questionText]')
        await questionInput.press('Tab')
        await expect(questionInput).toHaveValue('[@data.questionText]')

        const audioBinding = use.getByLabel('schema-use-1 answer 录音')
        await audioBinding.selectOption('recording')
        await expect(audioBinding).toHaveValue('recording')
        await evidence(testInfo, page, {
          key: 'template-bindings',
          kind: 'result',
          step: 'bind-grading-unit',
          caption: '模板同时绑定已发布的题型与已保存的评分单元，并把答案槽位接到页面录音'
        })
      })

      await productStep('save-template', async () => {
        await page.getByRole('button', { name: '保存', exact: true }).click()
        await expect(page.getByText('版本 1')).toBeVisible()
        await expect(page.getByRole('button', { name: '保存', exact: true })).toBeDisabled()
      })

      await productStep('generate-exam', async () => {
        await page.getByRole('button', { name: '生成试卷' }).click()
        await expect(page.getByRole('list', { name: '试卷生成阶段' })).toContainText('生成设置')

        const groupSelect = page.getByLabel(`题型“${INTERFACE_NAME}”题组`)
        await expect(groupSelect.locator('option:checked')).toHaveText(INSTANCE_NAME)
        await selectSpeech('默认音色', 'docs-default', 'default-model', 'default-voice')
        await selectSpeech('男声音色', 'docs-man', 'man-model', 'man-voice')
        await selectSpeech('女声音色', 'docs-woman', 'woman-model', 'woman-voice')

        await page.getByLabel('试卷名称').fill(EXAM_NAME)
        await page.getByRole('button', { name: '开始生成' }).click()
        await expect(page.getByText('试卷生成完成')).toBeVisible({ timeout: 20_000 })
        await evidence(testInfo, page, {
          key: 'generated-exam',
          kind: 'result',
          step: 'generate-exam',
          caption: '模板通过校验并完成语音合成，生成可加入试卷库的试卷'
        })
      })

      await productStep('add-to-exam-library', async () => {
        await page.getByRole('button', { name: '加入试卷库' }).click()
        await expect(page.getByRole('button', { name: '已加入试卷库' })).toBeDisabled()

        const result = page.getByRole('region', { name: EXAM_NAME })
        await result.getByRole('button', { name: '关闭', exact: true }).click()
        await expect(page.getByRole('heading', { level: 1, name: TEMPLATE_NAME })).toBeVisible()

        await page.getByRole('button', { name: '返回模板' }).click()
        await page.getByRole('link', { name: '试卷库' }).click()
        await expect(page.getByRole('cell', { name: new RegExp(EXAM_NAME) })).toBeVisible()
      })
    }
  )
)

async function selectSpeech(
  role: string,
  provider: string,
  model: string,
  voice: string
): Promise<void> {
  await page.getByLabel(`${role}服务商`).selectOption(provider)
  await page.getByLabel(`${role}模型`).selectOption(model)
  await page.getByLabel(`${role}音色`).selectOption(voice)
}

async function configureSpeechProviders(): Promise<void> {
  await page.evaluate(
    async ({ serverOrigin }) => {
      const providers = [
        {
          id: 'docs-default',
          name: '文档默认语音',
          path: 'default',
          model: 'default-model',
          voice: 'default-voice'
        },
        {
          id: 'docs-man',
          name: '文档男声',
          path: 'man',
          model: 'man-model',
          voice: 'man-voice'
        },
        {
          id: 'docs-woman',
          name: '文档女声',
          path: 'woman',
          model: 'woman-model',
          voice: 'woman-voice'
        }
      ]
      for (const provider of providers) {
        await window.airouter.saveSpeechProviderConfig({
          id: provider.id,
          name: provider.name,
          kind: 'online',
          type: 'openai-compatible',
          baseUrl: `${serverOrigin}/${provider.path}/v1`,
          models: [{ id: provider.model, enabled: true }],
          voices: [{ id: provider.voice, enabled: true }],
          apiKey: 'product-docs'
        })
      }
    },
    { serverOrigin }
  )
}

function createSpeechServer(): Server {
  return createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      response.writeHead(200, { 'content-type': 'audio/wav' })
      response.end(Buffer.from([82, 73, 70, 70, 1, 0, 0, 0]))
    })
  })
}
