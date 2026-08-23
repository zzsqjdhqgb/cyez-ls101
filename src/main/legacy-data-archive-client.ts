import { Worker } from 'node:worker_threads'
import type {
  CreateLegacyArchiveRequest,
  CreateLegacyArchiveResult,
  LegacyArchiveOperations,
  VerifyLegacyArchiveResult
} from './legacy-data-archive'

type WorkerRequest =
  | { type: 'create'; request: CreateLegacyArchiveRequest }
  | { type: 'verify'; archivePath: string }

interface WorkerResponse {
  ok: boolean
  result?: unknown
  error?: string
}

export const workerLegacyArchiveOperations: LegacyArchiveOperations = {
  create(request) {
    return runWorker<CreateLegacyArchiveResult>({ type: 'create', request })
  },
  verify(archivePath) {
    return runWorker<VerifyLegacyArchiveResult>({ type: 'verify', archivePath })
  }
}

function runWorker<Result>(request: WorkerRequest): Promise<Result> {
  const worker = new Worker(new URL('./legacy-data-worker.js', import.meta.url), {
    workerData: request
  })
  return new Promise<Result>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
      void worker.terminate()
    }
    worker.once('message', (message: WorkerResponse) => {
      if (message.ok) {
        settle(() => resolve(message.result as Result))
      } else {
        settle(() => reject(new Error(message.error || '旧数据归档 Worker 执行失败')))
      }
    })
    worker.once('error', (error) => settle(() => reject(error)))
    worker.once('exit', (code) => {
      settle(() => reject(new Error(`旧数据归档 Worker 未返回结果（退出码 ${code}）`)))
    })
  })
}
