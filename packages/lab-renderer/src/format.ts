import { RemoteError } from '@ls101/lab-client'
import type { Schema } from '@ls101/lab-contracts'

export interface LabBlocker {
  kind: Schema<'Blocker'>['kind']
  resourceId: string
}

export interface LabErrorDescription {
  code: string | null
  message: string
  blockers: LabBlocker[]
  retryAfterSeconds: number | null
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: '请求内容无效，请检查输入后重试。',
  AUTH_REQUIRED: '登录状态已失效，请重新连接服务。',
  TOKEN_EXPIRED: '会话已过期，请重新连接服务。',
  TOKEN_REVOKED: '会话已被撤销，请重新连接服务。',
  DEVICE_DISABLED: '设备已被停用，请联系管理员。',
  LICENSE_INACTIVE: '服务许可未激活。',
  ENROLLMENT_REJECTED: '入网请求被拒绝，请核对入网文件与设备状态。',
  NOT_FOUND: '目标数据不存在或已被删除。',
  SERVICE_MAINTENANCE: '服务处于维护模式，暂时无法执行该操作。',
  VERSION_MISMATCH: '客户端与服务版本不一致，请更新后再试。',
  REVISION_CONFLICT: '数据已被其他操作更新，请重新载入最新数据后重试。',
  CONTENT_CONFLICT: '内容冲突：同标识但摘要不同，不能覆盖。',
  RESOURCE_BUSY: '服务正忙，请稍后重试。',
  PAYLOAD_TOO_LARGE: '数据超过允许的大小上限。',
  UNSUPPORTED_MEDIA_TYPE: '不支持的文件类型。',
  INVALID_EXAM: '试卷文件无效或已损坏。',
  INVALID_SUBMISSION: '作答文件无效或已损坏。',
  RATE_LIMITED: '请求过于频繁，请稍后重试。',
  SERVICE_NOT_READY: '服务尚未就绪，请稍后重试。',
  STORAGE_UNAVAILABLE: '存储不可用，请联系管理员。'
}

export function describeLabError(reason: unknown): LabErrorDescription {
  if (reason instanceof RemoteError) {
    const base = ERROR_MESSAGES[reason.code] ?? '操作失败，请稍后重试。'
    return {
      code: reason.code,
      message: `${base}（${reason.code}）`,
      blockers:
        reason.details?.blockers?.map((blocker) => ({
          kind: blocker.kind,
          resourceId: blocker.resourceId
        })) ?? [],
      retryAfterSeconds: reason.retryAfter ?? null
    }
  }

  return {
    code: null,
    message: reason instanceof Error ? reason.message : String(reason),
    blockers: [],
    retryAfterSeconds: null
  }
}

export function formatTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString('zh-CN') : '-'
}

export function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '-'
  if (value < 1024) return `${value} B`

  const kilobytes = value / 1024
  if (kilobytes < 1024) return `${kilobytes.toFixed(1)} KB`

  const megabytes = kilobytes / 1024
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`

  return `${(megabytes / 1024).toFixed(2)} GB`
}
