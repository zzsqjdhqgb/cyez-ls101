import { copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { format, resolveConfig } from 'prettier'
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep
} from '@playwright/test/reporter'
import {
  PRODUCT_BEHAVIOR_ANNOTATION,
  PRODUCT_EVIDENCE_PREFIX,
  PRODUCT_STEP_PREFIX,
  type ProductBehaviorDefinition,
  type ProductEvidenceDefinition,
  type ProductOwner
} from './product-test'
import {
  PRODUCT_GUIDE_CHAPTERS,
  productGuideChapter,
  type ProductGuideChapter
} from './product-guide'

const REPOSITORY_ROOT = process.cwd()
const PRODUCT_ROOT = path.join(REPOSITORY_ROOT, 'docs', 'product')
const PREVIEW_ROOT = path.join(REPOSITORY_ROOT, 'test-results', 'product-docs-preview')
const STAGING_ROOT = path.join(PRODUCT_ROOT, '.product-docs-staging')
const MANIFEST_PATH = path.join(PRODUCT_ROOT, '.generated-manifest.json')
const MAX_EVIDENCE_PER_BEHAVIOR = 3
const prettierConfig = resolveConfig(REPOSITORY_ROOT)

interface BehaviorResult {
  definition: ProductBehaviorDefinition
  evidence: readonly EvidenceResult[]
  sourceFile: string
  steps: readonly ProductStep[]
}

interface EvidenceResult {
  definition: ProductEvidenceDefinition
  attachment: TestResult['attachments'][number]
}

interface ProductStep {
  key: string
  title: string
}

interface ProductManifest {
  schemaVersion: 3
  owners: Array<{
    kind: ProductOwner['kind']
    slug: string
    specIds: string[]
  }>
  guideChapters: Array<{
    slug: string
    title: string
    journeyIds: string[]
    behaviorIds: string[]
  }>
  generatedFiles: string[]
}

export default class ProductDocsReporter implements Reporter {
  private suite: Suite | null = null

  onBegin(_config: FullConfig, suite: Suite): void {
    this.suite = suite
  }

  async onEnd(result: FullResult): Promise<void> {
    if (result.status !== 'passed' || !this.suite) return
    if (
      this.suite
        .allTests()
        .every(
          (test) =>
            test.results.length === 0 || test.results.every((item) => item.status === 'skipped')
        )
    ) {
      return
    }

    const behaviors = this.suite
      .allTests()
      .map((test) => behaviorResult(test))
      .filter((behavior): behavior is BehaviorResult => behavior !== null)

    validateBehaviors(behaviors)

    const canonical = process.env.PRODUCT_DOCS_CANONICAL === '1'
    const outputRoot = canonical ? STAGING_ROOT : PREVIEW_ROOT
    await rm(outputRoot, { force: true, recursive: true })
    await mkdir(outputRoot, { recursive: true })

    const manifest = await renderDocumentation(outputRoot, behaviors)

    if (canonical) {
      await publishCanonicalDocumentation(outputRoot, manifest)
    }
  }
}

function behaviorResult(test: TestCase): BehaviorResult | null {
  const serialized = annotation(test, PRODUCT_BEHAVIOR_ANNOTATION)
  if (!serialized) return null

  const result = [...test.results].reverse().find((candidate) => candidate.status === 'passed')
  if (!result) throw new Error(`产品文档测试没有成功结果：${test.title}`)

  const definition = JSON.parse(serialized) as ProductBehaviorDefinition
  const steps = productSteps(result.steps)
  const evidenceItems = result.attachments
    .filter((attachment) => attachment.name.startsWith(PRODUCT_EVIDENCE_PREFIX))
    .map((attachment) => ({
      definition: parseEvidence(attachment.name),
      attachment
    }))

  return {
    definition,
    evidence: evidenceItems,
    sourceFile: test.location.file,
    steps
  }
}

function validateBehaviors(behaviors: readonly BehaviorResult[]): void {
  if (behaviors.length === 0) throw new Error('没有发现产品行为测试')

  const ids = new Set<string>()
  const owners = new Map<string, ProductOwner>()
  for (const behavior of behaviors) {
    const { definition } = behavior
    if (ids.has(definition.id)) throw new Error(`产品行为 ID 重复：${definition.id}`)
    ids.add(definition.id)

    const ownerKey = `${definition.owner.kind}:${definition.owner.slug}`
    const existingOwner = owners.get(ownerKey)
    if (
      existingOwner &&
      (existingOwner.title !== definition.owner.title ||
        existingOwner.order !== definition.owner.order)
    ) {
      throw new Error(`产品文档归属标题不一致：${ownerKey}`)
    }
    owners.set(ownerKey, definition.owner)

    for (const placement of definition.guide) {
      if (!productGuideChapter(placement.chapter)) {
        throw new Error(`产品行为 ${definition.id} 引用了未知的用户指南章节：${placement.chapter}`)
      }
    }

    const stepKeys = new Set(behavior.steps.map((step) => step.key))
    if (stepKeys.size !== behavior.steps.length) {
      throw new Error(`产品行为 ${definition.id} 存在重复步骤标识`)
    }
    if (behavior.steps.length === 0) throw new Error(`产品行为 ${definition.id} 没有产品步骤`)
    if (behavior.evidence.length > MAX_EVIDENCE_PER_BEHAVIOR) {
      throw new Error(`产品行为 ${definition.id} 最多允许 ${MAX_EVIDENCE_PER_BEHAVIOR} 张截图`)
    }

    const evidenceKeys = new Set<string>()
    for (const item of behavior.evidence) {
      if (evidenceKeys.has(item.definition.key)) {
        throw new Error(`产品行为 ${definition.id} 的截图标识重复：${item.definition.key}`)
      }
      evidenceKeys.add(item.definition.key)
      if (!stepKeys.has(item.definition.step)) {
        throw new Error(
          `产品行为 ${definition.id} 的截图 ${item.definition.key} 指向未知步骤 ${item.definition.step}`
        )
      }
    }
  }
}

async function renderDocumentation(
  outputRoot: string,
  behaviors: readonly BehaviorResult[]
): Promise<ProductManifest> {
  const generatedFiles: string[] = []
  const ownerGroups = groupByOwner(behaviors)

  for (const group of ownerGroups) {
    const ownerRoot = ownerRelativeRoot(group.owner)
    const designPath = path.join(PRODUCT_ROOT, ownerRoot, 'README.md')
    if (!(await exists(designPath))) {
      throw new Error(
        `产品文档归属缺少设计文档：${normalizePath(path.relative(REPOSITORY_ROOT, designPath))}`
      )
    }
    const behaviorRoot = path.join(outputRoot, ownerRoot, ownerGeneratedDirectory(group.owner))
    await mkdir(path.join(behaviorRoot, 'assets'), { recursive: true })

    for (const behavior of group.behaviors) {
      const scenarioRelativePath = path.join(
        ownerRoot,
        ownerGeneratedDirectory(group.owner),
        `${behavior.definition.id}.md`
      )
      const scenarioPath = path.join(outputRoot, scenarioRelativePath)
      const scenarioMarkdown = await renderBehaviorPage(outputRoot, behavior, generatedFiles)
      await writeGeneratedFile(outputRoot, scenarioPath, scenarioMarkdown, generatedFiles)
    }

    const indexPath = path.join(behaviorRoot, 'README.md')
    await writeGeneratedFile(
      outputRoot,
      indexPath,
      renderOwnerIndex(group.owner, group.behaviors),
      generatedFiles
    )
  }

  await renderProductGuide(outputRoot, behaviors, generatedFiles)

  const coveragePath = path.join(outputRoot, 'coverage.md')
  await writeGeneratedFile(outputRoot, coveragePath, renderCoverage(ownerGroups), generatedFiles)

  const manifest: ProductManifest = {
    schemaVersion: 3,
    owners: ownerGroups.map((group) => ({
      kind: group.owner.kind,
      slug: group.owner.slug,
      specIds: group.behaviors.map((behavior) => behavior.definition.id)
    })),
    guideChapters: [...PRODUCT_GUIDE_CHAPTERS]
      .sort((left, right) => left.order - right.order)
      .map((chapter) => ({
        slug: chapter.slug,
        title: chapter.title,
        journeyIds: behaviors
          .filter(
            (behavior) =>
              behavior.definition.owner.kind === 'journey' &&
              behavior.definition.guide.some((placement) => placement.chapter === chapter.slug)
          )
          .sort((left, right) => left.definition.id.localeCompare(right.definition.id))
          .map((behavior) => behavior.definition.id),
        behaviorIds: behaviors
          .filter(
            (behavior) =>
              behavior.definition.owner.kind !== 'journey' &&
              behavior.definition.guide.some((placement) => placement.chapter === chapter.slug)
          )
          .sort((left, right) => left.definition.id.localeCompare(right.definition.id))
          .map((behavior) => behavior.definition.id)
      })),
    generatedFiles: [...generatedFiles, '.generated-manifest.json'].sort()
  }
  await writeFile(
    path.join(outputRoot, '.generated-manifest.json'),
    await format(JSON.stringify(manifest), {
      ...((await prettierConfig) ?? {}),
      printWidth: 100,
      parser: 'json'
    }),
    'utf8'
  )
  return manifest
}

async function renderProductGuide(
  outputRoot: string,
  behaviors: readonly BehaviorResult[],
  generatedFiles: string[]
): Promise<void> {
  const guideRoot = path.join(outputRoot, 'guide')
  const chapters = [...PRODUCT_GUIDE_CHAPTERS].sort(
    (left, right) => left.order - right.order || left.slug.localeCompare(right.slug)
  )
  await writeGeneratedFile(
    outputRoot,
    path.join(guideRoot, 'README.md'),
    renderGuideIndex(chapters, behaviors),
    generatedFiles
  )

  for (const [index, chapter] of chapters.entries()) {
    await writeGeneratedFile(
      outputRoot,
      path.join(guideRoot, guideChapterFilename(chapter, index)),
      renderGuideChapter(chapter, index, chapters, behaviors),
      generatedFiles
    )
  }
}

function renderGuideIndex(
  chapters: readonly ProductGuideChapter[],
  behaviors: readonly BehaviorResult[]
): string {
  return [
    generatedNotice(),
    '',
    '# LS101 用户指南',
    '',
    '本指南按一次考试从准备到产出结果的真实工作顺序组织，而不是按软件模块罗列功能。“已验证用户旅程”通过界面从起点连续产出并消费业务对象；“已验证产品行为”证明局部规则和异常边界；“尚待自动验证”明确当前证据范围。',
    '',
    '## 完整路径',
    '',
    ...chapters.map((chapter, index) => {
      const chapterSpecs = behaviors.filter((behavior) =>
        behavior.definition.guide.some((placement) => placement.chapter === chapter.slug)
      )
      const journeyCount = chapterSpecs.filter(
        (behavior) => behavior.definition.owner.kind === 'journey'
      ).length
      const behaviorCount = chapterSpecs.length - journeyCount
      return `${index + 1}. [${chapter.title}](./${guideChapterFilename(chapter, index)})：${chapter.goal}（${journeyCount} 条完整旅程，${behaviorCount} 条产品行为）`
    }),
    '',
    '## 阅读方法',
    '',
    '- 第一次使用时按章节顺序阅读，先理解对象关系，再进入具体操作。',
    '- 只处理某个阶段时，直接进入对应章节；每条旅程和行为都链接到保证、截图和可执行测试。',
    '- 完整旅程不通过仓储预置核心业务对象；产品行为可以声明并构造自己的前置状态。',
    '- 没有出现在已验证旅程或行为中的功能不表示不存在，只表示尚未进入产品文档测试的证据范围。',
    ''
  ].join('\n')
}

function renderGuideChapter(
  chapter: ProductGuideChapter,
  chapterIndex: number,
  chapters: readonly ProductGuideChapter[],
  behaviors: readonly BehaviorResult[]
): string {
  const chapterBehaviors = behaviors
    .flatMap((behavior) =>
      behavior.definition.guide
        .filter((placement) => placement.chapter === chapter.slug)
        .map((placement) => ({ behavior, order: placement.order }))
    )
    .sort(
      (left, right) =>
        left.order - right.order ||
        left.behavior.definition.id.localeCompare(right.behavior.definition.id)
    )
  const journeys = chapterBehaviors.filter(
    ({ behavior }) => behavior.definition.owner.kind === 'journey'
  )
  const supportingBehaviors = chapterBehaviors.filter(
    ({ behavior }) => behavior.definition.owner.kind !== 'journey'
  )
  const previous = chapters[chapterIndex - 1]
  const next = chapters[chapterIndex + 1]
  const navigation = [
    previous
      ? `[上一章：${previous.title}](./${guideChapterFilename(previous, chapterIndex - 1)})`
      : '',
    '[返回指南](./README.md)',
    next ? `[下一章：${next.title}](./${guideChapterFilename(next, chapterIndex + 1)})` : ''
  ].filter(Boolean)

  return [
    generatedNotice(),
    '',
    `# ${chapterIndex + 1}. ${chapter.title}`,
    '',
    navigation.join(' · '),
    '',
    '## 这一阶段要完成什么',
    '',
    chapter.goal,
    '',
    '## 为什么需要这一步',
    '',
    chapter.why,
    '',
    '## 开始前准备',
    '',
    ...chapter.inputs.map((item) => `- ${item}`),
    '',
    '## 已验证用户旅程',
    '',
    ...(journeys.length > 0
      ? journeys.flatMap(({ behavior }, index) => renderGuideBehavior(behavior, index + 1))
      : ['当前还没有通过界面完整跑通的用户旅程。']),
    '',
    '## 已验证产品行为',
    '',
    ...(supportingBehaviors.length > 0
      ? supportingBehaviors.flatMap(({ behavior }, index) =>
          renderGuideBehavior(behavior, index + 1)
        )
      : ['当前还没有独立验证的产品行为。']),
    '',
    '## 完成后的产物',
    '',
    ...chapter.outputs.map((item) => `- ${item}`),
    '',
    '## 接下来',
    '',
    chapter.next,
    '',
    '## 尚待自动验证',
    '',
    ...(chapter.unverifiedActions.length > 0
      ? chapter.unverifiedActions.map((item) => `- ${item}`)
      : ['- 本章列出的产品路径均已有自动化证据。']),
    ''
  ].join('\n')
}

function renderGuideBehavior(behavior: BehaviorResult, index: number): string[] {
  const definition = behavior.definition
  const detail = normalizePath(
    path.join(
      '..',
      ownerRelativeRoot(definition.owner),
      ownerGeneratedDirectory(definition.owner),
      `${definition.id}.md`
    )
  )
  return [
    `### ${index}. ${definition.title}`,
    '',
    definition.intent,
    '',
    '**开始前：**',
    '',
    ...(definition.preconditions.length > 0
      ? definition.preconditions.map((item) => `- ${item}`)
      : ['- 无额外前置条件。']),
    '',
    '**操作顺序：**',
    '',
    ...behavior.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step.title}`),
    '',
    '**完成标准：**',
    '',
    ...definition.guarantees.map((item) => `- ${item}`),
    '',
    `[查看 ${definition.id} 的截图、异常分支与可执行规格](${detail})`,
    ''
  ]
}

function guideChapterFilename(chapter: ProductGuideChapter, index: number): string {
  return `${String(index + 1).padStart(2, '0')}-${chapter.slug}.md`
}

async function renderBehaviorPage(
  outputRoot: string,
  behavior: BehaviorResult,
  generatedFiles: string[]
): Promise<string> {
  const evidenceByStep = new Map<string, EvidenceResult[]>()
  for (const item of behavior.evidence) {
    const existing = evidenceByStep.get(item.definition.step) ?? []
    existing.push(item)
    evidenceByStep.set(item.definition.step, existing)
  }

  const stepLines: string[] = []
  for (const [index, step] of behavior.steps.entries()) {
    stepLines.push(`${index + 1}. ${step.title}`)
    for (const item of evidenceByStep.get(step.key) ?? []) {
      const assetRelativePath = path.join(
        ownerRelativeRoot(behavior.definition.owner),
        ownerGeneratedDirectory(behavior.definition.owner),
        'assets',
        behavior.definition.id,
        `${item.definition.key}.png`
      )
      const assetPath = path.join(outputRoot, assetRelativePath)
      await mkdir(path.dirname(assetPath), { recursive: true })
      if (item.attachment.path) await copyFile(item.attachment.path, assetPath)
      else if (item.attachment.body) await writeFile(assetPath, item.attachment.body)
      else throw new Error(`产品行为 ${behavior.definition.id} 的截图没有内容`)
      generatedFiles.push(normalizePath(assetRelativePath))
      stepLines.push(
        '',
        `   ![${item.definition.caption}](./assets/${behavior.definition.id}/${item.definition.key}.png)`,
        '',
        `   _${evidenceKindLabel(item.definition.kind)}：${item.definition.caption}_`,
        ''
      )
    }
  }

  const canonicalScenarioPath = path.join(
    PRODUCT_ROOT,
    ownerRelativeRoot(behavior.definition.owner),
    ownerGeneratedDirectory(behavior.definition.owner),
    `${behavior.definition.id}.md`
  )
  const sourceLink = normalizePath(
    path.relative(path.dirname(canonicalScenarioPath), behavior.sourceFile)
  )
  const { definition } = behavior
  const journey = definition.owner.kind === 'journey'
  return [
    generatedNotice(),
    '',
    `# ${definition.id} ${definition.title}`,
    '',
    `**归属：** ${definition.owner.title} / ${definition.capability}`,
    '',
    `## ${journey ? '旅程目标' : '行为意图'}`,
    '',
    definition.intent,
    '',
    '## 前置条件',
    '',
    ...(definition.preconditions.length > 0
      ? definition.preconditions.map((item) => `- ${item}`)
      : ['- 无额外前置条件。']),
    '',
    '## 用户路径',
    '',
    ...stepLines,
    '',
    `## ${journey ? '旅程保证' : '行为保证'}`,
    '',
    ...definition.guarantees.map((item) => `- ${item}`),
    '',
    '## 可执行规格',
    '',
    `源测试：[${path.basename(behavior.sourceFile)}](${sourceLink})。`,
    ''
  ].join('\n')
}

function renderOwnerIndex(owner: ProductOwner, behaviors: readonly BehaviorResult[]): string {
  const journey = owner.kind === 'journey'
  return [
    generatedNotice(),
    '',
    `# ${owner.title}：${journey ? '已验证旅程' : '已验证行为'}`,
    '',
    `本目录由完整通过的 Playwright 产品文档测试生成。产品设计和业务约束参见[${journey ? '旅程' : '模块或流程'}定义](../README.md)。`,
    '',
    `| 编号 | 能力 | ${journey ? '用户旅程' : '用户行为'} | 证据 |`,
    '| --- | --- | --- | ---: |',
    ...behaviors.map(
      (behavior) =>
        `| ${behavior.definition.id} | ${behavior.definition.capability} | [${behavior.definition.title}](./${behavior.definition.id}.md) | ${behavior.evidence.length} |`
    ),
    ''
  ].join('\n')
}

function renderCoverage(
  groups: readonly { owner: ProductOwner; behaviors: readonly BehaviorResult[] }[]
): string {
  return [
    generatedNotice(),
    '',
    '# 产品测试覆盖',
    '',
    '这里只汇总完整用户旅程与局部产品行为的覆盖情况，不重复场景摘要。按工作顺序阅读请进入[用户指南](./guide/README.md)；按归属审计请进入对应旅程、模块或流程。',
    '',
    '| 类型 | 产品域 | 设计 | 已验证规格 | 截图证据 |',
    '| --- | --- | --- | ---: | ---: |',
    ...groups.map((group) => {
      const root = `./${normalizePath(ownerRelativeRoot(group.owner))}`
      const evidenceCount = group.behaviors.reduce(
        (count, behavior) => count + behavior.evidence.length,
        0
      )
      return `| ${ownerKindLabel(group.owner.kind)} | ${group.owner.title} | [产品定义](${root}/README.md) | [${group.behaviors.length}](${root}/${ownerGeneratedDirectory(group.owner)}/README.md) | ${evidenceCount} |`
    }),
    '',
    `合计：${groups.filter((group) => group.owner.kind === 'journey').reduce((count, group) => count + group.behaviors.length, 0)} 个已验证用户旅程，${groups.filter((group) => group.owner.kind !== 'journey').reduce((count, group) => count + group.behaviors.length, 0)} 个已验证产品行为，${groups.reduce((count, group) => count + group.behaviors.reduce((sum, behavior) => sum + behavior.evidence.length, 0), 0)} 张截图证据。`,
    ''
  ].join('\n')
}

async function writeGeneratedFile(
  outputRoot: string,
  target: string,
  content: string,
  generatedFiles: string[]
): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(
    target,
    await format(content, { ...((await prettierConfig) ?? {}), parser: 'markdown' }),
    'utf8'
  )
  generatedFiles.push(normalizePath(path.relative(outputRoot, target)))
}

async function publishCanonicalDocumentation(
  outputRoot: string,
  manifest: ProductManifest
): Promise<void> {
  const previous = await readManifest()
  const generatedDirectories = new Set([
    ...[...(previous?.owners ?? []), ...manifest.owners].map((owner) =>
      path.join(
        PRODUCT_ROOT,
        ownerKindDirectory(owner.kind),
        owner.slug,
        ownerGeneratedDirectory(owner)
      )
    ),
    path.join(PRODUCT_ROOT, 'guide')
  ])

  const published: Array<{ target: string; backup: string | null }> = []
  const backupTargets = new Set<string>()

  try {
    for (const target of generatedDirectories) {
      const relativeTarget = path.relative(PRODUCT_ROOT, target)
      const staged = path.join(outputRoot, relativeTarget)
      const backup = `${target}.product-docs-backup`
      backupTargets.add(backup)
      const targetExists = await exists(target)
      const stagedExists = await exists(staged)
      await rm(backup, { force: true, recursive: true })
      if (targetExists) {
        await cp(target, backup, { recursive: true })
      }
      published.push({ target, backup: targetExists ? backup : null })
      await rm(target, { force: true, recursive: true })
      if (stagedExists) {
        await mkdir(path.dirname(target), { recursive: true })
        await cp(staged, target, { recursive: true })
      }
    }

    for (const filename of ['coverage.md', '.generated-manifest.json']) {
      const target = path.join(PRODUCT_ROOT, filename)
      const staged = path.join(outputRoot, filename)
      const backup = `${target}.product-docs-backup`
      backupTargets.add(backup)
      const targetExists = await exists(target)
      await rm(backup, { force: true, recursive: true })
      if (targetExists) {
        await copyFile(target, backup)
      }
      published.push({ target, backup: targetExists ? backup : null })
      await rm(target, { force: true })
      await copyFile(staged, target)
    }
  } catch (reason) {
    for (const item of [...published].reverse()) {
      await rm(item.target, { force: true, recursive: true })
      if (item.backup) {
        await mkdir(path.dirname(item.target), { recursive: true })
        await cp(item.backup, item.target, { recursive: true })
      }
    }
    throw reason
  } finally {
    for (const backup of backupTargets) {
      await rm(backup, { force: true, recursive: true })
    }
    await rm(outputRoot, { force: true, recursive: true })
  }
}

async function readManifest(): Promise<ProductManifest | null> {
  try {
    return JSON.parse(await readFile(MANIFEST_PATH, 'utf8')) as ProductManifest
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw reason
  }
}

function groupByOwner(
  behaviors: readonly BehaviorResult[]
): Array<{ owner: ProductOwner; behaviors: BehaviorResult[] }> {
  const groups = new Map<string, { owner: ProductOwner; behaviors: BehaviorResult[] }>()
  for (const behavior of [...behaviors].sort((a, b) =>
    a.definition.id.localeCompare(b.definition.id)
  )) {
    const key = `${behavior.definition.owner.kind}:${behavior.definition.owner.slug}`
    const group = groups.get(key) ?? { owner: behavior.definition.owner, behaviors: [] }
    group.behaviors.push(behavior)
    groups.set(key, group)
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.owner.order - b.owner.order ||
      `${a.owner.kind}:${a.owner.slug}`.localeCompare(`${b.owner.kind}:${b.owner.slug}`)
  )
}

function productSteps(steps: readonly TestStep[]): ProductStep[] {
  return steps.flatMap((step) => {
    const nested = productSteps(step.steps)
    if (!step.title.startsWith(PRODUCT_STEP_PREFIX)) return nested
    const markerEnd = step.title.indexOf(']')
    if (markerEnd < 0) throw new Error(`产品步骤标记无效：${step.title}`)
    return [
      {
        key: step.title.slice(PRODUCT_STEP_PREFIX.length, markerEnd),
        title: step.title.slice(markerEnd + 1).trim()
      },
      ...nested
    ]
  })
}

function parseEvidence(name: string): ProductEvidenceDefinition {
  const encoded = name.slice(PRODUCT_EVIDENCE_PREFIX.length)
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ProductEvidenceDefinition
}

function annotation(test: TestCase, type: string): string | null {
  return test.annotations.find((item) => item.type === type)?.description ?? null
}

function ownerRelativeRoot(owner: ProductOwner): string {
  return path.join(ownerKindDirectory(owner.kind), owner.slug)
}

function ownerKindDirectory(kind: ProductOwner['kind']): string {
  return kind === 'module' ? 'modules' : kind === 'flow' ? 'flows' : 'journeys'
}

function ownerKindLabel(kind: ProductOwner['kind']): string {
  return kind === 'module' ? '模块' : kind === 'flow' ? '流程' : '旅程'
}

function ownerGeneratedDirectory(owner: ProductOwner): string {
  return owner.kind === 'journey' ? 'verified' : 'behaviors'
}

function evidenceKindLabel(kind: ProductEvidenceDefinition['kind']): string {
  return kind === 'decision' ? '决策证据' : kind === 'exception' ? '异常证据' : '结果证据'
}

function generatedNotice(): string {
  return '<!-- 此文件由 Playwright 产品文档测试自动生成，请勿手工编辑。 -->'
}

function normalizePath(value: string): string {
  return value.split(path.sep).join('/')
}

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch (reason) {
    if ((reason as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw reason
  }
}
