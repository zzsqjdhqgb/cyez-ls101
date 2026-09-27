import { encodeExamPackage } from '@ls101/exam-package'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  practiceExam,
  writeInterfacePackageFixture,
  type InterfaceFixtureContent
} from '../../visual/support/fixtures'

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
 * 内置题型的图片字段要求提示词与图片同时存在，「保存」按钮才可用；自动化流程没有可用的
 * 生图服务商，因此无法从界面保存一份只有文本的题组。这里改为在题组落盘后补写题型自带的
 * 示例值，使配图对应的题组是真正填好内容的题组，而不是只有名称的空壳。
 */
export async function fillStoredInstanceValues(userDataDir: string, name: string): Promise<void> {
  const files = await findInstanceFiles(path.join(userDataDir, 'data'))
  for (const file of files) {
    const stored = JSON.parse(await readFile(file, 'utf8')) as {
      instance?: { name?: string; values?: Record<string, string> }
    }
    if (stored.instance?.name !== name || !stored.instance.values) continue
    stored.instance.values = { ...stored.instance.values, ...definitionExamples(file) }
    await writeFile(file, JSON.stringify(stored))
    return
  }
  throw new Error(`没有找到名为「${name}」的题组文件`)
}

/**
 * 读取题组所在版本的题型定义，取出其中每个文本字段的示例值。
 * 题组文件与题型定义同属一个版本目录，因此读到的示例与题型始终一致。
 */
function definitionExamples(instanceFile: string): Record<string, string> {
  const scope = path.resolve(instanceFile, '..', '..', '..', '..')
  const definition = JSON.parse(
    readFileSync(path.join(scope, '.text', 'interface.json'), 'utf8')
  ) as { fields?: FieldNode }
  const examples: Record<string, string> = {}
  collectExamples(definition.fields, examples)
  return examples
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
 * 说明书里使用的题型文件：一个用户自编的口语题型，用于演示两台电脑之间交换题型。
 *
 * 返回两个文件：第一次导入建立本地题型，第二次导入的题组分别落进「已存在」「冲突」
 * 与「可以导入」三种状态，正好对应说明书 5.7 节列出的三种情况。
 */
export async function writeManualInterfaceFiles(directory: string): Promise<{
  first: string
  second: string
}> {
  const content: InterfaceFixtureContent = {
    name: '校园英语话题卡',
    description: '校本口语练习：给出话题与参考答案，用于课前热身。',
    promptTemplate: '围绕给定话题生成一段适合高中生口头表达的内容，并给出参考答案。',
    fields: {
      order: ['topic', 'answer'],
      nodes: {
        topic: {
          type: 'text',
          varName: 'topicText',
          description: '话题',
          example: 'School life'
        },
        answer: {
          type: 'text',
          varName: 'answerText',
          description: '参考答案',
          example: 'I enjoy reading after class.'
        }
      }
    }
  }
  const shared = {
    content,
    exportedAt: '2026-01-15T08:00:00.000Z'
  }
  const schoolLife = {
    instanceId: '91000000-0000-4000-8000-000000000001',
    name: '校园生活第一套',
    values: {
      topicText: 'School life',
      answerText: 'I enjoy reading after class.'
    }
  }
  const technology = {
    instanceId: '91000000-0000-4000-8000-000000000002',
    name: '科技与环保第二套',
    values: {
      topicText: 'Technology and the environment',
      answerText: 'Small choices, such as taking the bus, can reduce waste.'
    }
  }
  return {
    first: await writeInterfacePackageFixture(directory, {
      ...shared,
      file: '校园英语话题卡.lsinterface',
      instances: [schoolLife, technology]
    }),
    second: await writeInterfacePackageFixture(directory, {
      ...shared,
      file: '校园英语话题卡-更新.lsinterface',
      instances: [
        schoolLife,
        {
          ...technology,
          values: {
            topicText: 'Technology and the environment',
            answerText: 'Recycling old devices keeps useful materials in use.'
          }
        },
        {
          instanceId: '91000000-0000-4000-8000-000000000003',
          name: '假期实践第三套',
          values: {
            topicText: 'Volunteer work in the holiday',
            answerText: 'I helped clean the community library every morning.'
          }
        }
      ]
    })
  }
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
