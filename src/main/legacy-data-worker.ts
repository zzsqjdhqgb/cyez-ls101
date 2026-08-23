import { parentPort, workerData } from 'node:worker_threads'
import {
  createLegacyArchive,
  verifyLegacyArchive,
  type CreateLegacyArchiveRequest
} from './legacy-data-archive'

type WorkerRequest =
  | { type: 'create'; request: CreateLegacyArchiveRequest }
  | { type: 'verify'; archivePath: string }

if (!parentPort) throw new Error('旧数据归档 Worker 缺少 parentPort')

void run(workerData as WorkerRequest).then(
  (result) => parentPort.postMessage({ ok: true, result }),
  (error: unknown) => parentPort.postMessage({ ok: false, error: errorMessage(error) })
)

async function run(request: WorkerRequest): Promise<unknown> {
  if (request.type === 'create') return createLegacyArchive(request.request)
  if (request.type === 'verify') return verifyLegacyArchive(request.archivePath)
  throw new Error('旧数据归档 Worker 请求无效')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
