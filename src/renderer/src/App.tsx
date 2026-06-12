/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

// src/renderer/src/App.tsx
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import TitleBar from './components/TitleBar'
import HomePage from './pages/HomePage'
import RecordingsPage from './pages/RecordingsPage'
import ExamPage from './pages/ExamPage'
import CreateExamPage from './pages/CreateExamPage'
import DraftEditPage from './pages/DraftEditPage'
import GradingPage from './pages/GradingPage'
import GradingSessionPage from './pages/GradingSessionPage'
import GradingSettlementPage from './pages/GradingSettlementPage'
import AboutPage from './pages/AboutPage'
import DeveloperOptionsPage from './pages/DeveloperOptionsPage'
import { JSX, useEffect, useState } from 'react'
import LicensePage from './pages/LicensePage'

interface UpdateInfo {
  previousVersion: string
  currentVersion: string
}

function isPrerelease(version: string): boolean {
  return version.includes('-')
}

function UpdateModal({ info }: { info: UpdateInfo }): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 380,
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: '#16a34a', marginBottom: 12 }}>
          更新成功
        </div>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
          软件已从 {info.previousVersion} 更新到 {info.currentVersion}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 32px',
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          确定
        </button>
      </div>
    </div>
  )
}

function PrereleaseWarningModal({ info }: { info: UpdateInfo }): JSX.Element {
  const [confirming, setConfirming] = useState(false)

  if (confirming) {
    return (
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 8,
            padding: 24,
            maxWidth: 380,
            boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
            textAlign: 'center'
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 600, color: '#dc2626', marginBottom: 12 }}>
            确认清除数据
          </div>
          <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
            清除数据会导致本地数据丢失，除非开发者有特殊说明，否则请不要这么做。
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => setConfirming(false)}
              style={{
                flex: 1,
                padding: '10px 0',
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              取消
            </button>
            <button
              onClick={() => {
                void window.electronAPI.dev.resetData()
              }}
              style={{
                flex: 1,
                padding: '10px 0',
                background: '#dc2626',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
                fontWeight: 500
              }}
            >
              确认清除
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 400,
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: '#d97706', marginBottom: 12 }}>
          版本警告
        </div>
        <div
          style={{
            fontSize: 13,
            color: '#475569',
            lineHeight: 1.8,
            marginBottom: 16,
            textAlign: 'left'
          }}
        >
          <div>上次运行版本：{info.previousVersion}</div>
          <div>当前版本：{info.currentVersion}</div>
          <div style={{ marginTop: 8, color: '#64748b' }}>
            上次/本次运行的不是正式版，可能造成不稳定。如果开发者有特殊说明，请点击清除数据；如果没有特殊说明，建议不要清除数据。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            忽略
          </button>
          <button
            onClick={() => setConfirming(true)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            清除数据
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetRequiredModal(): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 380,
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)',
          textAlign: 'center'
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600, color: '#dc2626', marginBottom: 12 }}>
          版本提示
        </div>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 16 }}>
          检测到之前安装过未完善的软件版本，必须清除数据才可以使用。
        </div>
        <button
          onClick={() => {
            void window.electronAPI.dev.resetData()
          }}
          style={{
            padding: '8px 32px',
            background: '#dc2626',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 500
          }}
        >
          确定
        </button>
      </div>
    </div>
  )
}

function ResetFailedModal({ failedPaths }: { failedPaths: string[] }): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 420,
          boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>部分文件未能清除</div>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 12 }}>
          以下目录未能完全删除，是否彻底清理？选择彻底清理将标记并退出程序，下次启动时自动完成清理；忽略则不做标记继续使用。
        </div>
        <div
          style={{
            background: '#f8fafc',
            borderRadius: 4,
            padding: 8,
            fontSize: 12,
            color: '#e11d48',
            maxHeight: 120,
            overflow: 'auto',
            marginBottom: 16
          }}
        >
          {failedPaths.map((p, i) => (
            <div key={i}>{p}</div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            忽略
          </button>
          <button
            onClick={() => {
              void window.electronAPI.dev.confirmHardReset()
            }}
            style={{
              flex: 1,
              padding: '10px 0',
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
              fontWeight: 500
            }}
          >
            彻底清理
          </button>
        </div>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [resetRequired, setResetRequired] = useState(false)
  const [activated, setActivated] = useState(false)
  const [checkingLicense, setCheckingLicense] = useState(true)

  useEffect(() => {
    window.electronAPI.license
      .isExpired()
      .then((expired) => {
        if (expired) {
          setCheckingLicense(false)
          return
        }
        return window.electronAPI.license.hasStoredLicense()
      })
      .then((hasStored) => {
        if (hasStored) {
          setActivated(true)
        }
      })
      .catch(() => {
        // ignore
      })
      .finally(() => {
        setCheckingLicense(false)
      })
  }, [])

  useEffect(() => {
    if (!activated) return
    window.electronAPI.dev
      .checkResetRequired()
      .then((required) => {
        if (required) {
          setResetRequired(true)
        }
      })
      .catch(() => {
        // ignore
      })

    window.electronAPI.dev
      .getResetFailedPaths()
      .then((paths) => {
        if (paths && paths.length > 0) {
          setFailedPaths(paths)
        }
      })
      .catch(() => {
        // ignore
      })

    window.electronAPI.dev
      .checkUpdateNotification()
      .then((info) => {
        if (info) {
          setUpdateInfo(info)
        }
      })
      .catch(() => {
        // ignore
      })
  }, [activated])

  if (checkingLicense) {
    return <div style={{ height: '100%', background: '#f8fafc' }} />
  }

  if (!activated) {
    return <LicensePage onActivated={() => setActivated(true)} />
  }

  return (
    <MemoryRouter>
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <TitleBar />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/recordings" element={<RecordingsPage />} />
              <Route path="/create" element={<CreateExamPage />}>
                <Route path="templates" element={<div />} />{' '}
                {/* 占位，实际由 CreateExamPage 管理子视图 */}
                <Route path="drafts" element={<div />} />
              </Route>
              <Route path="/grading" element={<GradingPage />}>
                <Route path="batches" element={<div />} />
              </Route>
              <Route path="/about" element={<AboutPage />} />
              <Route path="/dev-options" element={<DeveloperOptionsPage />} />
            </Route>
            <Route path="/exam/:examId" element={<ExamPage />} />
            <Route path="/draft/:draftId" element={<DraftEditPage />} />
            <Route path="/grading/session" element={<GradingSessionPage />} />
            <Route path="/grading/settlement" element={<GradingSettlementPage />} />
          </Routes>
        </div>
      </div>
      {resetRequired && <ResetRequiredModal />}
      {updateInfo &&
        !isPrerelease(updateInfo.previousVersion) &&
        !isPrerelease(updateInfo.currentVersion) && <UpdateModal info={updateInfo} />}
      {updateInfo &&
        (isPrerelease(updateInfo.previousVersion) || isPrerelease(updateInfo.currentVersion)) && (
          <PrereleaseWarningModal info={updateInfo} />
        )}
      {failedPaths.length > 0 && <ResetFailedModal failedPaths={failedPaths} />}
    </MemoryRouter>
  )
}
