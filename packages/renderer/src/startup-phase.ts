import { logger, type RendererLogger } from '@ls101/logger/renderer'

/** 可观测的启动阶段名称，供日志定位耗时与失败位置。 */
export type StartupPhase =
  | 'main-process-readiness'
  | 'license-status'
  | 'legacy-data-status'
  | 'installation-marker'
  | 'builtin-schemas'
  | 'builtin-interfaces'
  | 'builtin-templates-and-functions'
  | 'release-notes'

/** 可替换日志、时钟和让出执行权的方式，便于在测试中控制启动环境。 */
interface StartupPhaseOptions {
  logger?: Pick<RendererLogger, 'info' | 'error'>
  now?: () => number
  yieldControl?: () => Promise<void>
}

/** 执行单个启动阶段，统一记录开始、完成或失败，并保留原结果与异常。 */
export async function runStartupPhase<T>(
  phase: StartupPhase,
  operation: () => T | Promise<T>,
  options: StartupPhaseOptions = {}
): Promise<T> {
  const phaseLogger = options.logger ?? logger
  const now = options.now ?? (() => performance.now())
  // 每个阶段开始前先让出事件循环，给启动占位界面继续更新的机会。
  await (options.yieldControl ?? yieldToRenderer)()

  // 阶段耗时从让出执行权之后开始计算，只统计业务操作及其等待时间。
  const startedAt = now()
  phaseLogger.info('Renderer startup phase started', { phase })
  try {
    const result = await operation()
    phaseLogger.info('Renderer startup phase completed', {
      phase,
      durationMs: elapsedMilliseconds(startedAt, now())
    })
    return result
  } catch (error) {
    phaseLogger.error('Renderer startup phase failed', error, {
      phase,
      durationMs: elapsedMilliseconds(startedAt, now())
    })
    throw error
  }
}

function yieldToRenderer(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

/** 耗时保留一位小数，并避免时钟误差产生负值。 */
function elapsedMilliseconds(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round((completedAt - startedAt) * 10) / 10)
}
