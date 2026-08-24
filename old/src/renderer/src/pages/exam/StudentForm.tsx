/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'

interface StudentFormProps {
  studentName: string
  studentId: string
  formError: string | null
  onNameChange: (value: string) => void
  onIdChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}

export default function StudentForm({
  studentName,
  studentId,
  formError,
  onNameChange,
  onIdChange,
  onSubmit,
  onBack
}: StudentFormProps): JSX.Element {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: 420,
          background: '#2c2c2c',
          borderRadius: 16,
          padding: 40,
          display: 'flex',
          flexDirection: 'column',
          gap: 24,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)'
        }}
      >
        <h2
          style={{
            fontSize: 28,
            fontWeight: 600,
            color: '#fff',
            textAlign: 'center',
            margin: 0
          }}
        >
          考生信息
        </h2>
        {formError && (
          <div
            style={{
              background: '#e74c3c',
              color: '#fff',
              padding: '10px 16px',
              borderRadius: 8,
              fontSize: 16,
              textAlign: 'center'
            }}
          >
            {formError}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 18, color: '#ccc' }}>姓名</label>
          <input
            type="text"
            value={studentName}
            onChange={(e) => onNameChange(e.target.value)}
            autoFocus
            placeholder="请输入姓名"
            style={{
              padding: '12px 16px',
              fontSize: 18,
              borderRadius: 8,
              border: '1px solid #555',
              background: '#1e1e1e',
              color: '#fff',
              outline: 'none'
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label style={{ fontSize: 18, color: '#ccc' }}>学号</label>
          <input
            type="text"
            value={studentId}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6)
              onIdChange(val)
            }}
            placeholder="6位数字学号"
            maxLength={6}
            style={{
              padding: '12px 16px',
              fontSize: 18,
              borderRadius: 8,
              border: '1px solid #555',
              background: '#1e1e1e',
              color: '#fff',
              outline: 'none',
              letterSpacing: 2
            }}
          />
        </div>

        <button
          type="submit"
          style={{
            padding: '14px 0',
            fontSize: 20,
            fontWeight: 600,
            background: '#3b82f6',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
            marginTop: 8
          }}
        >
          开始考试
        </button>

        <button
          type="button"
          onClick={onBack}
          style={{
            background: 'transparent',
            color: '#888',
            border: 'none',
            fontSize: 16,
            cursor: 'pointer',
            textDecoration: 'underline'
          }}
        >
          返回主页
        </button>
      </form>
    </div>
  )
}
