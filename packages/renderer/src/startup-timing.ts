import { logger } from '@ls101/logger/renderer'

export type RendererStartupMilestone =
  | 'document-script-started'
  | 'startup-logo-ready'
  | 'application-bundle-requested'
  | 'application-bundle-loaded'
  | 'react-root-created'
  | 'main-process-ready'
  | 'license-interface-render-requested'
  | 'migration-interface-render-requested'
  | 'main-interface-render-requested'
  | 'main-interface-first-frame'

const MARK_PREFIX = 'ls101-startup:'
const pendingMilestones: Array<{ milestone: RendererStartupMilestone; elapsedMs: number }> = []
let loggingEnabled = false

export function markRendererStartupMilestone(milestone: RendererStartupMilestone): void {
  const elapsedMs = roundedMilliseconds(performance.now())
  performance.mark(`${MARK_PREFIX}${milestone}`)
  const entry = { milestone, elapsedMs }
  if (loggingEnabled) logMilestone(entry)
  else pendingMilestones.push(entry)
}

export function enableRendererStartupTimingLogging(): void {
  if (loggingEnabled) return
  loggingEnabled = true
  pendingMilestones.splice(0).forEach(logMilestone)
}

function logMilestone(entry: { milestone: RendererStartupMilestone; elapsedMs: number }): void {
  logger.info('Renderer startup milestone', entry)
}

function roundedMilliseconds(milliseconds: number): number {
  return Math.max(0, Math.round(milliseconds * 10) / 10)
}
