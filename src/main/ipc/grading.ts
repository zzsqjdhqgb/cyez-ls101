/*
 * Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 * Proprietary code. Use is subject to the LICENSE file in the repository root.
 */

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import { marked } from 'marked'
import type { GradingListItem, ExamPackage, ChoiceAnswerRecord, RecordingGradingInfoItem, ChoiceGradingInfoItem } from '../../shared/types'
import { ensureDir, getGradingPath, getSubmissionsPath } from '../utils'
import {
  loadRecords,
  getSubmissionMeta,
  getMaxScore,
  importSubmissions,
  GradingSession,
  settleNow,
  listBatches,
  exportCsv,
  exportPdf,
  buildChoiceQuestionsMarkdown
} from '../services/grading-service'
import { getFileFilter } from '../../shared/file-types'
import { getSttEngine } from '../stt/stt-service'

const session = new GradingSession()

export function registerGradingHandlers(): void {
  ensureDir(getGradingPath())

  ipcMain.handle('grading:importSubmissions', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, imported: 0, skipped: 0, failures: [], error: '窗口未就绪' }

    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: '导入作答包',
      filters: [getFileFilter('submission')],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0)
      return { success: false, imported: 0, skipped: 0, failures: [], error: '已取消' }

    return importSubmissions(getGradingPath(), filePaths[0], (current, total) => {
      win.webContents.send('grading:import-progress', { current, total })
    })
  })

  ipcMain.handle(
    'grading:list',
    async (_event, filter?: { studentId?: string; name?: string; examTitle?: string }) => {
      const records = loadRecords()
      const list: GradingListItem[] = []
      for (const rid of Object.keys(records)) {
        const r = records[rid]
        if (filter?.studentId && r.student.studentId !== filter.studentId) continue
        if (filter?.name && !r.student.name.includes(filter.name)) continue
        if (filter?.examTitle && !r.examTitle.includes(filter.examTitle)) continue
        list.push({
          rid: r.rid,
          studentName: r.student.name,
          studentId: r.student.studentId,
          examTitle: r.examTitle,
          status: r.status,
          totalScore: r.totalScore,
          maxScore: getMaxScore(r.rid),
          eid: r.eid,
          submittedAt: getSubmissionMeta(r.rid)?.submittedAt
        })
      }
      return list
    }
  )

  ipcMain.handle('grading:startGrading', async (_event, rids: string[]) => {
    return session.start(rids)
  })

  ipcMain.handle(
    'grading:submitScore',
    async (_event, rid: string, gradingInfoId: number, score: number, comment: string) => {
      return session.submitScore(rid, gradingInfoId, score, comment)
    }
  )

  ipcMain.handle('grading:pauseGrading', async () => {
    return session.pause()
  })

  ipcMain.handle('grading:finishGrading', async () => {
    return session.finish()
  })

  ipcMain.handle('grading:getSettlementInfo', async () => {
    return session.getSettlementInfo()
  })

  ipcMain.handle('grading:settleNow', async () => {
    const result = settleNow(getGradingPath(), session.sessionSettlementRids)
    session.pause()
    return result
  })

  ipcMain.handle('grading:settleLater', async () => {
    return session.pause()
  })

  ipcMain.handle('grading:listBatches', async () => {
    return listBatches(getGradingPath())
  })

  ipcMain.handle('grading:exportCsv', async (event, batchId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return

    const csv = exportCsv(getGradingPath(), batchId)
    if (!csv) return

    const batchPath = join(getGradingPath(), 'batches', batchId, 'batch.json')
    const gradedAt = existsSync(batchPath)
      ? JSON.parse(readFileSync(batchPath, 'utf-8')).gradedAt
      : new Date().toISOString()

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出批改表格',
      defaultPath: `批改记录_${new Date(gradedAt).toISOString().slice(0, 10)}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return

    writeFileSync(filePath, csv, 'utf-8')
  })

  ipcMain.handle('grading:exportPdf', async (event, batchId: string) => {
    const sender = event.sender
    const tempDir = join(tmpdir(), 'grading-pdf-export')

    const result = await exportPdf(
      getGradingPath(),
      batchId,
      tempDir,
      (current, total, step) => {
        sender.send('grading:pdfProgress', { current, total, step })
      },
      (error) => {
        sender.send('grading:pdfError', error)
      }
    )

    if (!result.success) {
      sender.send('grading:pdfProgress', { current: 0, total: 0, step: '保存中...' })
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return result
    }

    for (const file of result.files) {
      writeFileSync(join(tempDir, file.filename), file.buffer)
    }

    sender.send('grading:pdfProgress', {
      current: result.files.length,
      total: result.files.length,
      step: '保存中...'
    })

    const win = BrowserWindow.fromWebContents(sender)
    if (!win) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return { success: false, error: '窗口未就绪' }
    }

    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: '导出批改PDF',
      defaultPath: '批改记录_PDF.zip',
      filters: [{ name: 'ZIP 文件', extensions: ['zip'] }]
    })
    if (canceled || !filePath) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      return { success: false, error: '已取消' }
    }

    const zip = new AdmZip()
    const pdfFiles = readdirSync(tempDir).filter((f) => f.endsWith('.pdf'))
    for (const file of pdfFiles) {
      zip.addLocalFile(join(tempDir, file))
    }
    zip.writeZip(filePath)

    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }

    return { success: true, errorCount: result.errorCount, pdfErrors: result.pdfErrors }
  })

  ipcMain.handle('grading:loadAudio', async (_event, rid: string, recordIndex: number) => {
    if (!Number.isInteger(recordIndex) || recordIndex < 0)
      throw new Error(`无效的录音索引: ${recordIndex}`)
    if (rid.includes('..') || rid.includes('/') || rid.includes('\\'))
      throw new Error('无效的作答 ID')
    const audioPath = join(getGradingPath(), rid, 'recordings', `${recordIndex}.mp3`)
    if (!existsSync(audioPath)) throw new Error(`音频文件不存在: ${recordIndex}.mp3`)
    return `file://${audioPath.replace(/\\/g, '/')}`
  })

  ipcMain.handle('grading:speechToText', async (_event, rid: string, recordIndex: number) => {
    if (!Number.isInteger(recordIndex) || recordIndex < 0)
      throw new Error(`无效的录音索引: ${recordIndex}`)
    if (rid.includes('..') || rid.includes('/') || rid.includes('\\'))
      throw new Error('无效的作答 ID')
    const audioPath = join(getGradingPath(), rid, 'recordings', `${recordIndex}.mp3`)
    if (!existsSync(audioPath)) throw new Error(`音频文件不存在: ${recordIndex}.mp3`)

    const stt = await getSttEngine()
    return stt.transcribe(audioPath)
  })

  ipcMain.handle('grading:getGradingHtml', async (_event, rid: string) => {
    const records = loadRecords()
    const record = records[rid]
    if (!record) return { success: false, error: '作答不存在' }

    const examDir = join(getGradingPath(), rid, 'exam')
    if (!existsSync(examDir)) return { success: false, error: '试卷数据不存在' }

    const examJsonPath = join(examDir, 'exam.json')
    if (!existsSync(examJsonPath)) return { success: false, error: '试卷配置不存在' }

    const examPkg: ExamPackage = JSON.parse(readFileSync(examJsonPath, 'utf-8'))
    const gradingInfo = examPkg.gradingInfo || []
    const recordingGi = gradingInfo.filter(
      (gi): gi is RecordingGradingInfoItem => 'id' in gi
    )

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
      blockquote { margin: 8px 0; padding: 8px 16px; border-left: 4px solid #94a3b8; background: #f8fafc; color: #475569; }
      .correct { color: #16a34a; font-weight: 600; }
      .wrong { color: #dc2626; font-weight: 600; }
    `

    let md = `# ${record.student.name} \u2014 ${record.examTitle}\n\n`
    md += `| **\u59D3\u540D** | **\u5B66\u53F7** | **\u8BD5\u5377\u540D\u79F0** | **\u603B\u5206** | **\u4F5C\u7B54\u65F6\u95F4** |\n`
    md += `|:------:|:------:|:------:|:------:|:------:|\n`
    md += `| ${record.student.name} | ${record.student.studentId} | ${record.examTitle} | ${record.totalScore !== undefined ? `${record.totalScore}/${getMaxScore(record.rid) ?? '-'}` : '-'} | ${getSubmissionMeta(record.rid)?.submittedAt ? new Date(getSubmissionMeta(record.rid)!.submittedAt).toLocaleString('zh-CN') : '-'} |\n\n`
    md += `---\n\n`

    if (recordingGi.length > 0) {
      const sortedGi = [...recordingGi].sort((a, b) => a.id - b.id)
      md += `| ${sortedGi.map((_, idx) => String(idx + 1)).join(' | ')} |\n`
      md += `|${sortedGi.map(() => ':--:').join('|')}|\n`
      md += `| ${sortedGi
        .map((gi) => {
          const se = record.scores[gi.id]
          const fs = gi.fullScore ?? gi.scoreOptions?.[gi.scoreOptions.length - 1] ?? '-'
          return se ? `${se.score}/${fs}` : `-/${fs}`
        })
        .join(' | ')} |\n\n`
      md += `---\n\n`
    }

    for (const gi of recordingGi) {
      const scoreEntry = record.scores[gi.id]
      md += `### \u9898\u76EE\n\n`
      md += `${gi.problemInfo}\n\n`
      md += `<div class="score"><strong>\u5206\u6570\uFF1A${scoreEntry?.score ?? '\u672A\u8BC4\u5206'}</strong></div>\n\n`
      md += `<div class="score"><strong>\u8BC4\u8BED\uFF1A${scoreEntry?.comment || '\u65E0'}</strong></div>\n\n`
      md += `### \u8BC4\u5206\u6807\u51C6\n\n`
      md += `${gi.gradingInfo}\n\n`
      md += `---\n\n`
    }

    // Add choice question results
    md += buildChoiceQuestionsMarkdown(gradingInfo, record.choiceScores)

    try {
      const htmlBody = await marked.parse(md)
      const fullHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<base href="grading-resource://${rid}/exam/">
<title>${record.student.name}_${record.examTitle}</title>
<style>${css}</style>
</head>
<body>${htmlBody}</body>
</html>`
      return { success: true, html: fullHtml }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { success: false, error: message }
    }
  })

  // Export choice-only report directly (no grading batch needed)
  ipcMain.handle(
    'grading:exportChoiceOnlyReport',
    async (_event, submissionId: string): Promise<{ success: boolean; error?: string }> => {
      try {
        const subPath = join(getSubmissionsPath(), submissionId)
        if (!existsSync(subPath)) {
          return { success: false, error: '作答记录不存在' }
        }

        // Load exam
        const examDir = join(subPath, 'exam')
        const examJsonPath = join(examDir, 'exam.json')
        if (!existsSync(examJsonPath)) {
          return { success: false, error: '未找到试卷数据' }
        }
        const examPkg: ExamPackage = JSON.parse(readFileSync(examJsonPath, 'utf-8'))

        // Load choices
        let choiceAnswers: Record<number, string> = {}
        const choicesPath = join(subPath, 'choices.json')
        if (existsSync(choicesPath)) {
          choiceAnswers = JSON.parse(readFileSync(choicesPath, 'utf-8'))
        }

        // Load meta
        let studentInfo = { name: '未知', studentId: '未知' }
        const metaPath = join(subPath, 'meta.json')
        if (existsSync(metaPath)) {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          studentInfo = meta.student
        }

        // Compute scores
        const gradingInfo = examPkg.gradingInfo || []
        const choiceItems = gradingInfo.filter(
          (gi): gi is ChoiceGradingInfoItem => 'choiceId' in gi
        )
        let totalScore = 0
        let maxScore = 0
        const choiceScores: Record<number, ChoiceAnswerRecord> = {}

        // Build choice question lookup
        const choiceQLookup: Record<
          number,
          { stem: string; options: [string, string, string, string]; answer: string }
        > = {}
        for (const q of examPkg.questions) {
          if (q.choicePages) {
            for (const page of q.choicePages) {
              for (const cq of page.questions) {
                choiceQLookup[cq.id] = cq
              }
            }
          }
        }

        for (const gi of choiceItems) {
          const cId = gi.choiceId
          const fullScore = gi.fullScore
          maxScore += fullScore
          const cq = choiceQLookup[cId]
          if (!cq) continue
          const userAnswer = choiceAnswers[cId]
          const isCorrect = choiceAnswers[cId] === cq.answer
          const score = isCorrect ? fullScore : 0
          totalScore += score
          choiceScores[cId] = {
            choiceId: cId,
            userAnswer,
            correctAnswer: cq.answer,
            isCorrect,
            fullScore,
            score
          }
        }

        // Generate markdown
        const css = `
          @page { margin: 10mm; }
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; color: #1e293b; line-height: 1.6; padding: 20px; }
          h1 { font-size: 22px; margin: 0 0 16px; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
          h2 { font-size: 17px; margin: 12px 0 6px; font-weight: 700; }
          h3 { font-size: 15px; margin: 10px 0 4px; font-weight: 600; }
          table { border-collapse: collapse; width: 100%; margin: 6px 0; }
          td, th { border: 1px solid #d1d5db; padding: 4px 8px; }
          hr { border: none; border-top: 1px solid #94a3b8; margin: 16px 0; }
          img { max-width: 100%; margin: 8px 0; }
          a { color: #2563eb; }
          .score { color: #16a34a; font-weight: 600; }
          li { margin-left: 20px; }
          strong { font-weight: 600; }
          p { margin: 4px 0; line-height: 1.6; }
          blockquote { margin: 8px 0; padding: 8px 16px; border-left: 4px solid #94a3b8; background: #f8fafc; color: #475569; }
          .correct { color: #16a34a; font-weight: 600; }
          .wrong { color: #dc2626; font-weight: 600; }
        `

        let md = `# ${studentInfo.name} \u2014 ${examPkg.title}\n\n`
        md += `| **\u59D3\u540D** | **\u5B66\u53F7** | **\u8BD5\u5377\u540D\u79F0** | **\u603B\u5206** |\n`
        md += `|:------:|:------:|:------:|:------:|\n`
        md += `| ${studentInfo.name} | ${studentInfo.studentId} | ${examPkg.title} | ${totalScore}/${maxScore} |\n\n`
        md += `---\n\n`
        md += buildChoiceQuestionsMarkdown(gradingInfo, choiceScores)

        const htmlBody = await marked.parse(md)
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><base href="file://${examDir.replace(/\\/g, '/')}/"><title>${studentInfo.name}_${examPkg.title}_报告</title><style>${css}</style></head><body>${htmlBody}</body></html>`

        // Show save dialog
        const win = BrowserWindow.getFocusedWindow()
        if (!win) return { success: false, error: 'No window' }

        const result = await dialog.showSaveDialog(win, {
          title: '导出报告',
          defaultPath: `报告_${studentInfo.name}_${examPkg.title}.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }]
        })

        if (result.canceled || !result.filePath) return { success: false }

        // Generate PDF
        const tempDir = join(tmpdir(), 'cyez-report-' + Date.now())
        ensureDir(tempDir)
        const htmlPath = join(tempDir, 'report.html')
        writeFileSync(htmlPath, html, 'utf-8')

        const pdfWin = new BrowserWindow({
          width: 800,
          height: 600,
          show: false,
          webPreferences: { webSecurity: false, nodeIntegration: false, contextIsolation: true }
        })

        try {
          await pdfWin.loadURL(`file://${htmlPath.replace(/\\/g, '/')}`)
          const pdfBuffer = await pdfWin.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4'
          })
          writeFileSync(result.filePath, pdfBuffer)
          return { success: true }
        } finally {
          pdfWin.destroy()
          try {
            rmSync(tempDir, { recursive: true, force: true })
          } catch {
            /* ignore */
          }
        }
      } catch (err) {
        console.error('导出报告失败:', err)
        return { success: false, error: String(err) }
      }
    }
  )
}
