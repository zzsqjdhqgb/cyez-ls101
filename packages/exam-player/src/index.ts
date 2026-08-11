// @ls101/exam-player - 考试播放器公共入口

export { ExamPlayer } from './ExamPlayer'
export type { ExamPlayerProps } from './ExamPlayer'
export { ExamPageView } from './ExamPageView'
export type { ExamPageViewProps, ExamPageVisualStep } from './ExamPageView'
export { ExamLoadError, loadExam, resourceKey } from './loading'
export type { LoadedExam } from './loading'
export {
  assembleSubmission,
  SubmissionAssemblyError,
  type CapturedAudioAnswer,
  type SubmissionAssemblyErrorCode,
  type SubmissionAssemblyInput,
  type SubmissionBundle
} from './submission'
