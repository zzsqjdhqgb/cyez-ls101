/** 长耗时任务中一个不可嵌套的步骤。 */
export interface TaskProgressItem {
  id: string
  label: string
  status: 'waiting' | 'running' | 'completed' | 'failed'
  log?: {
    format: 'text' | 'markdown'
    content: string
  }
}

/** UI 可直接渲染的任务进度快照。 */
export interface TaskProgressSnapshot {
  items: readonly TaskProgressItem[]
}

/**
 * 长耗时操作的通用句柄。快照引用只在内容变化时更新，可直接用于
 * React useSyncExternalStore。
 */
export interface TaskProgressHandle<TResult> {
  getSnapshot(): TaskProgressSnapshot
  subscribe(listener: () => void): () => void
  cancel(): void
  readonly completion: Promise<TResult>
}
