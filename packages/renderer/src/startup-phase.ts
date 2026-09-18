import { logger, type RendererLogger } from '@ls101/logger/renderer'

export type StartupPhase =
  | 'main-process-readiness'
  | 'license-status'
  | 'legacy-data-status'
  | 'installation-marker'
  | 'builtin-schemas'
  | 'builtin-interfaces'
  | 'builtin-templates-and-functions'
  | 'release-notes'

interface StartupPhaseOptions {
  logger?: Pick<RendererLogger, 'info' | 'error'>
  now?: () => number
  yieldControl?: () => Promise<void>
}

export async function runStartupPhase<T>(
  phase: StartupPhase,
  operation: () => T | Promise<T>,
  options: StartupPhaseOptions = {}
): Promise<T> {
  const phaseLogger = options.logger ?? logger
  const now = options.now ?? (() => performance.now())
  await (options.yieldControl ?? yieldToRenderer)()

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

function elapsedMilliseconds(startedAt: number, completedAt: number): number {
  return Math.max(0, Math.round((completedAt - startedAt) * 10) / 10)
}
