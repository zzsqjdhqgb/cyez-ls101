// @ls101/core-types — 全项目共享的基础类型定义
//
// 本模块只包含被多个包引用的跨模块契约类型。
// 按领域拆分为独立文件，index.ts 仅做 re-export。
// 各包内部的领域类型（InterfaceDef、SectionDef 等）定义在各自的包中。

export type { InterfaceVarInfo, InterfaceVarManifest, InterfaceInstance } from './interface'
export type {
  SchemaFormatVersion,
  SchemaQuestionType,
  SchemaAnswerType,
  SchemaTemplateInputType,
  SchemaStructure,
  SchemaAnswerDefinition,
  SchemaTemplateInputDefinition,
  SchemaData,
  SchemaDraft,
  SchemaDraftLibraryDocument,
  SchemaDefinition,
  GradingResult,
  CompiledSchemaInput
} from './schema'
export type {
  SubmissionFormatVersion,
  SubmissionCandidate,
  SubmissionTemplate,
  SubmissionPackage,
  SubmissionMeta,
  SubmissionAnswers,
  SubmissionAudioAnswer,
  SubmissionSchemaUse,
  SubmissionSchemaAnswer,
  SubmissionResourceManifest,
  SubmissionResourceEntry
} from './submission'
export type {
  ExamFormatVersion,
  ExamPackage,
  AnswerCapturePlan,
  StringAnswerCapture,
  AudioAnswerCapture,
  ExamResourceManifest,
  ExamResourceEntry,
  PlayerExamData,
  ExamPage,
  ResolvedContentBlock,
  ResolvedTextBlock,
  ResolvedImageBlock,
  PlayerChoiceView,
  ResolvedTimelineStep,
  ResolvedTimelineAction,
  ResolvedChoiceViewport,
  PlayerChoiceMeta,
  PlayerChoiceQuestion,
  PlayerChoiceOption,
  ChoiceOptionLabel,
  ChoiceAnswer
} from './exam'
export type { TaskProgressItem, TaskProgressSnapshot, TaskProgressHandle } from './task-progress'
export { WINDOW_CONTROL_CHANNELS, WINDOW_CONTROL_EVENTS } from './window-controls'
export type { WindowControlsBridge } from './window-controls'
