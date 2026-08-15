import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
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

interface DocumentDefinition {
  filename: string
  source: string
  title: string
}

const DOCUMENTS: readonly DocumentDefinition[] = [
  { source: 'interface-library.spec.ts', filename: 'interface-library.md', title: '题型库' },
  {
    source: 'submission-settlement.spec.ts',
    filename: 'submission-records.md',
    title: '作答记录'
  },
  {
    source: 'template-exam-generation.spec.ts',
    filename: 'template-exam-generation.md',
    title: '试卷模板生成试卷'
  },
  { source: 'workbench.spec.ts', filename: 'workbench.md', title: '工作台与导航' }
]

export default class ProductDocsReporter implements Reporter {
  private suite: Suite | null = null

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite
  }

  async onEnd(result: FullResult): Promise<void> {
    if (result.status !== 'passed' || !this.suite) return

    const tests = this.suite.allTests().filter((test) => productArea(test) !== null)
    const groups = DOCUMENTS.map((document) => ({
      document,
      tests: tests.filter((test) => path.basename(test.location.file) === document.source)
    })).filter(({ tests: documentTests }) => documentTests.length > 0)

    const knownSources = new Set(DOCUMENTS.map((document) => document.source))
    const unknownTest = tests.find((test) => !knownSources.has(path.basename(test.location.file)))
    if (unknownTest) {
      throw new Error(
        `Product documentation file is not registered: ${path.basename(unknownTest.location.file)}`
      )
    }

    await rm(GENERATED_DIR, { force: true, recursive: true })
    await mkdir(ASSET_DIR, { recursive: true })

    for (const { document, tests: documentTests } of groups) {
      const sections = await Promise.all(documentTests.map((test) => this.renderTest(test)))
      const markdown = [
        generatedNotice(),
        '',
        `# ${document.title}`,
        '',
        generationNotice(),
        '',
        ...sections
      ].join('\n')
      await writeFile(path.join(GENERATED_DIR, document.filename), `${markdown}\n`, 'utf8')
    }

    const index = [
      generatedNotice(),
      '',
      '# 产品行为文档',
      '',
      generationNotice(),
      '',
      ...groups.flatMap(({ document, tests: documentTests }) => [
        `## ${document.title}`,
        '',
        ...documentTests.map((test) => {
          const summary = annotation(test, 'summary')
          const suffix = summary ? ` - ${summary}` : ''
          return `- [${test.title}](./${document.filename}#${markdownAnchor(test.title)})${suffix}`
        }),
        ''
      ])
    ].join('\n')

    await writeFile(path.join(GENERATED_DIR, 'README.md'), `${index}\n`, 'utf8')
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

function generatedNotice(): string {
  return '<!-- 此文件由 Playwright 产品文档测试自动生成，请勿手工编辑。 -->'
}

function generationNotice(): string {
  return '> 生成命令：`yarn test:product-docs`。只有整套产品文档测试全部通过时才会更新本文档。'
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

function markdownAnchor(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}
