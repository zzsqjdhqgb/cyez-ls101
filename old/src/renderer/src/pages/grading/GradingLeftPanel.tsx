/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import MarkdownRenderer from '../../components/MarkdownRenderer'

const styles: Record<string, React.CSSProperties> = {
  toggleBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    padding: '14px 18px',
    fontSize: 14,
    fontWeight: 600,
    background: '#ffffff',
    color: '#1e293b',
    border: '1px solid #e2e8f0',
    borderRadius: 10,
    cursor: 'pointer',
    marginTop: 24,
    outline: 'none',
    transition: 'box-shadow 0.2s'
  },
  gradingInfoBody: {
    padding: '18px',
    border: '1px solid #e2e8f0',
    borderTop: 'none',
    borderRadius: '0 0 10px 10px',
    background: '#ffffff'
  }
}

interface GradingLeftPanelProps {
  problemInfo: string
  gradingInfo: string
  showGradingInfo: boolean
  eid: string
  rid: string
  onToggleGradingInfo: () => void
}

export default function GradingLeftPanel({
  problemInfo,
  gradingInfo,
  showGradingInfo,
  eid,
  rid,
  onToggleGradingInfo
}: GradingLeftPanelProps): JSX.Element {
  return (
    <>
      <div style={{ marginBottom: 24 }}>
        <MarkdownRenderer content={problemInfo} eid={eid} rid={rid} />
      </div>

      <div style={{ marginTop: 8 }}>
        <button
          onClick={onToggleGradingInfo}
          style={{
            ...styles.toggleBtn,
            borderRadius: showGradingInfo ? '10px 10px 0 0' : 10
          }}
        >
          <span>评分标准</span>
          {showGradingInfo ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
        </button>

        {showGradingInfo && (
          <div style={styles.gradingInfoBody}>
            <MarkdownRenderer content={gradingInfo} eid={eid} rid={rid} />
          </div>
        )}
      </div>
    </>
  )
}
