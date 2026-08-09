// @ls101/core-types - Template Compiler、ExamPlayer 与评分系统的共享契约

import type { CompiledSchemaPipeline } from './schema'

export interface ExamPackage {
  title: string
  player: PlayerExamData
  schema: CompiledSchemaPipeline
}

export interface PlayerExamData {
  pages: ExamPage[]
  recordingIndices: number[]
  choiceMeta?: PlayerChoiceMeta
}

export interface ExamPage {
  id: string
  content: ResolvedContentBlock[]
  timeline: ResolvedTimelineStep[]
}

export type ResolvedContentBlock = ResolvedTextBlock | ResolvedImageBlock | PlayerChoiceView

export interface ResolvedTextBlock {
  id: string
  type: 'text'
  x: number
  y: number
  width?: number
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  text: string
}

export interface ResolvedImageBlock {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  src: string
}

export interface PlayerChoiceView {
  id: string
  type: 'choice-view'
  x: number
  y: number
  width: number
  height: number
  defaultViewport: ResolvedChoiceViewport
}

export type ResolvedTimelineStep = ResolvedTimelineAction & {
  choiceViewOverrides?: Record<string, ResolvedChoiceViewport>
}

export type ResolvedTimelineAction =
  /** 已解析完成、供 ExamPlayer TTS 播放的文本。 */
  | { type: 'play'; text: string }
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex: number }

export type ResolvedChoiceViewport =
  | { mode: 'free'; initialPage?: number }
  | { mode: 'focus'; choiceIndex: number }
  | {
      mode: 'range'
      startPage: number
      endPage: number
      initialPage?: number
    }

export interface PlayerChoiceMeta {
  pages: Array<{ questionIndices: number[] }>
  questions: PlayerChoiceQuestion[]
}

export interface PlayerChoiceQuestion {
  choiceIndex: number
  stem: string
  options: PlayerChoiceOption[]
}

export interface PlayerChoiceOption {
  label: ChoiceOptionLabel
  content: string
}

export type ChoiceOptionLabel =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'

export type ChoiceAnswer = ChoiceOptionLabel | '-'
