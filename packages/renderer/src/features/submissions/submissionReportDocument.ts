import type {
  GradingResourceInput,
  SubmissionLibraryRecord,
  SubmissionReport
} from '@ls101/submission-library'
import { renderSubmissionReportMarkup } from './submissionReportMarkup'
import reportStyles from './submissionReport.css?raw'

const BASE64_CHUNK = 0x8000
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu

/** 报告 PDF 的文件名：姓名 + 考生号，主进程还会再做一次校验与去重。 */
export function submissionReportFileName(record: SubmissionLibraryRecord): string {
  const candidateName = sanitizeFilenamePart(record.candidateName) || '考生'
  const candidateId = sanitizeFilenamePart(record.candidateId) || '未知考生号'
  return `${candidateName}-${candidateId}-报告.pdf`
}

/**
 * 把一份报告渲染成自包含 HTML 文档。
 * 正文与“查看报告”共用 renderSubmissionReportMarkup，区别只有两点：
 * 资源地址换成 data URL，样式内联为 <style>（打印窗口没有应用样式表）。
 */
export function buildSubmissionReportDocument(report: SubmissionReport): string {
  const markup = renderSubmissionReportMarkup(report.markdown, report.resources, toDataUrl)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>作答报告</title>',
    `<style>${reportStyles}</style>`,
    '</head>',
    `<body><div class="submissionReport">${markup}</div></body>`,
    '</html>'
  ].join('')
}

function toDataUrl(resource: GradingResourceInput): string {
  const mediaType = resource.mediaType || 'application/octet-stream'
  return `data:${mediaType};base64,${toBase64(resource.data)}`
}

function toBase64(data: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += BASE64_CHUNK) {
    binary += String.fromCharCode(...data.subarray(offset, offset + BASE64_CHUNK))
  }
  return btoa(binary)
}

function sanitizeFilenamePart(value: string): string {
  return value.replace(INVALID_FILENAME_CHARS, '_').trim()
}
