import type { ReactNode } from 'react'
import { toast as sonnerToast, type ExternalToast } from 'sonner'

export type ToastId = string | number

export interface ToastOptions {
  id?: ToastId
  description?: ReactNode
  duration?: number
  action?: ExternalToast['action']
  onDismiss?: ExternalToast['onDismiss']
  onAutoClose?: ExternalToast['onAutoClose']
}

export interface ToastPromiseMessages<T> {
  loading: ReactNode
  success: ReactNode | ((value: T) => ReactNode)
  error: ReactNode | ((reason: unknown) => ReactNode)
  description?: ReactNode | ((value: T) => ReactNode)
  finally?: () => void | Promise<void>
}

export const toast = {
  success(message: ReactNode, options?: ToastOptions): ToastId {
    return sonnerToast.success(message, options)
  },
  error(message: ReactNode, options?: ToastOptions): ToastId {
    return sonnerToast.error(message, options)
  },
  info(message: ReactNode, options?: ToastOptions): ToastId {
    return sonnerToast.info(message, options)
  },
  promise<T>(
    operation: Promise<T> | (() => Promise<T>),
    messages: ToastPromiseMessages<T>
  ): ReturnType<typeof sonnerToast.promise<T>> {
    return sonnerToast.promise(operation, messages)
  },
  dismiss(id?: ToastId): void {
    sonnerToast.dismiss(id)
  }
}
