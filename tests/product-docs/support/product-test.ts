import {
  test,
  type Page,
  type PlaywrightTestArgs,
  type PlaywrightTestOptions,
  type PlaywrightWorkerArgs,
  type PlaywrightWorkerOptions,
  type TestInfo
} from '@playwright/test'
import type { ProductGuidePlacement } from './product-guide'

export const PRODUCT_BEHAVIOR_ANNOTATION = 'product-behavior'
export const PRODUCT_STEP_PREFIX = '[product-step:'
export const PRODUCT_EVIDENCE_PREFIX = 'product-evidence:'

export type ProductOwnerKind = 'module' | 'flow'
export type ProductEvidenceKind = 'decision' | 'exception' | 'result'

export interface ProductOwner {
  kind: ProductOwnerKind
  slug: string
  title: string
  order: number
}

export interface ProductBehaviorDefinition {
  id: string
  owner: ProductOwner
  capability: string
  title: string
  intent: string
  preconditions: readonly string[]
  guarantees: readonly string[]
  guide: readonly ProductGuidePlacement[]
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

type ProductFixtures = PlaywrightTestArgs &
  PlaywrightTestOptions &
  PlaywrightWorkerArgs &
  PlaywrightWorkerOptions

type ProductTestBody = (fixtures: ProductFixtures, testInfo: TestInfo) => Promise<void> | void

export function productTest(
  definition: ProductBehaviorDefinition,
  body: ProductTestBody
): readonly [
  string,
  { annotation: Array<{ type: string; description: string }> },
  ProductTestBody
] {
  validateBehaviorDefinition(definition)
  return [
    `${definition.id} ${definition.title}`,
    {
      annotation: [
        {
          type: PRODUCT_BEHAVIOR_ANNOTATION,
          description: JSON.stringify(definition)
        }
      ]
    },
    body
  ]
}

export function productStep<T>(key: string, title: string, body: () => Promise<T>): Promise<T> {
  validateKey(key, '步骤')
  return test.step(`${PRODUCT_STEP_PREFIX}${key}] ${title}`, body)
}

export async function evidence(
  testInfo: TestInfo,
  page: Page,
  definition: ProductEvidenceDefinition
): Promise<void> {
  validateKey(definition.key, '截图')
  validateKey(definition.step, '截图步骤')
  if (!definition.caption.trim()) throw new Error('产品文档截图必须提供说明')

  await testInfo.attach(
    `${PRODUCT_EVIDENCE_PREFIX}${Buffer.from(JSON.stringify(definition), 'utf8').toString('base64url')}`,
    {
      body: await page.screenshot({ animations: 'disabled', caret: 'hide', fullPage: true }),
      contentType: 'image/png'
    }
  )
}

function validateBehaviorDefinition(definition: ProductBehaviorDefinition): void {
  if (!/^[A-Z]{2}-\d{2}$/.test(definition.id)) {
    throw new Error(`产品行为 ID 必须使用 XX-00 格式：${definition.id}`)
  }
  validateKey(definition.owner.slug, '产品文档归属')
  if (!Number.isFinite(definition.owner.order)) {
    throw new Error(`产品行为 ${definition.id} 的文档顺序无效`)
  }
  for (const [field, value] of [
    ['归属标题', definition.owner.title],
    ['能力', definition.capability],
    ['标题', definition.title],
    ['意图', definition.intent]
  ] as const) {
    if (!value.trim()) throw new Error(`产品行为 ${definition.id} 缺少${field}`)
  }
  if (definition.guarantees.length === 0) {
    throw new Error(`产品行为 ${definition.id} 至少需要一条行为保证`)
  }
  if (definition.guide.length === 0) {
    throw new Error(`产品行为 ${definition.id} 至少需要一个用户指南位置`)
  }
  const chapters = new Set<string>()
  for (const placement of definition.guide) {
    validateKey(placement.chapter, '用户指南章节')
    if (!Number.isFinite(placement.order)) {
      throw new Error(`产品行为 ${definition.id} 的用户指南顺序无效`)
    }
    if (chapters.has(placement.chapter)) {
      throw new Error(`产品行为 ${definition.id} 重复加入用户指南章节：${placement.chapter}`)
    }
    chapters.add(placement.chapter)
  }
}

function validateKey(key: string, label: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    throw new Error(`${label}标识必须使用 kebab-case：${key}`)
  }
}
