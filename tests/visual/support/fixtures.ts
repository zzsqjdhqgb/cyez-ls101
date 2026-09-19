import type { ElectronApplication } from '@playwright/test'
import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage } from '@ls101/exam-package'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * 视觉回归夹具：与 tests/product-docs/flows/take-exam/run.spec.ts 同源，
 * 构造一份最小可运行的 .lsexam（单页、仅倒计时、无资源、无录音）。
 */
export function practiceExam(): ExamPackage {
  return {
    format: 'ls101-exam',
    formatVersion: 1,
    packageId: '70000000-0000-4000-8000-000000000001',
    examData: {
      title: '视觉回归练习卷',
      player: {
        pages: [
          {
            id: 'page-1',
            content: [{ id: 'text-1', type: 'text', x: 10, y: 10, text: '请准备完成练习。' }],
            timeline: [{ type: 'countdown', seconds: 0 }]
          }
        ],
        recordingIndices: []
      },
      resources: {}
    },
    answerCapturePlan: { strings: [], audios: [] },
    submissionTemplate: {
      format: 'ls101-submission',
      formatVersion: 1,
      meta: {
        examPackageId: '70000000-0000-4000-8000-000000000001',
        examTitle: '视觉回归练习卷'
      },
      schemaUses: [],
      resources: {}
    }
  }
}

export async function writeExamFixture(
  directory: string,
  name = 'practice.lsexam'
): Promise<string> {
  const file = path.join(directory, name)
  await writeFile(file, await encodeExamPackage(practiceExam(), {}))
  return file
}

/** 用固定路径替换系统打开对话框，避免真实文件选择。 */
export async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePaths: [selectedPath] })
    })
  }, filePath)
}

/** 用固定路径替换系统保存对话框，避免真实文件选择。 */
export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, selectedPath) => {
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => ({ canceled: false, filePath: selectedPath })
    })
  }, filePath)
}
