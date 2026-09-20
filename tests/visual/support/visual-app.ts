import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import {
  closeStartupReleaseNotes,
  launchIntegrationApp
} from '../../integration/support/electron-app'
import { installDeterminism } from './determinism'

/** 与产品文档、视觉基线共用的固定内容区。 */
export const VISUAL_CONTENT_SIZE = { width: 1280, height: 800 } as const

const COLOR_DIFFERENCE_THRESHOLD = 0.1
/** 截图前的统一稳定等待，避开列表/汇总/预览的加载中间态。 */
const VISUAL_SETTLE_MS = 800
const projectRoot = process.cwd()
const BASELINE_ROOT = path.join(projectRoot, 'tests', 'visual', 'baselines')
const PREVIEW_ROOT = path.join(projectRoot, 'test-results', 'visual-preview')

export type VisualMode = 'preview' | 'publish' | 'check'

export interface VisualLaunchOptions {
  /** 未激活启动用于许可激活覆盖层（UI-OV-01）。 */
  license?: 'activated' | 'not-activated'
  /** 覆盖层界面不显示版本说明时可关闭该步骤。 */
  closeReleaseNotes?: boolean
}

/**
 * 运行模式：
 * - 默认（Docker 外）：`preview`，只把截图写到 `test-results/visual-preview`，只验证测试通过；
 * - `publish`（canonical 容器内）：写入 `tests/visual/baselines`；
 * - `check`（canonical 容器内）：与已提交基线比较，存在差异即失败。
 *
 * 基线写入与回归校验只允许发生在 canonical 渲染容器内。
 */
export function visualMode(): VisualMode {
  const mode = process.env['LS101_VISUAL_MODE']
  if (mode === 'publish' || mode === 'check') {
    if (process.env['LS101_VISUAL_CANONICAL'] !== '1') {
      throw new Error('视觉基线写入或校验只能在 canonical 渲染容器内进行')
    }
    return mode
  }
  return 'preview'
}

/**
 * 启动打包后的应用，使用视觉基线所需的确定性设置：
 * 固定内容区、1x 倍率、固定随机种子（Math.random 序列稳定）。
 */
export async function launchVisualApp(
  userDataDir: string,
  options: VisualLaunchOptions = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await launchIntegrationApp(userDataDir, {
    contentSize: VISUAL_CONTENT_SIZE,
    deviceScaleFactor: 1,
    extraArgs: ['--disable-gpu'],
    randomSeed: 1,
    ...(options.license ? { license: options.license } : {})
  })
  const page = await app.firstWindow()
  await installDeterminism(page)
  await page.waitForLoadState('domcontentloaded')
  if (options.closeReleaseNotes !== false) {
    await closeStartupReleaseNotes(page)
  }
  return { app, page }
}

/**
 * 捕获一个界面状态。
 * - preview：写入 `test-results/visual-preview/<UI-ID>/<state>.png`（不提交）；
 * - publish：写入 `tests/visual/baselines/<UI-ID>/<state>.png`；
 * - check：与基线逐像素比较，不一致即抛错。
 */
export async function captureState(page: Page, uiId: string, state: string): Promise<string> {
  const mode = visualMode()
  // 等待异步数据装载完成（列表、汇总数字、预览），再等到连续两帧完全一致，
  // 避免截到加载中间态或懒加载资源尚未稳定的画面。
  await page.waitForTimeout(VISUAL_SETTLE_MS)
  const buffer = await stableScreenshot(page)

  if (mode === 'preview') {
    const file = path.join(PREVIEW_ROOT, uiId, `${state}.png`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, buffer)
    return file
  }

  const baseline = path.join(BASELINE_ROOT, uiId, `${state}.png`)
  if (mode === 'publish') {
    await mkdir(path.dirname(baseline), { recursive: true })
    await writeFile(baseline, buffer)
    return baseline
  }

  const committed = await readFile(baseline).catch((reason: NodeJS.ErrnoException) => {
    if (reason.code === 'ENOENT') return null
    throw reason
  })
  if (!committed) {
    await attachVisualDiagnostics(uiId, state, buffer)
    throw new Error(
      `缺少视觉基线：${path.relative(projectRoot, baseline)}（先在 canonical 容器内运行 yarn visual:publish）`
    )
  }
  const comparison = comparePng(committed, buffer)
  if (!comparison.matches) {
    await attachVisualDiagnostics(uiId, state, buffer, committed, comparison.diff)
    throw new Error(`视觉回归差异：${path.relative(projectRoot, baseline)}`)
  }
  return baseline
}

/** 连续两帧字节完全一致才返回，用于避开懒加载与异步渲染的中间态。 */
async function stableScreenshot(page: Page): Promise<Buffer> {
  let previous = await page.screenshot({ animations: 'disabled' })
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.waitForTimeout(250)
    const next = await page.screenshot({ animations: 'disabled' })
    if (next.equals(previous)) return next
    previous = next
  }
  return previous
}

function comparePng(left: Buffer, right: Buffer): { matches: boolean; diff?: Buffer } {
  if (left.equals(right)) return { matches: true }
  try {
    const leftImage = PNG.sync.read(left)
    const rightImage = PNG.sync.read(right)
    if (leftImage.width !== rightImage.width || leftImage.height !== rightImage.height) {
      return { matches: false }
    }
    const diff = new PNG({ width: leftImage.width, height: leftImage.height })
    const changedPixels = pixelmatch(
      leftImage.data,
      rightImage.data,
      diff.data,
      leftImage.width,
      leftImage.height,
      { threshold: COLOR_DIFFERENCE_THRESHOLD }
    )
    return changedPixels === 0 ? { matches: true } : { matches: false, diff: PNG.sync.write(diff) }
  } catch {
    return { matches: false }
  }
}

async function attachVisualDiagnostics(
  uiId: string,
  state: string,
  actual: Buffer,
  expected?: Buffer,
  diff?: Buffer
): Promise<void> {
  const info = test.info()
  for (const [kind, buffer] of Object.entries({ actual, expected, diff })) {
    if (!buffer) continue
    const name = `${uiId}-${state}-${kind}`
    const file = info.outputPath(`${name}.png`)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, buffer)
    await info.attach(name, { path: file, contentType: 'image/png' })
  }
}

/** 通过一级导航进入界面；导航项使用 aria-label 暴露名称。 */
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label }).click()
}

/**
 * 为当前测试准备一个**稳定路径**的用户数据目录。
 * 界面上会出现数据目录路径（例如 UI-ST-02），使用随机临时目录会让基线无法复现；
 * 这里按规格文件名派生路径，并在每次运行前清空，保证起点一致。
 */
export async function prepareVisualUserDataDir(): Promise<string> {
  const specName = path.basename(test.info().file, '.spec.ts')
  const directory = path.join(projectRoot, 'test-results', 'visual-userdata', specName)
  await rm(directory, { force: true, recursive: true })
  await mkdir(directory, { recursive: true })
  return directory
}
