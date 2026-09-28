import type { SubmissionLibraryRecord, SubmissionReport } from '@ls101/submission-library'
import { describe, expect, it } from 'vitest'
import {
  buildSubmissionReportDocument,
  submissionReportFileName
} from '../features/submissions/submissionReportDocument'
import { renderSubmissionReportMarkup } from '../features/submissions/submissionReportMarkup'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
const DATA_URL = 'data:image/png;base64,iVBORw=='

function mixedReport(): SubmissionReport {
  return {
    markdown: [
      '# 张三 — 期末考试',
      '',
      '| 姓名 | 总分 |',
      '| :---: | :---: |',
      '| 张三 | 8/10 |',
      '',
      '> 听力原文：*W: Shall we meet at three?*',
      '',
      '- 要点一',
      '  - 子要点',
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
  }
}

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
  it('把报告渲染成带样式的自包含 HTML', () => {
    const html = buildSubmissionReportDocument(mixedReport())

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('<style>')
    expect(html).toContain('<h1')
    expect(html).toContain('<table>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('data:image/png;base64,iVBORw==')
    expect(html).not.toContain('resource:img-1')
    expect(html).not.toContain('<script')
  })

  it('正文与“查看报告”共用同一段 Markdown → HTML 实现', () => {
    const report = mixedReport()
    const shared = renderSubmissionReportMarkup(report.markdown, report.resources, () => DATA_URL)

    expect(buildSubmissionReportDocument(report)).toContain(
      `<div class="submissionReport">${shared}</div>`
    )
  })

  it('转义原始 HTML 并过滤危险协议', () => {
    const html = buildSubmissionReportDocument({
      markdown: '<img src=x onerror="alert(1)">\n\n[点我](javascript:alert(1))\n',
      resources: {}
    })

    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
    expect(html).not.toContain('javascript:')
  })

  it('缺少资源时不抛错，只是没有可用的图片地址', () => {
    const html = buildSubmissionReportDocument({
      markdown: '![题目](resource:missing)',
      resources: {}
    })

    expect(html).toContain('<img')
    expect(html).not.toContain('src=')
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
