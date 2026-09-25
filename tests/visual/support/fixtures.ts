import type { ElectronApplication } from '@playwright/test'
import type { ExamPackage } from '@ls101/core-types'
import { encodeExamPackage, encodeSubmissionPackage } from '@ls101/exam-package'
import stableStringify from 'fast-json-stable-stringify'
import { strToU8, zipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  mixedSubmission,
  objectiveSubmission
} from '../../product-docs/support/submission-fixtures'

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

/**
 * 写入一份同时包含客观题和需要人工评分的朗读题的作答包（UI-SR-02 评分工作区）。
 * 复用产品文档的 `mixedSubmission` 夹具，并给朗读答案配一段**可解码的静音 WAV**：
 * 无效音频会让界面异步弹出「录音无法播放」，使默认态截图不稳定。
 */
export async function writeMixedSubmissionFixture(
  directory: string,
  name = 'mixed.lssubmission'
): Promise<string> {
  const file = path.join(directory, name)
  await writeFile(
    file,
    await encodeSubmissionPackage(mixedSubmission(), { 'answer-audio-0': silentWav(3200) })
  )
  return file
}

/** 写入一份只有客观题的作答包（客观题自动判定完成，直接进入评分结算，用于 UI-SR-03）。 */
export async function writeObjectiveSubmissionFixture(
  directory: string,
  name = 'objective.lssubmission'
): Promise<string> {
  const file = path.join(directory, name)
  await writeFile(file, await encodeSubmissionPackage(objectiveSubmission(), {}))
  return file
}

/** 生成指定时长的单声道 16 位 PCM 静音 WAV。 */
function silentWav(durationMs: number, sampleRate = 8000): Uint8Array {
  const samples = Math.max(1, Math.round((sampleRate * durationMs) / 1000))
  const dataSize = samples * 2
  const buffer = Buffer.alloc(44 + dataSize)
  buffer.write('RIFF', 0, 'ascii')
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8, 'ascii')
  buffer.write('fmt ', 12, 'ascii')
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36, 'ascii')
  buffer.writeUInt32LE(dataSize, 40)
  return new Uint8Array(buffer)
}

/**
 * 写入一份**本地不存在**的用户题型文件（`.lsinterface`），用于 UI-IF-06 题型导入审查页。
 * 直接按 `@ls101/interface-editor` 的交换包格式构造：清单 + interface.json + 一个题组，
 * 题型编号按规范化内容哈希派生，确保导入预览判定为「可以导入」而不是已存在/冲突。
 */
export async function writeInterfaceFixture(
  directory: string,
  name = 'vision-import.lsinterface'
): Promise<string> {
  const content = interfaceFixtureContent()
  const interfaceId = deriveInterfaceFixtureId(content)
  const instanceId = '90000000-0000-4000-8000-000000000001'
  const exportedAt = '2026-01-15T08:00:00.000Z'
  const manifest = {
    format: 'ls101-interface-zip',
    version: 2,
    exportedAt,
    interfaceId,
    instances: [{ instanceId, assets: [] }]
  }
  const instance = {
    instanceId,
    name: '导入题组',
    generatedAt: exportedAt,
    values: {
      titleText: 'School life',
      answerText: 'I enjoy reading after class.'
    }
  }
  const bytes = zipSync({
    'manifest.json': jsonBytes(manifest),
    'interface.json': jsonBytes({ id: interfaceId, ...content }),
    [`instances/${instanceId}/instance.json`]: jsonBytes(instance)
  })
  const file = path.join(directory, name)
  await writeFile(file, bytes)
  return file
}

interface InterfaceFixtureContent {
  name: string
  description: string
  promptTemplate: string
  fields: {
    order: string[]
    nodes: Record<string, { type: 'text'; varName: string; description: string; example: string }>
  }
}

function interfaceFixtureContent(): InterfaceFixtureContent {
  return {
    name: '视觉导入题型',
    description: '视觉回归导入审查用题型',
    promptTemplate: '生成一组简短的英语问答练习。',
    fields: {
      order: ['title', 'answer'],
      nodes: {
        title: {
          type: 'text',
          varName: 'titleText',
          description: '练习标题',
          example: 'School life'
        },
        answer: {
          type: 'text',
          varName: 'answerText',
          description: '参考答案',
          example: 'I enjoy reading after class.'
        }
      }
    }
  }
}

/** 复刻 `@ls101/interface-editor` 的规范化哈希，保证导出的题型编号可被校验。 */
function deriveInterfaceFixtureId(content: InterfaceFixtureContent): string {
  const canonical = stableStringify({
    name: normalizeInterfaceText(content.name),
    description: normalizeInterfaceText(content.description),
    promptTemplate: normalizeInterfaceText(content.promptTemplate),
    fields: content.fields.order.map((key) => {
      const node = content.fields.nodes[key] as InterfaceFixtureContent['fields']['nodes'][string]
      return [
        normalizeInterfaceText(key),
        {
          type: node.type,
          varName: normalizeInterfaceText(node.varName),
          description: normalizeInterfaceText(node.description),
          example: normalizeInterfaceText(node.example)
        }
      ]
    })
  })
  return `sha256:${createHash('sha256').update(Buffer.from(canonical, 'utf8')).digest('hex')}`
}

function normalizeInterfaceText(value: string): string {
  return value.replace(/\r\n?/g, '\n').normalize('NFC')
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`)
}

/**
 * 生成试卷（UI-TP-05）用的本地模板：含三页 TTS 播放、不声明题型，
 * 因此生成设置无需选择题组，且语音设置会渲染默认/男声/女声三组下拉。
 */
export function visualGenerationTemplate(templateId: string): Record<string, unknown> {
  return {
    templateId,
    revision: 0,
    content: {
      name: '视觉生成模板',
      description: '视觉回归生成设置默认态',
      interfaces: [],
      root: {
        id: 'root',
        type: 'frame',
        children: [
          speechPage('welcome', 'Welcome to the test'),
          speechPage('man', '[Man]: Good morning'),
          speechPage('woman', '[Woman]: Please begin')
        ]
      },
      schemaUses: []
    },
    resources: { functions: [] },
    editorState: {}
  }
}

function speechPage(id: string, text: string): Record<string, unknown> {
  return {
    id,
    type: 'page',
    content: {
      blocks: [
        {
          id: `${id}-text`,
          type: 'text',
          x: 10,
          y: 20,
          width: 80,
          fontSize: 36,
          align: 'center',
          text: { type: 'string', parts: [{ type: 'literal', value: text }] }
        }
      ]
    },
    timeline: [
      {
        type: 'play',
        text: { type: 'string', parts: [{ type: 'literal', value: text }] }
      }
    ]
  }
}
