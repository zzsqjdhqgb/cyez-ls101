/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageModal } from '../components/Modal'
import useSplitPane from './grading/useSplitPane'
import GradingLeftPanel from './grading/GradingLeftPanel'
import GradingRightPanel from './grading/GradingRightPanel'

function getRidsFromStorage(): string[] {
  try {
    const raw = sessionStorage.getItem('gradingSessionRids')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

type Item = {
  rid: string
  gradingInfoId: number
  problemInfo: string
  gradingInfo: string
  fullScore?: number
  scoreOptions: number[]
  recordIndices: number[]
  audioUrls: string[]
  existingScore?: { score: number; comment: string }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden'
  },
  loadingContainer: {
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  loadingText: { fontSize: 28, color: '#94a3b8' },
  errorContainer: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20
  },
  errorText: { fontSize: 28, color: '#dc2626' },
  toolbar: {
    height: 52,
    minHeight: 52,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    borderBottom: '1px solid #e2e8f0',
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
  },
  btnOutline: {
    fontSize: 14,
    padding: '6px 16px',
    background: '#ffffff',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  btnPrimary: {
    fontSize: 14,
    padding: '6px 16px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  progressText: { fontSize: 14, color: '#64748b', fontWeight: 500 },
  mainContent: { flex: 1, display: 'flex', overflow: 'hidden' },
  leftPanel: {
    overflowY: 'auto',
    padding: '28px 36px',
    background: '#ffffff'
  },
  divider: {
    width: 6,
    cursor: 'col-resize',
    background: '#e2e8f0',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  rightPanel: {
    display: 'flex',
    flexDirection: 'column',
    padding: 24,
    gap: 16,
    overflowY: 'auto',
    background: '#f8fafc'
  },
  bottomBar: {
    minHeight: 60,
    background: '#ffffff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 24px',
    borderTop: '1px solid #e2e8f0',
    boxShadow: '0 -1px 3px rgba(0,0,0,0.04)',
    gap: 16
  },
  scoreRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap'
  },
  scoreBtn: {
    padding: '6px 14px',
    fontSize: 15,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    background: '#ffffff',
    color: '#475569',
    cursor: 'pointer',
    fontWeight: 500,
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  scoreBtnSelected: {
    padding: '6px 14px',
    fontSize: 15,
    borderRadius: 6,
    border: '2px solid #3b82f6',
    background: '#eff6ff',
    color: '#1d4ed8',
    cursor: 'pointer',
    fontWeight: 600,
    outline: 'none',
    whiteSpace: 'nowrap'
  },
  scoreLabel: { fontSize: 14, color: '#64748b' },
  nextBtn: {
    fontSize: 16,
    padding: '8px 28px',
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600
  },
  nextBtnDisabled: {
    fontSize: 16,
    padding: '8px 28px',
    background: '#94a3b8',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'default',
    fontWeight: 600
  },
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100
  },
  modal: {
    background: '#ffffff',
    borderRadius: 12,
    padding: '32px 40px',
    maxWidth: 480,
    boxShadow: '0 8px 32px rgba(0,0,0,0.12)'
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    margin: '0 0 16px 0',
    color: '#1e293b'
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 1.7,
    color: '#475569',
    margin: '0 0 24px 0'
  },
  modalActions: { display: 'flex', gap: 12, justifyContent: 'flex-end' },
  btnCancel: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#f1f5f9',
    color: '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  },
  btnConfirm: {
    fontSize: 14,
    padding: '8px 20px',
    background: '#e67e22',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 500
  }
}

export default function GradingSessionPage(): JSX.Element {
  const navigate = useNavigate()

  const [currentItem, setCurrentItem] = useState<Item | null>(null)
  const [submissionIndex, setSubmissionIndex] = useState(0)
  const [totalSubmissions, setTotalSubmissions] = useState(0)
  const [itemIndex, setItemIndex] = useState(0)
  const [totalItems, setTotalItems] = useState(0)
  const [currentSubmissionTotalItems, setCurrentSubmissionTotalItems] = useState(0)
  const [globalGradedCount, setGlobalGradedCount] = useState(0)
  const [score, setScore] = useState('')
  const [comment, setComment] = useState('')
  const [showGradingInfo, setShowGradingInfo] = useState(true)
  const [showPauseModal, setShowPauseModal] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [msgModal, setMsgModal] = useState<{
    title: string
    message: string
    type: 'info' | 'success' | 'error'
  } | null>(null)
  const [eid, setEid] = useState('')
  const ridsRef = useRef<string[]>([])

  const { splitRatio, containerRef, handleMouseDown } = useSplitPane()

  const loadFirstItem = useCallback(async () => {
    const rids = getRidsFromStorage()
    if (rids.length === 0) {
      setError('未找到批改任务，请返回重新选择')
      setLoading(false)
      return
    }

    ridsRef.current = rids

    try {
      const result = await window.electronAPI.grading.startGrading(rids)
      if (!result.success || !result.firstItem) {
        setError(result.error || '加载批改失败')
        setLoading(false)
        return
      }

      const fi = result.firstItem
      const scoreOptions =
        fi.gradingInfoItem.scoreOptions && fi.gradingInfoItem.scoreOptions.length > 0
          ? fi.gradingInfoItem.scoreOptions
          : fi.gradingInfoItem.fullScore !== undefined
            ? Array.from(
                { length: Math.round(fi.gradingInfoItem.fullScore * 2) + 1 },
                (_, i) => i * 0.5
              )
            : []
      setCurrentItem({
        rid: fi.rid,
        gradingInfoId: fi.gradingInfoItem.id,
        problemInfo: fi.gradingInfoItem.problemInfo,
        gradingInfo: fi.gradingInfoItem.gradingInfo,
        fullScore:
          fi.gradingInfoItem.fullScore ??
          (scoreOptions.length > 0 ? scoreOptions[scoreOptions.length - 1] : undefined),
        scoreOptions,
        recordIndices: fi.gradingInfoItem.recordIndices,
        audioUrls: fi.audioUrls,
        existingScore: fi.existingScore
      })

      setSubmissionIndex(0)
      setItemIndex(1)
      setTotalSubmissions(result.sessionCount || 0)
      setTotalItems(result.ungradedCount || 0)
      setCurrentSubmissionTotalItems(result.firstSubmissionUngradedCount || 0)
      setGlobalGradedCount(1)
      setEid(result.eid || '')

      if (fi.existingScore) {
        setScore(String(fi.existingScore.score))
        setComment(fi.existingScore.comment || '')
      }
      setLoading(false)
    } catch (err) {
      console.error('加载批改失败:', err)
      setError(String(err))
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadFirstItem() // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadFirstItem])

  const handlePause = useCallback(async () => {
    try {
      await window.electronAPI.grading.pauseGrading()
      sessionStorage.removeItem('gradingSessionRids')
      sessionStorage.removeItem('gradingSessionEid')
      navigate('/grading')
    } catch (err) {
      console.error('暂停批阅失败:', err)
    }
  }, [navigate])

  const handleFinish = useCallback(async () => {
    try {
      const result = await window.electronAPI.grading.finishGrading()
      if (result.success) {
        sessionStorage.removeItem('gradingSessionRids')
        sessionStorage.removeItem('gradingSessionEid')
        navigate('/grading/settlement')
      } else {
        setMsgModal({ title: '操作失败', message: '完成批改失败', type: 'error' })
      }
    } catch (err) {
      console.error('完成批改失败:', err)
      setMsgModal({ title: '操作失败', message: '完成批改失败', type: 'error' })
    }
  }, [navigate])

  const handleNext = useCallback(async () => {
    if (!currentItem) return

    const scoreNum = parseFloat(score)
    const fullScore = currentItem.fullScore

    if (isNaN(scoreNum) || scoreNum < 0) {
      setMsgModal({ title: '输入错误', message: '请输入有效的分数', type: 'error' })
      return
    }

    if (fullScore !== undefined && scoreNum > fullScore) {
      setMsgModal({ title: '输入错误', message: `分数不能超过满分 ${fullScore}`, type: 'error' })
      return
    }

    setSubmitting(true)
    try {
      const result = await window.electronAPI.grading.submitScore(
        currentItem.rid,
        currentItem.gradingInfoId,
        scoreNum,
        comment
      )

      if (!result.success) {
        setMsgModal({ title: '操作失败', message: result.error || '提交失败', type: 'error' })
        setSubmitting(false)
        return
      }

      if (result.settle) {
        sessionStorage.removeItem('gradingSessionRids')
        sessionStorage.removeItem('gradingSessionEid')
        navigate('/grading/settlement')
        return
      }

      if (result.nextItem) {
        const ni = result.nextItem
        const scoreOptions =
          ni.gradingInfoItem.scoreOptions && ni.gradingInfoItem.scoreOptions.length > 0
            ? ni.gradingInfoItem.scoreOptions
            : ni.gradingInfoItem.fullScore !== undefined
              ? Array.from(
                  { length: Math.round(ni.gradingInfoItem.fullScore * 2) + 1 },
                  (_, i) => i * 0.5
                )
              : []
        const next: Item = {
          rid: ni.rid,
          gradingInfoId: ni.gradingInfoItem.id,
          problemInfo: ni.gradingInfoItem.problemInfo,
          gradingInfo: ni.gradingInfoItem.gradingInfo,
          fullScore:
            ni.gradingInfoItem.fullScore ??
            (scoreOptions.length > 0 ? scoreOptions[scoreOptions.length - 1] : undefined),
          scoreOptions,
          recordIndices: ni.gradingInfoItem.recordIndices,
          audioUrls: ni.audioUrls,
          existingScore: ni.existingScore
        }

        setScore(ni.existingScore ? String(ni.existingScore.score) : '')
        setComment(ni.existingScore?.comment || '')

        if (ni.rid !== currentItem.rid) {
          setSubmissionIndex((prev) => prev + 1)
          setItemIndex(1)
          if (result.currentSubmissionUngradedCount !== undefined) {
            setCurrentSubmissionTotalItems(result.currentSubmissionUngradedCount)
          }
        } else {
          setItemIndex((prev) => prev + 1)
        }

        setGlobalGradedCount((prev) => prev + 1)
        setCurrentItem(next)
      }
    } catch (err) {
      console.error('提交失败:', err)
      setMsgModal({ title: '操作失败', message: '提交失败', type: 'error' })
    } finally {
      setSubmitting(false)
    }
  }, [currentItem, score, comment, navigate])

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>加载中...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={styles.errorContainer}>
        <div style={styles.errorText}>{error}</div>
        <button onClick={() => navigate('/grading')} style={styles.btnOutline}>
          返回批改列表
        </button>
      </div>
    )
  }

  if (!currentItem) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingText}>无可批改项目</div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.toolbar}>
        <button onClick={() => setShowPauseModal(true)} style={styles.btnOutline}>
          暂停批阅
        </button>

        <div style={styles.progressText}>
          {`作答 ${submissionIndex + 1}/${totalSubmissions} · 题目 ${itemIndex}/${currentSubmissionTotalItems} · 总计 ${globalGradedCount}/${totalItems}`}
        </div>

        <button onClick={handleFinish} style={styles.btnPrimary}>
          完成批阅
        </button>
      </div>

      <div style={styles.mainContent} ref={containerRef}>
        <div style={{ ...styles.leftPanel, width: `${splitRatio * 100}%`, flexShrink: 0 }}>
          <GradingLeftPanel
            problemInfo={currentItem.problemInfo}
            gradingInfo={currentItem.gradingInfo}
            showGradingInfo={showGradingInfo}
            eid={eid}
            rid={currentItem.rid}
            onToggleGradingInfo={() => setShowGradingInfo(!showGradingInfo)}
          />
        </div>

        <div style={styles.divider} onMouseDown={handleMouseDown}>
          <div
            style={{
              width: 2,
              height: 40,
              borderRadius: 1,
              background: '#94a3b8',
              pointerEvents: 'none'
            }}
          />
        </div>

        <div style={{ ...styles.rightPanel, flex: 1 }}>
          <GradingRightPanel
            key={`${currentItem.rid}:${currentItem.recordIndices.join(',')}`}
            audioUrls={currentItem.audioUrls}
            recordIndices={currentItem.recordIndices}
            rid={currentItem.rid}
            comment={comment}
            onCommentChange={setComment}
          />
        </div>
      </div>

      <div style={styles.bottomBar}>
        <div style={styles.scoreRow}>
          {currentItem.scoreOptions.map((v) => (
            <button
              key={v}
              onClick={() => setScore(String(v))}
              style={score === String(v) ? styles.scoreBtnSelected : styles.scoreBtn}
            >
              {v.toString()}
            </button>
          ))}
        </div>

        <button
          onClick={handleNext}
          disabled={submitting}
          style={
            submitting
              ? { ...styles.nextBtnDisabled, flexShrink: 0 }
              : { ...styles.nextBtn, flexShrink: 0 }
          }
        >
          {submitting ? '提交中...' : '确认'}
        </button>
      </div>

      {showPauseModal && (
        <div style={styles.overlay} onClick={() => setShowPauseModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>确认暂停批阅</h3>
            <p style={styles.modalBody}>
              暂停批阅后，会保存本次批阅的数据，但是不标记批改完成，而是在下次批阅时一并结算。
            </p>
            <div style={styles.modalActions}>
              <button onClick={() => setShowPauseModal(false)} style={styles.btnCancel}>
                取消
              </button>
              <button
                onClick={() => {
                  setShowPauseModal(false)
                  handlePause()
                }}
                style={styles.btnConfirm}
              >
                确认暂停
              </button>
            </div>
          </div>
        </div>
      )}
      {msgModal && (
        <MessageModal
          isOpen={true}
          title={msgModal.title}
          message={msgModal.message}
          type={msgModal.type}
          onClose={() => setMsgModal(null)}
          closeLabel="确定"
        />
      )}
    </div>
  )
}
