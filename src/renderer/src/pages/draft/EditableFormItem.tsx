/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { JSX } from 'react'
import { ChevronDown, ChevronUp, ClipboardPaste, FolderOpen, X } from 'lucide-react'
import type { EditableDataItem } from '../../types'

const styles: Record<string, React.CSSProperties> = {
  formItem: {
    background: '#fff',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 16,
    boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
  },
  label: {
    fontSize: 15,
    fontWeight: 500,
    color: '#475569',
    marginBottom: 8
  },
  textInput: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 15,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    outline: 'none',
    color: '#1e293b',
    fontFamily: 'inherit',
    lineHeight: '1.5',
    fieldSizing: 'content' as React.CSSProperties['fieldSizing'],
    resize: 'none',
    overflow: 'hidden',
    display: 'block',
    minHeight: '43px',
    boxSizing: 'border-box',
    textAlign: 'justify'
  },
  fileArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 12
  },
  fileBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: '1px solid #d1d5db',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#fff',
    color: '#475569',
    outline: 'none',
    transition: 'background 0.2s'
  },
  fileInfo: {
    fontSize: 14,
    color: '#64748b',
    flex: 1
  },
  deleteFileBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    border: '1px solid #fecaca',
    borderRadius: 6,
    cursor: 'pointer',
    background: '#fff5f5',
    color: '#dc2626',
    outline: 'none',
    transition: 'background 0.2s'
  },
  previewContainer: {
    marginTop: 8
  },
  previewToggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '2px 8px',
    fontSize: 12,
    color: '#64748b',
    background: 'none',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
    outline: 'none'
  },
  previewImageWrapper: {
    marginTop: 6,
    padding: 8,
    background: '#f8fafc',
    borderRadius: 6,
    border: '1px solid #e2e8f0'
  },
  previewImage: {
    maxWidth: '100%',
    maxHeight: 200,
    objectFit: 'contain',
    display: 'block',
    borderRadius: 4
  }
}

interface EditableFormItemProps {
  item: EditableDataItem
  draftId: string
  textValue: string
  fileValue: string
  fileOriginalName: string
  previewCollapsed: boolean
  onTextChange: (id: string, value: string) => void
  onFileUpload: (id: string) => void
  onClipboardPaste: (id: string) => void
  onRemoveFile: (id: string) => void
  onTogglePreview: (id: string) => void
}

export default function EditableFormItem({
  item,
  draftId,
  textValue,
  fileValue,
  fileOriginalName,
  previewCollapsed,
  onTextChange,
  onFileUpload,
  onClipboardPaste,
  onRemoveFile,
  onTogglePreview
}: EditableFormItemProps): JSX.Element {
  return (
    <div style={styles.formItem}>
      <div style={styles.label}>{item.description}</div>
      {item.type === 'text' ? (
        <textarea
          style={styles.textInput}
          defaultValue={textValue}
          rows={1}
          onBlur={(e) => onTextChange(item.id, e.target.value)}
        />
      ) : (
        <div style={styles.fileArea}>
          <button
            onClick={() => onFileUpload(item.id)}
            style={styles.fileBtn}
            title={fileValue ? '更换文件' : '选择文件'}
          >
            <FolderOpen size={18} strokeWidth={2} />
          </button>
          <button
            onClick={() => onClipboardPaste(item.id)}
            style={styles.fileBtn}
            title="从剪贴板粘贴图片"
          >
            <ClipboardPaste size={18} strokeWidth={2} />
          </button>
          {fileValue ? (
            <>
              <span style={styles.fileInfo}>{fileOriginalName || fileValue}</span>
              <button
                onClick={() => onRemoveFile(item.id)}
                style={styles.deleteFileBtn}
                title="删除文件"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </>
          ) : (
            <span style={styles.fileInfo}>未选择文件</span>
          )}
        </div>
      )}
      {fileValue && (
        <div style={styles.previewContainer}>
          <button
            onClick={() => onTogglePreview(item.id)}
            style={styles.previewToggle}
            title={previewCollapsed ? '展开预览' : '收起预览'}
          >
            {previewCollapsed ? (
              <ChevronDown size={14} strokeWidth={2} />
            ) : (
              <ChevronUp size={14} strokeWidth={2} />
            )}
            {previewCollapsed ? '展开预览' : '收起预览'}
          </button>
          {!previewCollapsed && (
            <div style={styles.previewImageWrapper}>
              <img
                src={`draft-resource://${draftId}/uploads/${fileValue}`}
                style={styles.previewImage}
                alt={fileValue}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
