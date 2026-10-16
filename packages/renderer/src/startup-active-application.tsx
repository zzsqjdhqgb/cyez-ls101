import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import { StartupApplicationView } from './StartupApplicationView'
import { initializeInterfaceContent } from './features/interfaces/BuiltinInterfaceRuntime'
import { latestReleaseVersion } from './features/release-notes/release-notes'
import { initializeSchemaApplication } from './features/schemas/SchemaApplicationRuntime'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import { runStartupPhase } from './startup-phase'
import { markRendererStartupMilestone } from './startup-timing'
// 业务模块加载时通过副作用导入注册设置页与应用路由。
import './app/register-settings'
import './app/register-placeholder-routes'

/** 激活后依次写入安装标记、准备内置内容，并领取更新说明展示资格。 */
export async function initializeActiveApplication(): Promise<boolean> {
  await runStartupPhase('installation-marker', ensureInstallationMarker)
  await initializeApplicationContent()
  return runStartupPhase('release-notes', claimReleaseNotesVersion)
}

/** 使用已有 React 根节点切换到主界面，并记录发起渲染的时间。 */
export function renderActiveApplication(root: Root, showReleaseNotes: boolean): void {
  markRendererStartupMilestone('main-interface-render-requested')
  root.render(
    <StrictMode>
      <StartupApplicationView showReleaseNotes={showReleaseNotes} />
    </StrictMode>
  )
}

async function ensureInstallationMarker(): Promise<void> {
  const appInfo = window.appInfo
  if (!appInfo) throw new Error('应用信息服务不可用')
  await appInfo.ensureInstallationMarker()
}

async function claimReleaseNotesVersion(): Promise<boolean> {
  const appInfo = window.appInfo
  if (!appInfo) throw new Error('应用信息服务不可用')
  return appInfo.claimReleaseNotesVersion(latestReleaseVersion)
}

/** 按评分单元、题型、模板与函数的依赖顺序初始化内置内容。 */
async function initializeApplicationContent(): Promise<void> {
  await runStartupPhase('builtin-schemas', initializeSchemaApplication)
  await runStartupPhase('builtin-interfaces', initializeInterfaceContent)
  await runStartupPhase('builtin-templates-and-functions', () => templateApplication.initialize())
}
