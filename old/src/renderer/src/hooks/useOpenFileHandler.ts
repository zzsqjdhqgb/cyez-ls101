/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { PendingOpenFile } from '../../../shared/file-types'

const activePaths = new Set<string>()

interface AlertState {
  type: 'alert'
  message: string
}

interface ConfirmState {
  type: 'confirm'
  message: string
  onConfirm: () => void
  onCancel: () => void
}

interface CompletionState {
  type: 'completion'
  message: string
  onView: () => void
  onDone: () => void
}

export type FileModalState = AlertState | ConfirmState | CompletionState | null

function getFileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

function getFileTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    exam: '考试包',
    template: '模板包',
    draft: '草稿包',
    submission: '作答包'
  }
  return labels[type] || type
}

function getNavPath(type: string): string {
  const paths: Record<string, string> = {
    exam: '/',
    template: '/create/templates',
    draft: '/create/drafts',
    submission: '/grading'
  }
  return paths[type] || '/'
}

export function useOpenFileHandler(): {
  fileModal: FileModalState
  clearFileModal: () => void
  refreshKey: number
} {
  const navigate = useNavigate()
  const [fileModal, setFileModal] = useState<FileModalState>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const hasDialogRef = useRef(false)
  const currentPathRef = useRef<string | null>(null)
  const navigateRef = useRef(navigate)

  useEffect(() => {
    navigateRef.current = navigate
  })

  const cleanup = useCallback(() => {
    hasDialogRef.current = false
    if (currentPathRef.current) {
      activePaths.delete(currentPathRef.current)
      currentPathRef.current = null
    }
  }, [])

  const clearFileModal = useCallback(() => {
    setFileModal(null)
    cleanup()
  }, [cleanup])

  const handleFile = useCallback(
    (file: PendingOpenFile): void => {
      if (hasDialogRef.current) return
      if (activePaths.has(file.path)) return

      hasDialogRef.current = true
      currentPathRef.current = file.path
      activePaths.add(file.path)

      if (file.type === 'grading') {
        setFileModal({
          type: 'alert',
          message: '批改记录包暂不支持直接导入。'
        })
        return
      }

      const fileName = getFileName(file.path)
      const typeLabel = getFileTypeLabel(file.type)
      setFileModal({
        type: 'confirm',
        message: `检测到${typeLabel}文件：\n\n${fileName}\n\n是否导入？`,
        onConfirm: () => {
          setFileModal(null)
          window.electronAPI.app.importOpenedFile(file.path, file.type).then((result) => {
            if (result.success) {
              const navPath = getNavPath(file.type)
              setFileModal({
                type: 'completion',
                message: `导入完成：${fileName}`,
                onView: () => {
                  setFileModal(null)
                  cleanup()
                  navigateRef.current(navPath)
                },
                onDone: () => {
                  setFileModal(null)
                  cleanup()
                  setRefreshKey((k) => k + 1)
                }
              })
            } else {
              setFileModal({
                type: 'alert',
                message: `导入失败：${result.error || '未知错误'}`
              })
            }
          })
        },
        onCancel: () => {
          setFileModal(null)
          cleanup()
        }
      })
    },
    [cleanup]
  )

  useEffect(() => {
    window.electronAPI.app.getPendingOpenFile().then((file) => {
      if (file) handleFile(file)
    })

    const unsubscribe = window.electronAPI.app.onOpenFile((file) => {
      handleFile(file)
    })

    return unsubscribe
  }, [handleFile])

  return { fileModal, clearFileModal, refreshKey }
}
