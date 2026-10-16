// 渲染进程启动编排：创建共享 React 根节点，按主进程就绪 → 许可证状态 → 旧数据整理
// → 完整业务界面的顺序推进；首个交互界面需等启动动画结束，失败统一收敛到错误界面。
import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { logger } from '@ls101/logger/renderer'
import type { LegacyDataInfo, LicenseStatus } from '@ls101/core-types'
import { runStartupPhase } from './startup-phase'
import { waitForStartupCompletionDelay } from './startup-placeholder'
import { enableRendererStartupTimingLogging, markRendererStartupMilestone } from './startup-timing'
import './styles/tokens.css'
import './styles/global.css'

type ActiveApplication = typeof import('./startup-active-application')

/** 准备阶段只确定后续入口：许可证激活、旧数据整理或完整业务界面。 */
type PreparedApplication =
  | { kind: 'license'; status: LicenseStatus }
  | { kind: 'migration'; info: LegacyDataInfo }
  | { kind: 'active'; application: ActiveApplication; showReleaseNotes: boolean }

// 三个阶段共用同一个根节点，切换界面时只重新 render，不重复挂载容器。
let reactRoot: Root

/** 创建共享 React 根节点，安装错误日志后异步推进应用启动。 */
export function startApplication(root: HTMLElement, startupLogoAnimation: Promise<void>): void {
  reactRoot = createRoot(root, {
    onUncaughtError: (error, errorInfo) => {
      logger.error('Uncaught React renderer error', error, {
        componentStack: errorInfo.componentStack ?? undefined
      })
    },
    onCaughtError: (error, errorInfo) => {
      logger.error('Caught React renderer error', error, {
        componentStack: errorInfo.componentStack ?? undefined
      })
    },
    onRecoverableError: (error, errorInfo) => {
      logger.warn('Recoverable React renderer error', {
        error: serializeReason(error),
        componentStack: errorInfo.componentStack ?? undefined
      })
    }
  })
  markRendererStartupMilestone('react-root-created')
  installGlobalErrorLogging()
  void renderApplication(startupLogoAnimation).catch(renderStartupError)
}

/** 并行准备业务与等待启动动画，满足两者后再切换首个交互界面。 */
async function renderApplication(startupLogoAnimation: Promise<void>): Promise<void> {
  // 动画结束后再保留一段停留时间，避免快速启动时占位界面一闪而过。
  const minimumStartupDuration = startupLogoAnimation.then(waitForStartupCompletionDelay)
  // 业务准备与最短展示时长并行等待；业务准备失败时直接进入错误界面。
  const [prepared] = await Promise.all([prepareApplication(), minimumStartupDuration])
  if (prepared.kind === 'license') {
    await renderLicenseActivation(prepared.status)
    return
  }
  if (prepared.kind === 'migration') {
    await completeLegacyDataMigration(prepared.info)
    // 整理完成后才加载业务包，用户停留在整理页期间不需要完整业务依赖。
    const application = await loadActiveApplication()
    application.renderActiveApplication(reactRoot, await application.initializeActiveApplication())
    return
  }
  prepared.application.renderActiveApplication(reactRoot, prepared.showReleaseNotes)
}

/** 等待主进程服务就绪，再按许可证与旧数据状态决定启动分支。 */
async function prepareApplication(): Promise<PreparedApplication> {
  // 桥接对象由 preload 注入；缺失说明预加载脚本未生效，没有可继续的降级路径。
  const startup = window.startup
  if (!startup) throw new Error('启动服务不可用')
  await runStartupPhase('main-process-readiness', () => startup.whenReady())
  // 主进程日志通道已可用，此时补写早期缓存的渲染进程启动记录。
  enableRendererStartupTimingLogging()
  markRendererStartupMilestone('main-process-ready')

  const license = window.license
  if (!license) throw new Error('许可证服务不可用')
  const status = await runStartupPhase('license-status', () => license.getStatus())
  // 未激活时停在激活页，既不加载业务包，也不提前检查旧数据。
  if (status.state !== 'active') return { kind: 'license', status }

  const legacyData = window.legacyData
  if (!legacyData) throw new Error('旧数据整理服务不可用')
  const info = await runStartupPhase('legacy-data-status', () => legacyData.getInfo())
  // none 与 cleaned 都表示无需整理；待归档或失败状态必须先完成整理。
  if (info.status !== 'none' && info.status !== 'cleaned') return { kind: 'migration', info }

  const application = await loadActiveApplication()
  return {
    kind: 'active',
    application,
    showReleaseNotes: await application.initializeActiveApplication()
  }
}

/** 按需加载激活页；激活成功后仍需检查旧数据，再进入完整应用。 */
async function renderLicenseActivation(status: LicenseStatus): Promise<void> {
  // 激活页只在需要时加载；激活成功后要补做上一步跳过的旧数据检查。
  const { LicenseActivationPage } = await import('./features/license/LicenseActivationPage')
  markRendererStartupMilestone('license-interface-render-requested')
  reactRoot.render(
    <StrictMode>
      <LicenseActivationPage
        initialStatus={status}
        onActivated={async () => {
          try {
            const legacyData = window.legacyData
            if (!legacyData) throw new Error('旧数据整理服务不可用')
            const info = await legacyData.getInfo()
            if (info.status !== 'none' && info.status !== 'cleaned') {
              await completeLegacyDataMigration(info)
            }
            const application = await loadActiveApplication()
            application.renderActiveApplication(
              reactRoot,
              await application.initializeActiveApplication()
            )
          } catch (error) {
            // 激活后的初始化失败同样交给错误界面，避免停留在不可用的中间状态。
            renderStartupError(error)
          }
        }}
      />
    </StrictMode>
  )
}

/** 等待用户完成旧数据整理页面，再允许后续业务初始化继续。 */
async function completeLegacyDataMigration(initialInfo: LegacyDataInfo): Promise<void> {
  const { LegacyDataMigrationPage } = await import('./features/legacy-data/LegacyDataMigrationPage')
  markRendererStartupMilestone('migration-interface-render-requested')
  // 启动流程在此挂起，只有整理页回调 onComplete 后才继续渲染后续界面。
  return new Promise((resolve) => {
    reactRoot.render(
      <StrictMode>
        <LegacyDataMigrationPage initialInfo={initialInfo} onComplete={resolve} />
      </StrictMode>
    )
  })
}

/** 将完整业务依赖推迟到许可证和旧数据检查通过后加载。 */
function loadActiveApplication(): Promise<ActiveApplication> {
  return import('./startup-active-application')
}

/** 将启动异常收敛到可重新加载的错误界面。 */
function renderStartupError(reason: unknown): void {
  logger.error('Renderer application initialization failed', reason)
  const message = reason instanceof Error ? reason.message : '未知初始化错误'
  // 直接覆盖根节点内容：无论失败发生在哪个阶段，都只保留重新加载入口。
  reactRoot.render(
    <main className="startupError" role="alert">
      <AlertCircle aria-hidden="true" />
      <h1>应用初始化失败</h1>
      <p>{message}</p>
      <button type="button" onClick={() => window.location.reload()}>
        <RefreshCw aria-hidden="true" />
        重新加载
      </button>
    </main>
  )
}

/** 补充 React 错误回调无法覆盖的全局异常与未处理 Promise 拒绝日志。 */
function installGlobalErrorLogging(): void {
  // 监听器随渲染进程存活、不随界面切换移除，保证任意启动阶段都能记录异常。
  window.addEventListener('error', (event) => {
    logger.error('Unhandled renderer error', event.error, {
      filename: event.filename,
      lineNumber: event.lineno,
      columnNumber: event.colno,
      url: window.location.href
    })
  })

  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled renderer promise rejection', event.reason, {
      url: window.location.href
    })
  })
}

/** RecoverableError 的原因可能不是 Error，统一整理为可读的日志字段。 */
function serializeReason(reason: unknown): string {
  return reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
}
