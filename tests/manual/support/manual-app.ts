import { test, type ElectronApplication, type Page } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import {
  captureTo,
  launchVisualApp,
  type VisualLaunchOptions,
  type VisualMode
} from '../../visual/support/visual-app'

/**
 * 说明书配图套件的支撑模块。
 *
 * 复用逐屏视觉回归的确定性启动与"预览 / 发布 / 校验"实现，
 * 但基线根目录、预览目录与运行模式变量都与视觉套件分开：
 *
 * - `test-results/manual-preview/<图号>/<状态>.png`（preview，不提交）
 * - `tests/manual/baselines/<图号>/<状态>.png`（publish，提交）
 * - check 与已提交基线逐像素比较
 *
 * 基线只能由 canonical 渲染容器写入或校验；容器外只跑 preview。
 */

const projectRoot = process.cwd()
const BASELINE_ROOT = path.join(projectRoot, 'tests', 'manual', 'baselines')
const PREVIEW_ROOT = path.join(projectRoot, 'test-results', 'manual-preview')

export function manualMode(): VisualMode {
  const mode = process.env['LS101_MANUAL_MODE']
  if (mode === 'publish' || mode === 'check') {
    if (process.env['LS101_MANUAL_CANONICAL'] !== '1') {
      throw new Error('说明书配图基线写入或校验只能在 canonical 渲染容器内进行')
    }
    return mode
  }
  return 'preview'
}

/**
 * 启动打包后的应用，使用与视觉基线相同的确定性设置
 * （固定内容区、1x 倍率、固定随机种子、固定时钟与 UUID、稳定数据目录）。
 */
export async function launchFigureApp(
  userDataDir: string,
  options: VisualLaunchOptions = {}
): Promise<{ app: ElectronApplication; page: Page }> {
  return launchVisualApp(userDataDir, options)
}

/** 捕获一张说明书配图。图号使用 `FIG-<主题>`，状态使用小写 kebab-case。 */
export async function captureFigure(
  page: Page,
  figureId: string,
  state = 'default'
): Promise<string> {
  return captureTo(
    {
      baselineRoot: BASELINE_ROOT,
      previewRoot: PREVIEW_ROOT,
      mode: manualMode(),
      subject: '说明书配图',
      publishCommand: 'yarn manual:figures:publish'
    },
    page,
    figureId,
    state
  )
}

/**
 * 按用例文件派生一个稳定路径的数据目录：配图里出现的路径必须每轮一致。
 * 与视觉套件分开存放，避免两套套件互相清空对方的起点数据。
 */
export async function prepareManualUserDataDir(): Promise<string> {
  const specName = path.basename(test.info().file, '.spec.ts')
  const directory = path.join(projectRoot, 'test-results', 'manual-userdata', specName)
  await rm(directory, { force: true, recursive: true })
  await mkdir(directory, { recursive: true })
  return directory
}

/**
 * 把只属于测试环境的值换成人话，避免手册配图出现开发痕迹：
 * - 数据目录路径：测试跑在 Linux 上，路径是临时目录，与"只支持 Windows"矛盾，统一换成 Windows 示例路径；
 * - 应用版本号：确定性打包版本带 `-local.` 后缀（测试模式需要），换成正式版本号。
 * 只替换这两处文本，界面结构、控件与状态都是真实截图。
 */
export async function normalizeEnvironmentArtifacts(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const samplePath = 'C:\\Users\\teacher\\AppData\\Roaming\\cyez-ls101\\data'
    const version = await window.appInfo.getVersion()
    const baseVersion = version.split('-')[0]

    const replaceInTextNodes = (from: string, to: string): void => {
      if (!from || from === to) return
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
      const targets: Text[] = []
      while (walker.nextNode()) {
        const node = walker.currentNode as Text
        if (node.nodeValue?.includes(from)) targets.push(node)
      }
      for (const node of targets) {
        node.nodeValue = node.nodeValue?.split(from).join(to) ?? ''
      }
    }

    const info = await window.dataDirectory.getInfo().catch(() => null)
    if (info?.currentPath) replaceInTextNodes(info.currentPath, samplePath)
    replaceInTextNodes(version, baseVersion)

    for (const element of document.querySelectorAll('[title]')) {
      const title = element.getAttribute('title') ?? ''
      if (info?.currentPath && title.includes(info.currentPath)) {
        element.setAttribute('title', title.split(info.currentPath).join(samplePath))
      }
      if (title.includes(version)) {
        element.setAttribute('title', title.split(version).join(baseVersion))
      }
    }
  })
}
