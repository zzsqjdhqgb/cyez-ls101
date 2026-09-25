import { DEFAULT_USER_MESSAGE, toUserMessage } from '../../components/ui/userMessage'
export function templateErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.includes('preload bridge is unavailable')) {
      return '当前环境无法访问本地数据，请在桌面应用中打开。'
    }
    return toUserMessage(error)
  }
  return DEFAULT_USER_MESSAGE
}
