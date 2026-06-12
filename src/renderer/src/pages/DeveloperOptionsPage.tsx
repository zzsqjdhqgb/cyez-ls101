/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, FolderOpen, Trash2, Unlink, RefreshCw } from 'lucide-react'

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    overflow: 'auto',
    display: 'flex',
    justifyContent: 'center',
    padding: '32px 40px'
  },
  content: {
    width: '100%',
    maxWidth: 640
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 28
  },
  backBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    background: 'transparent',
    color: '#475569',
    outline: 'none',
    transition: 'background 0.2s'
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: '#0f172a'
  },
  card: {
    background: '#ffffff',
    borderRadius: 14,
    padding: '32px',
    boxShadow: '0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.06)'
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 16
  },
  description: {
    fontSize: 14,
    color: '#64748b',
    marginBottom: 24,
    lineHeight: 1.6
  },
  dangerBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 24px',
    fontSize: 15,
    fontWeight: 500,
    border: '1px solid #fecaca',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#fff5f5',
    color: '#dc2626',
    outline: 'none',
    transition: 'all 0.2s ease'
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '10px 24px',
    fontSize: 15,
    fontWeight: 500,
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    cursor: 'pointer',
    background: '#ffffff',
    color: '#475569',
    outline: 'none',
    transition: 'all 0.2s ease'
  },
  confirmModal: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000
  },
  modalContent: {
    background: '#fff',
    borderRadius: 12,
    padding: '32px 40px',
    maxWidth: 420,
    boxShadow: '0 8px 30px rgba(0,0,0,0.12)'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: '#1e293b',
    marginBottom: 16
  },
  modalText: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#475569',
    marginBottom: 24
  },
  modalActions: {
    display: 'flex',
    gap: 12,
    justifyContent: 'flex-end'
  },
  cancelBtn: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#fff',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    outline: 'none'
  },
  confirmBtn: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    outline: 'none'
  }
}

export default function DeveloperOptionsPage(): JSX.Element {
  const navigate = useNavigate()
  const [showConfirm, setShowConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [removingAssoc, setRemovingAssoc] = useState(false)
  const [removeAssocResult, setRemoveAssocResult] = useState<string | null>(null)
  const [resettingCache, setResettingCache] = useState(false)
  const [resetCacheResult, setResetCacheResult] = useState<string | null>(null)

  const handleResetData = async (): Promise<void> => {
    setResetting(true)
    try {
      await window.electronAPI.dev.resetData()
    } catch (err) {
      console.error('重置数据失败:', err)
      setResetting(false)
      setShowConfirm(false)
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        <div style={styles.header}>
          <button
            onClick={() => navigate('/about')}
            style={styles.backBtn}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <div style={styles.pageTitle}>开发者选项</div>
        </div>

        <div style={styles.card}>
          <div style={styles.sectionTitle}>数据管理</div>
          <div style={styles.description}>
            重置所有数据将清除本地存储的考试、作答记录、批改数据和草稿。
            应用将自动重启界面以完成清理。此操作不可撤销。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => {
                void window.electronAPI.dev.openDataFolder()
              }}
              style={styles.secondaryBtn}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#f8fafc'
                e.currentTarget.style.borderColor = '#cbd5e1'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#ffffff'
                e.currentTarget.style.borderColor = '#e2e8f0'
              }}
            >
              <FolderOpen size={18} strokeWidth={2} />
              打开数据文件夹
            </button>
            <button
              onClick={() => setShowConfirm(true)}
              style={styles.dangerBtn}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#fef2f2'
                e.currentTarget.style.borderColor = '#fca5a5'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#fff5f5'
                e.currentTarget.style.borderColor = '#fecaca'
              }}
            >
              <Trash2 size={18} strokeWidth={2} />
              重置数据
            </button>
          </div>
        </div>

        <div style={{ height: 24 }} />

        <div style={styles.card}>
          <div style={styles.sectionTitle}>文件扩展名管理</div>
          <div style={styles.description}>
            移除当前用户下本程序注册的所有文件扩展名关联（.cyexam / .cytmpl / .cydraft / .cysubm /
            .cygrade）。仅在 Windows 上生效。
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={async () => {
                  setRemovingAssoc(true)
                  setRemoveAssocResult(null)
                  try {
                    const removed = await window.electronAPI.dev.removeFileAssociations()
                    setRemoveAssocResult(
                      removed ? '已移除所有文件扩展名注册' : '未找到已注册的扩展名'
                    )
                  } catch {
                    setRemoveAssocResult('移除失败')
                  } finally {
                    setRemovingAssoc(false)
                  }
                }}
                disabled={removingAssoc}
                style={{
                  ...styles.dangerBtn,
                  opacity: removingAssoc ? 0.6 : 1,
                  cursor: removingAssoc ? 'default' : 'pointer'
                }}
              >
                <Unlink size={18} strokeWidth={2} />
                {removingAssoc ? '移除中...' : '移除文件扩展名注册'}
              </button>
              {removeAssocResult && (
                <span style={{ fontSize: 14, color: '#16a34a' }}>{removeAssocResult}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <button
                onClick={async () => {
                  setResettingCache(true)
                  setResetCacheResult(null)
                  try {
                    const ok = await window.electronAPI.dev.resetFileAssociationCache()
                    setResetCacheResult(
                      ok ? '已发起提权请求，请在弹出的 UAC 窗口中确认' : '当前平台不支持此操作'
                    )
                  } catch {
                    setResetCacheResult('操作失败')
                  } finally {
                    setResettingCache(false)
                  }
                }}
                disabled={resettingCache}
                style={{
                  ...styles.secondaryBtn,
                  opacity: resettingCache ? 0.6 : 1,
                  cursor: resettingCache ? 'default' : 'pointer'
                }}
                onMouseEnter={(e) => {
                  if (!resettingCache) {
                    e.currentTarget.style.background = '#f8fafc'
                    e.currentTarget.style.borderColor = '#cbd5e1'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!resettingCache) {
                    e.currentTarget.style.background = '#ffffff'
                    e.currentTarget.style.borderColor = '#e2e8f0'
                  }
                }}
              >
                <RefreshCw size={18} strokeWidth={2} />
                {resettingCache ? '重置中...' : '重置文件扩展名缓存'}
              </button>
              {resetCacheResult && (
                <span style={{ fontSize: 14, color: '#16a34a' }}>{resetCacheResult}</span>
              )}
            </div>
          </div>
        </div>

        {showConfirm && (
          <div style={styles.confirmModal} onClick={() => setShowConfirm(false)}>
            <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
              <div style={styles.modalTitle}>确认重置数据</div>
              <div style={styles.modalText}>
                此操作将删除所有本地数据并退出程序。 在开发模式下需要手动运行 pnpm dev
                重新启动。数据删除后无法恢复。确定要继续吗？
              </div>
              <div style={styles.modalActions}>
                <button onClick={() => setShowConfirm(false)} style={styles.cancelBtn}>
                  取消
                </button>
                <button
                  onClick={handleResetData}
                  disabled={resetting}
                  style={{
                    ...styles.confirmBtn,
                    opacity: resetting ? 0.6 : 1,
                    cursor: resetting ? 'default' : 'pointer'
                  }}
                >
                  {resetting ? '重置中...' : '确认重置'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
