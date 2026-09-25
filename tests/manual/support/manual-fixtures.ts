import { encodeExamPackage } from '@ls101/exam-package'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { practiceExam } from '../../visual/support/fixtures'

/** 说明书里使用的试卷名称：避免出现视觉回归夹具的名字。 */
export const MANUAL_EXAM_TITLE = '上海高考英语听说模拟卷'

/**
 * 借用视觉套件的最小可运行试卷夹具，改成一个用户手册里读得通的卷名后写入文件。
 * 夹具本身由视觉基线共用，不能改动，因此这里只改副本。
 */
export async function writeManualExamFixture(directory: string): Promise<string> {
  const exam = practiceExam()
  exam.examData.title = MANUAL_EXAM_TITLE
  exam.submissionTemplate.meta.examTitle = MANUAL_EXAM_TITLE
  const file = path.join(directory, 'manual-practice.lsexam')
  await writeFile(file, await encodeExamPackage(exam, {}))
  return file
}

/**
 * 往刚建好的题组里写入真实题目内容。
 *
 * 内置口语题型的图片字段要求提示词与图片同时存在，「保存」按钮才可用；自动化流程没有可用的
 * 生图服务商，因此无法从界面保存一份只有文本的题组。这里改为在题组落盘后补写内置题型自带的
 * 示例值，使配图对应的题组是真正填好内容的题组，而不是只有名称的空壳。
 */
export async function fillStoredInstanceValues(userDataDir: string, name: string): Promise<void> {
  const examples = builtinSpeakingExamples()
  const files = await findInstanceFiles(path.join(userDataDir, 'data'))
  for (const file of files) {
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      instance?: { name?: string; values?: Record<string, string> }
    }
    if (stored.instance?.name !== name || !stored.instance.values) continue
    stored.instance.values = { ...stored.instance.values, ...examples }
    await writeFile(file, JSON.stringify(stored))
    return
  }
  throw new Error(`没有找到名为「${name}」的题组文件`)
}

async function findInstanceFiles(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...(await findInstanceFiles(full)))
    else if (entry.name === 'instance.json') found.push(full)
  }
  return found
}

/**
 * 读取内置上海高考英语口语题型当前的版本，取出其中每个文本字段的示例值。
 * 题型由 `resources/builtin` 随软件提供，因此示例值与题型始终一致。
 */
function builtinSpeakingExamples(): Record<string, string> {
  const root = path.join(
    process.cwd(),
    'resources',
    'builtin',
    'interface-editor',
    'builtin',
    'shanghai-gaokao-speaking'
  )
  const current = JSON.parse(readFileSync(path.join(root, '.text', 'current.json'), 'utf8')) as {
    currentInterfaceId: string
  }
  const digest = current.currentInterfaceId.replace('sha256:', '')
  const definition = JSON.parse(
    readFileSync(path.join(root, 'versions', digest, '.text', 'interface.json'), 'utf8')
  ) as { fields?: FieldNode }
  const examples: Record<string, string> = {}
  collectExamples(definition.fields, examples)
  return examples
}

interface FieldNode {
  type?: string
  varName?: string
  example?: string
  children?: { order?: string[]; nodes?: Record<string, FieldNode> }
  nodes?: Record<string, FieldNode>
}

function collectExamples(node: FieldNode | undefined, examples: Record<string, string>): void {
  if (!node) return
  if (node.type === 'text' && node.varName && node.example) examples[node.varName] = node.example
  const children = node.children ?? node
  for (const child of Object.values(children.nodes ?? {})) collectExamples(child, examples)
}

/** 注入一个文本生成服务商，让 AI 引擎设置页显示已配置的服务商与模型。 */
export async function seedTextProvider(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await window.airouter.saveProviderConfig({
      name: '示例服务商',
      type: 'openai-compatible',
      baseUrl: 'https://api.example.com/v1',
      models: [{ id: 'example-chat', enabled: true }],
      apiKey: 'example-key'
    })
  })
}
