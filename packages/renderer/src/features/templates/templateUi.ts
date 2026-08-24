export function templateErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('preload bridge is unavailable')) {
      return '当前环境无法访问本地数据，请在桌面应用中打开。'
    }
    return error.message
  }
  return '操作失败，请重试。'
}
