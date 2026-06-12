/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { marked } from 'marked'
import type { GradingRecord, GradingInfoItem, ExamPackage } from '../../../shared/types'
import { ensureDir, getGradingPath } from '../../utils'
import { loadRecords, loadExamPackage, getSubmissionMeta } from './import'
import { getMaxScore } from './settlement'

export function exportCsv(gradingPath: string, batchId: string): string {
  const records = loadRecords()
  const batchPath = join(gradingPath, 'batches', batchId, 'batch.json')
  if (!existsSync(batchPath)) return ''

  const batchData = JSON.parse(readFileSync(batchPath, 'utf-8'))
  const batchRecords: GradingRecord[] = []
  for (const rid of batchData.rids || []) {
    if (records[rid]) batchRecords.push(records[rid])
  }

  let gradingInfo: GradingInfoItem[] = []
  for (const r of batchRecords) {
    const pkg = loadExamPackage(r.rid)
    if (pkg?.gradingInfo?.length) {
      gradingInfo = pkg.gradingInfo
      break
    }
  }
  const sortedGi = [...gradingInfo].sort((a, b) => a.id - b.id)
  const giHeaders = sortedGi.map((_, idx) => String(idx + 1)).join(',')

  let csv = `\uFEFF姓名,学号,试卷名称,${giHeaders ? giHeaders + ',' : ''}总分,作答时间\n`
  for (const r of batchRecords) {
    const maxScore = getMaxScore(r.rid)
    const totalScore = typeof r.totalScore === 'number' ? `${r.totalScore}/${maxScore ?? '-'}` : '-'
    const giScores = sortedGi
      .map((gi) => {
        const se = r.scores[gi.id]
        return se
          ? `${se.score}/${gi.fullScore ?? gi.scoreOptions?.[gi.scoreOptions.length - 1] ?? '-'}`
          : `-/${gi.fullScore ?? gi.scoreOptions?.[gi.scoreOptions.length - 1] ?? '-'}`
      })
      .join(',')
    const time = getSubmissionMeta(r.rid)?.submittedAt
      ? new Date(getSubmissionMeta(r.rid)!.submittedAt).toLocaleString('zh-CN')
      : ''
    csv += `${r.student.name},${r.student.studentId},${r.examTitle},${giScores ? giScores + ',' : ''}${totalScore},${time}\n`
  }

  return csv
}

export interface PdfExportResult {
  success: boolean
  errorCount: number
  pdfErrors: { name: string; studentId: string; error: string }[]
  files: { filename: string; buffer: Buffer }[]
  error?: string
}

export async function exportPdf(
  gradingPath: string,
  batchId: string,
  tempDir: string,
  onProgress?: (current: number, total: number, step: string) => void,
  onPdfError?: (error: { name: string; studentId: string; error: string }) => void
): Promise<PdfExportResult> {
  const batchPath = join(gradingPath, 'batches', batchId, 'batch.json')
  if (!existsSync(batchPath)) {
    return { success: false, errorCount: 0, pdfErrors: [], files: [], error: '批改批次不存在' }
  }

  const records = loadRecords()
  const batchData = JSON.parse(readFileSync(batchPath, 'utf-8'))
  const batchRecords: GradingRecord[] = []
  for (const rid of batchData.rids || []) {
    if (records[rid]) batchRecords.push(records[rid])
  }

  ensureDir(tempDir)

  const css = `
    @page { margin: 10mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1e293b; line-height: 1.6; padding: 20px; }
    h1 { font-size: 22px; margin: 0 0 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
    h2 { font-size: 17px; margin: 12px 0 6px; font-weight: 700; }
    h3 { font-size: 15px; margin: 10px 0 4px; font-weight: 600; }
    table { border-collapse: collapse; width: 100%; margin: 6px 0; }
    td, th { border: 1px solid #d1d5db; padding: 4px 8px; }
    hr { border: none; border-top: 1px solid #94a3b8; margin: 16px 0; }
    .page-break { page-break-after: always; }
    img { max-width: 100%; margin: 8px 0; }
    a { color: #2563eb; }
    .score { color: #16a34a; font-weight: 600; }
    li { margin-left: 20px; }
    strong { font-weight: 600; }
    p { margin: 4px 0; line-height: 1.6; }
  `

  let errorCount = 0
  const pdfErrors: { name: string; studentId: string; error: string }[] = []
  const files: { filename: string; buffer: Buffer }[] = []

  for (let i = 0; i < batchRecords.length; i++) {
    const record = batchRecords[i]

    onProgress?.(
      i,
      batchRecords.length,
      `正在生成 ${record.student.name} 的PDF (${i + 1}/${batchRecords.length})`
    )

    const examDir = join(getGradingPath(), record.rid, 'exam')
    if (!existsSync(examDir)) continue

    const examJsonPath = join(examDir, 'exam.json')
    if (!existsSync(examJsonPath)) continue

    const examPkg: ExamPackage = JSON.parse(readFileSync(examJsonPath, 'utf-8'))
    const gradingInfo = examPkg.gradingInfo || []

    let md = `# ${record.student.name} \u2014 ${record.examTitle}\n\n`
    md += `| **\u59D3\u540D** | **\u5B66\u53F7** | **\u8BD5\u5377\u540D\u79F0** | **\u603B\u5206** | **\u4F5C\u7B54\u65F6\u95F4** |\n`
    md += `|:------:|:------:|:------:|:------:|:------:|\n`
    md += `| ${record.student.name} | ${record.student.studentId} | ${record.examTitle} | ${record.totalScore !== undefined ? `${record.totalScore}/${getMaxScore(record.rid) ?? '-'}` : '-'} | ${getSubmissionMeta(record.rid)?.submittedAt ? new Date(getSubmissionMeta(record.rid)!.submittedAt).toLocaleString('zh-CN') : '-'} |\n\n`
    md += `---\n\n`

    if (gradingInfo.length > 0) {
      const sortedGi = [...gradingInfo].sort((a, b) => a.id - b.id)
      md += `| ${sortedGi.map((_, idx) => String(idx + 1)).join(' | ')} |\n`
      md += `|${sortedGi.map(() => ':--:').join('|')}|\n`
      md += `| ${sortedGi
        .map((gi) => {
          const se = record.scores[gi.id]
          return se
            ? `${se.score}/${gi.fullScore ?? gi.scoreOptions?.[gi.scoreOptions.length - 1] ?? '-'}`
            : `-/${gi.fullScore ?? gi.scoreOptions?.[gi.scoreOptions.length - 1] ?? '-'}`
        })
        .join(' | ')} |\n\n`
      md += `---\n\n`
    }

    for (const gi of gradingInfo) {
      const scoreEntry = record.scores[gi.id]
      md += `### \u9898\u76EE\n\n`
      md += `${gi.problemInfo}\n\n`
      md += `<div class="score"><strong>\u5206\u6570\uFF1A${scoreEntry?.score ?? '\u672A\u8BC4\u5206'}</strong></div>\n\n`
      md += `<div class="score"><strong>\u8BC4\u8BED\uFF1A${scoreEntry?.comment || '\u65E0'}</strong></div>\n\n`
      md += `### \u8BC4\u5206\u6807\u51C6\n\n`
      md += `${gi.gradingInfo}\n\n`
      md += `---\n\n`
    }

    try {
      const htmlBody = await marked.parse(md)
      const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="file://${examDir.replace(/\\/g, '/')}/">
<title>${record.student.name}_${record.examTitle}</title>
<style>${css}</style>
</head>
<body>${htmlBody}</body>
</html>`

      const htmlPath = join(tempDir, `${record.rid}_temp.html`)
      writeFileSync(htmlPath, fullHtml, 'utf-8')

      const pdfWin = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
          webSecurity: false,
          nodeIntegration: false,
          contextIsolation: true
        }
      })

      let pdfBuffer: Buffer
      try {
        await pdfWin.loadURL(`file://${htmlPath.replace(/\\/g, '/')}`)
        pdfBuffer = await pdfWin.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4'
        })
      } finally {
        pdfWin.destroy()
        try {
          rmSync(htmlPath)
        } catch {
          /* ignore */
        }
      }

      const filename = `${record.student.studentId}_${record.examTitle}.pdf`
      files.push({ filename, buffer: pdfBuffer })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`PDF generation failed for ${record.student.name}:`, err)
      const failInfo = {
        name: record.student.name,
        studentId: record.student.studentId,
        error: message
      }
      pdfErrors.push(failInfo)
      onPdfError?.(failInfo)
      errorCount++
    }

    onProgress?.(i + 1, batchRecords.length, `已生成 ${record.student.name} 的PDF`)
  }

  onProgress?.(batchRecords.length, batchRecords.length, '完成')

  return { success: true, errorCount, pdfErrors, files }
}
