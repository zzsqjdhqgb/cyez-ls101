import type { SubmissionLibraryRecord } from '@ls101/submission-library'
import { describe, expect, it } from 'vitest'
import {
  buildSubmissionReportDocument,
  submissionReportFileName
} from '../features/submissions/submissionReportDocument'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

describe('submissionReportFileName', () => {
  it('用姓名和考生号命名并去掉非法字符', () => {
    expect(submissionReportFileName(record({ candidateName: '张/三', candidateId: 'A:1' }))).toBe(
      '张_三-A_1-报告.pdf'
    )
  })

  it('姓名或考生号为空时回退到占位名', () => {
    expect(submissionReportFileName(record({ candidateName: '  ', candidateId: '' }))).toBe(
      '考生-未知考生号-报告.pdf'
    )
  })
})

describe('buildSubmissionReportDocument', () => {
  it('把报告 Markdown 渲染成带打印样式的自包含 HTML', () => {
    const html = buildSubmissionReportDocument({
      markdown: [
        '# 张三 — 期末考试',
        '',
        '| 姓名 | 总分 |',
        '| --- | --- |',
        '| 张三 | 8/10 |',
        '',
        '![题目](resource:img-1)',
        ''
      ].join('\n'),
      resources: {
        'img-1': {
          resourceKey: 'img-1',
          filename: 'question.png',
          kind: 'static',
          mediaType: 'image/png',
          data: PNG_BYTES
        }
      }
    })

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<style>')
    expect(html).toContain('<h1')
    expect(html).toContain('<table>')
    expect(html).toContain('data:image/png;base64,iVBORw==')
    expect(html).not.toContain('resource:img-1')
    expect(html).not.toContain('<script')
  })

  it('缺少资源时保留原引用而不是抛错', () => {
    const html = buildSubmissionReportDocument({
      markdown: '![题目](resource:missing)',
      resources: {}
    })

    expect(html).toContain('resource:missing')
  })

  it('没有媒体类型时按二进制内联', () => {
    const html = buildSubmissionReportDocument({
      markdown: '![素材](resource:file-1)',
      resources: {
        'file-1': {
          resourceKey: 'file-1',
          filename: 'asset.bin',
          kind: 'static',
          data: new Uint8Array([1, 2, 3])
        }
      }
    })

    expect(html).toContain('data:application/octet-stream;base64,AQID')
  })
})

function record(overrides: Partial<SubmissionLibraryRecord>): SubmissionLibraryRecord {
  return {
    formatVersion: 1,
    submissionId: 'submission-1',
    examPackageId: 'exam-1',
    examTitle: '期末考试',
    candidateId: 'candidate-1',
    candidateName: '张三',
    startedAt: '2026-08-10T01:00:00Z',
    submittedAt: '2026-08-10T02:00:00Z',
    importedAt: '2026-08-10T02:01:00Z',
    archiveSha256: '1'.repeat(64),
    archiveBytes: 100,
    schemaUseCount: 1,
    ...overrides
  }
}
