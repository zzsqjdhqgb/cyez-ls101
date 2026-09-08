import type { Schema } from '@ls101/lab-contracts'

export const testCaseLabels: Record<string, string> = {
  identity: '连接与身份',
  storage: '本地存储',
  download: '试卷下载',
  playback: '播放与选择',
  audio: '麦克风与耳机',
  submission: '作答提交',
  duplicate: '重复请求',
  recovery: '异常恢复'
}
export const testStatusLabels: Record<string, string> = {
  pending: '待执行',
  running: '运行中',
  succeeded: '自动测试完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
  'cancel-requested': '正在停止',
  passed: '通过',
  'manual-required': '待人工确认',
  'timed-out': '超时',
  'not-run': '未执行'
}

export function failedTestCases(device: Schema<'TestDeviceResult'>): string[] {
  const parameters = device.task.parameters
  if (
    parameters.type !== 'deployment-test' ||
    !['succeeded', 'failed', 'cancelled', 'expired'].includes(device.task.status)
  )
    return []
  return parameters.caseIds.filter((caseId) => {
    const automatic = device.cases.find((item) => item.caseId === caseId)
    const manual = device.confirmation.cases.find((item) => item.caseId === caseId)
    return (
      !automatic ||
      !['passed', 'manual-required'].includes(automatic.status) ||
      manual?.status === 'failed'
    )
  })
}
