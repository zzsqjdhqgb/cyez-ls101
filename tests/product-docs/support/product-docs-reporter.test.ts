import { mkdtemp, mkdir, readFile, rm, copyFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FullConfig, FullResult, Suite, TestCase } from '@playwright/test/reporter'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PRODUCT_EVIDENCE_PREFIX,
  PRODUCT_MANUAL_ANNOTATION,
  PRODUCT_STEP_PREFIX,
  type ProductManualDefinition,
  type ProductOwner
} from './product-test'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const screenshot = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
)

function passedTest(owner: ProductOwner, index: number): TestCase {
  const definition: ProductManualDefinition = {
    id: `PD-${String(index).padStart(2, '0')}`,
    owner,
    section: '内容准备',
    title: owner.title,
    purpose: '完成产品操作',
    preconditions: [],
    outcomes: ['已完成'],
    manual: [{ chapter: 'prepare-content', order: index }],
    steps: [{ key: 'complete', action: '完成操作', expected: '显示结果' }]
  }
  const evidence = { key: 'result', kind: 'result', step: 'complete', caption: '操作结果' }
  return {
    title: definition.title,
    annotations: [{ type: PRODUCT_MANUAL_ANNOTATION, description: JSON.stringify(definition) }],
    results: [
      {
        status: 'passed',
        steps: [{ title: `${PRODUCT_STEP_PREFIX}complete]`, steps: [] }],
        attachments: [
          {
            name: `${PRODUCT_EVIDENCE_PREFIX}${Buffer.from(JSON.stringify(evidence)).toString('base64url')}`,
            contentType: 'image/png',
            body: screenshot
          }
        ]
      }
    ]
  } as unknown as TestCase
}

describe('ProductDocsReporter preview', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'ls101-docs-reporter-'))
    const moduleDirectory = path.join(directory, 'docs', 'ui', 'modules')
    await mkdir(moduleDirectory, { recursive: true })
    for (const name of ['workbench', 'interface-library', 'template-library', 'exam-library']) {
      await copyFile(
        path.join(repositoryRoot, 'docs', 'ui', 'modules', `${name}.md`),
        path.join(moduleDirectory, `${name}.md`)
      )
    }
    vi.spyOn(process, 'cwd').mockReturnValue(directory)
    vi.stubEnv('PRODUCT_DOCS_CANONICAL', undefined)
    vi.stubEnv('PRODUCT_DOCS_CANONICAL_RUNNER', undefined)
    vi.resetModules()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    await rm(directory, { recursive: true, force: true })
  })

  async function generate(owners: ProductOwner[]): Promise<void> {
    const { default: ProductDocsReporter } = await import('./product-docs-reporter')
    const reporter = new ProductDocsReporter()
    const tests = owners.map((owner, index) => passedTest(owner, index + 1))
    reporter.onBegin({} as FullConfig, { allTests: () => tests } as Suite)
    await reporter.onEnd({ status: 'passed' } as FullResult)
  }

  it('generates module, flow and journey reports with screenshots using current module docs', async () => {
    await generate([
      { kind: 'module', slug: 'workbench', title: '工作台', order: 1 },
      { kind: 'journey', slug: 'content-preparation', title: '准备题型', order: 2 },
      { kind: 'flow', slug: 'template-exam-generation', title: '生成试卷', order: 3 },
      { kind: 'journey', slug: 'exam-delivery', title: '运行考试', order: 4 }
    ])

    const preview = path.join(directory, 'test-results', 'product-docs-preview')
    const manifest = JSON.parse(
      await readFile(path.join(preview, '.generated-manifest.json'), 'utf8')
    )
    for (const [index, root] of [
      'modules/workbench/behaviors',
      'journeys/content-preparation/verified',
      'flows/template-exam-generation/behaviors',
      'journeys/exam-delivery/verified'
    ].entries()) {
      const id = `PD-${String(index + 1).padStart(2, '0')}`
      expect(manifest.generatedFiles).toContain(`${root}/${id}.md`)
      expect(await readFile(path.join(preview, root, `${id}.md`), 'utf8')).toContain('显示结果')
      expect(await readFile(path.join(preview, root, 'assets', id, 'result.png'))).toEqual(
        screenshot
      )
    }
  })

  it('still rejects a missing design document for a mapped journey', async () => {
    await rm(path.join(directory, 'docs', 'ui', 'modules', 'exam-library.md'))
    await expect(
      generate([{ kind: 'journey', slug: 'exam-delivery', title: '运行考试', order: 1 }])
    ).rejects.toThrow('产品文档归属缺少设计文档：docs/ui/modules/exam-library.md')
  })
})
