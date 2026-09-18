import {
  validateRendererLogEvent,
  type LogEvent,
  type RendererLogValidationFailure
} from '../shared'

export const DEFAULT_RENDERER_LOG_RATE_LIMIT = 120
export const DEFAULT_RENDERER_LOG_RATE_WINDOW_MS = 60_000

export type RendererLogRejectionReason = RendererLogValidationFailure | 'rate-limit'
export type RendererLogGateResult =
  | { accepted: true; event: LogEvent }
  | { accepted: false; reason: RendererLogRejectionReason; report: boolean }

interface RendererLogRateState {
  startedAt: number
  count: number
  reported: Set<RendererLogRejectionReason>
}

export class RendererLogGate {
  private readonly states = new Map<number, RendererLogRateState>()

  constructor(
    private readonly limit = DEFAULT_RENDERER_LOG_RATE_LIMIT,
    private readonly windowMs = DEFAULT_RENDERER_LOG_RATE_WINDOW_MS
  ) {}

  accept(webContentsId: number, value: unknown, now = Date.now()): RendererLogGateResult {
    const state = this.stateFor(webContentsId, now)
    if (state.count >= this.limit) return this.rejected(state, 'rate-limit')
    state.count += 1

    const result = validateRendererLogEvent(value)
    if (!result.ok) return this.rejected(state, result.reason)
    return { accepted: true, event: result.event }
  }

  delete(webContentsId: number): void {
    this.states.delete(webContentsId)
  }

  private stateFor(webContentsId: number, now: number): RendererLogRateState {
    const current = this.states.get(webContentsId)
    if (current && now - current.startedAt < this.windowMs) return current
    const next: RendererLogRateState = { startedAt: now, count: 0, reported: new Set() }
    this.states.set(webContentsId, next)
    return next
  }

  private rejected(
    state: RendererLogRateState,
    reason: RendererLogRejectionReason
  ): RendererLogGateResult {
    const report = !state.reported.has(reason)
    state.reported.add(reason)
    return { accepted: false, reason, report }
  }
}
