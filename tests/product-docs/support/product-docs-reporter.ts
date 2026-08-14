import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep
} from '@playwright/test/reporter'

const GENERATED_DIR = path.join(process.cwd(), 'docs', 'product', 'generated')
const ASSET_DIR = path.join(GENERATED_DIR, 'assets')

export default class ProductDocsReporter implements Reporter {
  private suite: Suite | null = null

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite
  }

  async onEnd(result: FullResult): Promise<void> {
    if (result.status !== 'passed' || !this.suite) return

    const tests = this.suite.allTests().filter((test) => productArea(test) !== null)
    await mkdir(ASSET_DIR, { recursive: true })
    const sections = await Promise.all(tests.map((test) => this.renderTest(test)))
    const markdown = [
      '<!-- 此文件由 Playwright 产品文档测试自动生成，请勿手工编辑。 -->',
      '',
      '# 产品行为文档',
      '',
      '> 生成命令：`yarn test:product-docs`。只有整套产品文档测试全部通过时才会更新本文档。',
      '',
      ...sections
    ].join('\n')

    await mkdir(GENERATED_DIR, { recursive: true })
    await writeFile(path.join(GENERATED_DIR, 'README.md'), `${markdown}\n`, 'utf8')
  }

  private async renderTest(test: TestCase): Promise<string> {
    const result = latestPassedResult(test)
    if (!result) throw new Error(`Product documentation test did not pass: ${test.title}`)

    const area = productArea(test) ?? '未分类'
    const summary = annotation(test, 'summary')
    const preconditions = annotations(test, 'precondition')
    const steps = flattenProductSteps(result.steps)
    const screenshots = result.attachments.filter(
      (attachment) => attachment.contentType === 'image/png' && (attachment.path || attachment.body)
    )

    const imageMarkdown: string[] = []
    for (const [index, screenshot] of screenshots.entries()) {
      const filename = `${slug(test.title)}-${index + 1}.png`
      const target = path.join(ASSET_DIR, filename)
      if (screenshot.path) await copyFile(screenshot.path, target)
      else await writeFile(target, screenshot.body!)
      imageMarkdown.push(`![${screenshot.name}](./assets/${filename})`)
    }

    return [
      `## ${test.title}`,
      '',
      `**功能区域：** ${area}`,
      '',
      summary ? summary : '',
      summary ? '' : '',
      preconditions.length > 0 ? '**前置条件：**' : '',
      preconditions.length > 0 ? '' : '',
      ...preconditions.map((value) => `- ${value}`),
      preconditions.length > 0 ? '' : '',
      '**用户路径：**',
      '',
      ...steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      ...imageMarkdown,
      ''
    ]
      .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
      .join('\n')
  }
}

function latestPassedResult(test: TestCase): TestResult | null {
  return [...test.results].reverse().find((result) => result.status === 'passed') ?? null
}

function productArea(test: TestCase): string | null {
  return annotation(test, 'product-area')
}

function annotation(test: TestCase, type: string): string | null {
  return test.annotations.find((item) => item.type === type)?.description ?? null
}

function annotations(test: TestCase, type: string): string[] {
  return test.annotations
    .filter((item) => item.type === type && item.description)
    .map((item) => item.description!)
}

function flattenProductSteps(steps: readonly TestStep[]): string[] {
  return steps.flatMap((step) => {
    const nested = flattenProductSteps(step.steps)
    return step.category === 'test.step' ? [step.title, ...nested] : nested
  })
}

function slug(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return normalized || 'product-behavior'
}
