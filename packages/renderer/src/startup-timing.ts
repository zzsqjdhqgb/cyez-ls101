import { logger } from '@ls101/logger/renderer'

/** 覆盖入口脚本、应用包加载与首帧展示的渲染进程启动里程碑。 */
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

// Performance 标记可立即写入；业务日志需等主进程就绪后再统一启用。
const MARK_PREFIX = 'ls101-startup:'
const pendingMilestones: Array<{ milestone: RendererStartupMilestone; elapsedMs: number }> = []
let loggingEnabled = false

/** 同时写入 Performance 标记和日志条目，时间相对于当前文档的性能计时起点。 */
export function markRendererStartupMilestone(milestone: RendererStartupMilestone): void {
  const elapsedMs = roundedMilliseconds(performance.now())
  performance.mark(`${MARK_PREFIX}${milestone}`)
  const entry = { milestone, elapsedMs }
  if (loggingEnabled) logMilestone(entry)
  else pendingMilestones.push(entry)
}

/** 幂等启用日志输出，并按顺序补写此前缓存的里程碑。 */
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
