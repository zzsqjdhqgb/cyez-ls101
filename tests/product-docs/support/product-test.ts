import { test, type Page, type TestInfo } from '@playwright/test'

export const PRODUCT_MANUAL_ANNOTATION = 'product-manual'
export const PRODUCT_STEP_PREFIX = '[product-step:'
export const PRODUCT_EVIDENCE_PREFIX = 'product-evidence:'

export type ProductOwnerKind = 'module' | 'flow' | 'journey'
export type ProductEvidenceKind = 'decision' | 'exception' | 'result'

export interface ProductOwner {
  kind: ProductOwnerKind
  slug: string
  title: string
  order: number
}

export interface ProductManualStepDefinition {
  key: string
  action: string
  expected: string
}

export interface ProductManualDefinition {
  id: string
  owner: ProductOwner
  section: string
  title: string
  purpose: string
  preconditions: readonly string[]
  outcomes: readonly string[]
  manual: readonly ProductGuidePlacement[]
  steps: readonly ProductManualStepDefinition[]
}

export interface ProductGuidePlacement {
  chapter: string
  order: number
}

export interface ProductEvidenceDefinition {
  key: string
  kind: ProductEvidenceKind
  step: string
  caption: string
}

export type ProductStepRunner = <T>(key: string, body: () => Promise<T>) => Promise<T>

type ProductTestBody = (testInfo: TestInfo, step: ProductStepRunner) => Promise<void> | void

export function productTest(
  definition: ProductManualDefinition,
  body: ProductTestBody
): readonly [
  string,
  { annotation: Array<{ type: string; description: string }> },
  (fixtures: Record<string, never>, testInfo: TestInfo) => Promise<void> | void
] {
  validateManualDefinition(definition)
  return [
    `${definition.id} ${definition.title}`,
    {
      annotation: [
        {
          type: PRODUCT_MANUAL_ANNOTATION,
          description: JSON.stringify(definition)
        }
      ]
    },
    // eslint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
    ({}, testInfo) => body(testInfo, (key, stepBody) => productStep(definition, key, stepBody))
  ]
}

export function productJourney(
  definition: ProductManualDefinition & { owner: ProductOwner & { kind: 'journey' } },
  body: ProductTestBody
): ReturnType<typeof productTest> {
  return productTest(definition, body)
}

function productStep<T>(
  definition: ProductManualDefinition,
  key: string,
  body: () => Promise<T>
): Promise<T> {
  validateKey(key, '步骤')
  if (!definition.steps.some((step) => step.key === key)) {
    throw new Error(`产品说明 ${definition.id} 执行了未声明的步骤：${key}`)
  }
  return test.step(`${PRODUCT_STEP_PREFIX}${key}]`, body)
}

export async function evidence(
  testInfo: TestInfo,
  page: Page,
  definition: ProductEvidenceDefinition
): Promise<void> {
  validateKey(definition.key, '截图')
  validateKey(definition.step, '截图步骤')
  if (!definition.caption.trim()) throw new Error('产品文档截图必须提供说明')

  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await document.fonts.ready
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  })

  await testInfo.attach(
    `${PRODUCT_EVIDENCE_PREFIX}${Buffer.from(JSON.stringify(definition), 'utf8').toString('base64url')}`,
    {
      body: await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        style: `
          *, *::before, *::after {
            backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important;
          }

          [role='presentation']:has(> [role='dialog']),
          [role='presentation']:has(> [role='alertdialog']) {
            background: rgb(178 181 181) !important;
          }
        `
      }),
      contentType: 'image/png'
    }
  )
}

export async function prepareProductPage(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-01-15T08:00:00.000Z'))
}

function validateManualDefinition(definition: ProductManualDefinition): void {
  if (!/^[A-Z]{2}-\d{2}$/.test(definition.id)) {
    throw new Error(`产品说明 ID 必须使用 XX-00 格式：${definition.id}`)
  }
  validateKey(definition.owner.slug, '产品文档归属')
  if (!Number.isFinite(definition.owner.order)) {
    throw new Error(`产品说明 ${definition.id} 的文档顺序无效`)
  }
  for (const [field, value] of [
    ['归属标题', definition.owner.title],
    ['说明书章节', definition.section],
    ['标题', definition.title],
    ['用途', definition.purpose]
  ] as const) {
    if (!value.trim()) throw new Error(`产品说明 ${definition.id} 缺少${field}`)
  }
  if (definition.outcomes.length === 0) {
    throw new Error(`产品说明 ${definition.id} 至少需要一条完成结果`)
  }
  if (definition.manual.length === 0) {
    throw new Error(`产品说明 ${definition.id} 至少需要一个产品说明书位置`)
  }
  const chapters = new Set<string>()
  for (const placement of definition.manual) {
    validateKey(placement.chapter, '产品说明书章节')
    if (!Number.isFinite(placement.order)) {
      throw new Error(`产品说明 ${definition.id} 的说明书顺序无效`)
    }
    if (chapters.has(placement.chapter)) {
      throw new Error(`产品说明 ${definition.id} 重复加入产品说明书章节：${placement.chapter}`)
    }
    chapters.add(placement.chapter)
  }

  if (definition.steps.length === 0) {
    throw new Error(`产品说明 ${definition.id} 至少需要一个操作步骤`)
  }
  const stepKeys = new Set<string>()
  for (const step of definition.steps) {
    validateKey(step.key, '步骤')
    if (stepKeys.has(step.key)) {
      throw new Error(`产品说明 ${definition.id} 的步骤标识重复：${step.key}`)
    }
    stepKeys.add(step.key)
    if (!step.action.trim())
      throw new Error(`产品说明 ${definition.id} 的步骤 ${step.key} 缺少操作`)
    if (!step.expected.trim()) {
      throw new Error(`产品说明 ${definition.id} 的步骤 ${step.key} 缺少可见结果`)
    }
  }
}

function validateKey(key: string, label: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`${label}标识必须使用 kebab-case：${key}`)
  }
}
