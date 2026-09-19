import type { ElectronApplication, Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import {
  closeStartupReleaseNotes,
  launchIntegrationApp
} from '../../integration/support/electron-app'

/** 与产品文档、视觉基线共用的固定内容区。 */
export const VISUAL_CONTENT_SIZE = { width: 1280, height: 800 } as const

const projectRoot = process.cwd()

export interface VisualLaunchOptions {
  /** 未激活启动用于许可激活覆盖层（UI-OV-01）。 */
  license?: 'activated' | 'not-activated'
  /** 覆盖层界面不显示版本说明时可关闭该步骤。 */
  closeReleaseNotes?: boolean
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
  await page.waitForLoadState('domcontentloaded')
  if (options.closeReleaseNotes !== false) {
    await closeStartupReleaseNotes(page)
  }
  return { app, page }
}

/** 只有 canonical 渲染容器可以写正式基线；其他环境一律写 preview。 */
export function isCanonicalVisualRun(): boolean {
  return process.env['LS101_VISUAL_CANONICAL'] === '1'
}

/**
 * 捕获一个界面状态。
 * canonical 运行写入 tests/visual/baselines/<UI-ID>/<state>.png；
 * 本地运行写入 test-results/visual-preview/<UI-ID>/<state>.png（不提交）。
 */
export async function captureState(page: Page, uiId: string, state: string): Promise<string> {
  const directory = isCanonicalVisualRun()
    ? path.join(projectRoot, 'tests', 'visual', 'baselines', uiId)
    : path.join(projectRoot, 'test-results', 'visual-preview', uiId)
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, `${state}.png`)
  await page.screenshot({ path: file, animations: 'disabled' })
  return file
}

/** 通过一级导航进入界面；导航项使用 aria-label 暴露名称。 */
export async function navigateTo(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label }).click()
}
