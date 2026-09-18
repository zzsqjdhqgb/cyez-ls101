import { StrictMode } from 'react'
import type { Root } from 'react-dom/client'
import { StartupApplicationView } from './StartupApplicationView'
import { builtinInterfaceMaintenance } from './features/interfaces/BuiltinInterfaceRuntime'
import { latestReleaseVersion } from './features/release-notes/release-notes'
import { initializeSchemaApplication } from './features/schemas/SchemaApplicationRuntime'
import { templateApplication } from './features/templates/TemplateApplicationRuntime'
import { runStartupPhase } from './startup-phase'
import { markRendererStartupMilestone } from './startup-timing'
import './app/register-settings'
import './app/register-placeholder-routes'

export async function initializeActiveApplication(): Promise<boolean> {
  await runStartupPhase('installation-marker', ensureInstallationMarker)
  await initializeApplicationContent()
  return runStartupPhase('release-notes', claimReleaseNotesVersion)
}

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

async function initializeApplicationContent(): Promise<void> {
  await runStartupPhase('builtin-schemas', initializeSchemaApplication)
  await runStartupPhase('builtin-interfaces', () => builtinInterfaceMaintenance.initialize())
  await runStartupPhase('builtin-templates-and-functions', () => templateApplication.initialize())
}
