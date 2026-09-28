import type {
  GradingResourceInput,
  SubmissionLibraryRecord,
  SubmissionReport
} from '@ls101/submission-library'
import { marked } from 'marked'
import printStyles from './submissionReportDocument.css?raw'

/** 报告 Markdown 里的资源引用；与 submission-library 的写法保持一致。 */
const RESOURCE_ATTRIBUTE = /(src|href)="resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)"/g
const BASE64_CHUNK = 0x8000
const INVALID_FILENAME_CHARS = /[\\/:*?"<>|\p{Cc}]/gu

/** 报告 PDF 的文件名：姓名 + 考生号，主进程还会再做一次校验与去重。 */
export function submissionReportFileName(record: SubmissionLibraryRecord): string {
  const candidateName = sanitizeFilenamePart(record.candidateName) || '考生'
  const candidateId = sanitizeFilenamePart(record.candidateId) || '未知考生号'
  return `${candidateName}-${candidateId}-报告.pdf`
}

/**
 * 把一份报告渲染成自包含 HTML：图片内联为 data URL，样式内嵌。
 * 主进程只负责打印，不再接触报告模型。
 */
export function buildSubmissionReportDocument(report: SubmissionReport): string {
  const body = marked.parse(report.markdown, { async: false, gfm: true })
  const markup = inlineResources(body, report.resources)
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<title>作答报告</title>',
    `<style>${printStyles}</style>`,
    '</head>',
    `<body>${markup}</body>`,
    '</html>'
  ].join('')
}

function inlineResources(
  markup: string,
  resources: Readonly<Record<string, GradingResourceInput>>
): string {
  return markup.replace(RESOURCE_ATTRIBUTE, (match, attribute: string, key: string) => {
    const resource = resources[key]
    return resource ? `${attribute}="${toDataUrl(resource)}"` : match
  })
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
