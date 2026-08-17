import type {
  ChoiceOptionDef,
  ChoicePageSpec,
  ContentBlock,
  FrameNode,
  FunctionInputDef,
  FunctionInputExpression,
  FunctionOutputDef,
  JsonValue,
  SchemaAnswerBinding,
  SchemaTextExpression,
  SchemaUseAttachment,
  SchemaUse,
  StaticValueExpression,
  TemplateInterfaceRequirement,
  TemplateNode,
  TextExpression,
  TimelineStep
} from '../types'

export interface FunctionCallSignature {
  name?: string
  inputs: readonly FunctionInputDef[]
  outputs: readonly Pick<FunctionOutputDef, 'name' | 'type'>[]
}

export type DefinitionOperation =
  | {
      type: 'insert-node'
      parentId: string
      index?: number
      node: TemplateNode
    }
  | {
      type: 'insert-function-call'
      parentId: string
      index?: number
      functionRef: string
      signature: FunctionCallSignature
      inputs?: Readonly<Record<string, FunctionInputExpression>>
      nodeId?: string
    }
  | { type: 'remove-node'; nodeId: string }
  | { type: 'move-node'; nodeId: string; parentId: string; index?: number }
  | { type: 'copy-node'; nodeId: string; parentId: string; index?: number }
  | { type: 'set-node-name'; nodeId: string; value: string }
  | {
      type: 'set-frame-choice-collector'
      frameId: string
      pages: readonly ChoicePageSpec[] | null
    }
  | { type: 'insert-content-block'; pageId: string; index?: number; block: ContentBlock }
  | { type: 'update-content-block'; pageId: string; blockId: string; block: ContentBlock }
  | { type: 'remove-content-block'; pageId: string; blockId: string }
  | { type: 'move-content-block'; pageId: string; blockId: string; index: number }
  | { type: 'copy-content-block'; pageId: string; blockId: string; index?: number }
  | { type: 'insert-timeline-step'; pageId: string; index?: number; step: TimelineStep }
  | { type: 'update-timeline-step'; pageId: string; index: number; step: TimelineStep }
  | { type: 'remove-timeline-step'; pageId: string; index: number }
  | { type: 'move-timeline-step'; pageId: string; index: number; targetIndex: number }
  | { type: 'copy-timeline-step'; pageId: string; index: number; targetIndex?: number }
  | {
      type: 'set-choice-question'
      nodeId: string
      stem?: TextExpression
      outputName?: string
    }
  | {
      type: 'set-variable'
      nodeId: string
      variableName?: string
      value?: StaticValueExpression
    }
  | { type: 'insert-choice-option'; nodeId: string; index?: number; option: ChoiceOptionDef }
  | { type: 'update-choice-option'; nodeId: string; optionId: string; option: ChoiceOptionDef }
  | { type: 'remove-choice-option'; nodeId: string; optionId: string }
  | { type: 'move-choice-option'; nodeId: string; optionId: string; index: number }
  | { type: 'copy-choice-option'; nodeId: string; optionId: string; index?: number }
  | {
      type: 'set-function-call-input'
      nodeId: string
      inputName: string
      expression: FunctionInputExpression | null
    }
  | {
      type: 'set-function-call-output-name'
      nodeId: string
      outputName: string
      value: string | null
    }
  | { type: 'reconcile-function-call'; nodeId: string; signature: FunctionCallSignature }
  | { type: 'insert-schema-use'; index?: number; use: SchemaUse }
  | { type: 'update-schema-use'; useId: string; use: SchemaUse }
  | { type: 'remove-schema-use'; useId: string }
  | {
      type: 'set-schema-input-binding'
      useId: string
      inputId: string
      expression: SchemaTextExpression | null
    }
  | {
      type: 'set-schema-answer-binding'
      useId: string
      answerId: string
      binding: SchemaAnswerBinding | null
    }
  | {
      type: 'insert-schema-attachment'
      useId: string
      index?: number
      attachment: SchemaUseAttachment
    }
  | {
      type: 'update-schema-attachment'
      useId: string
      varName: string
      attachment: SchemaUseAttachment
    }
  | { type: 'remove-schema-attachment'; useId: string; varName: string }
  | { type: 'set-editor-state'; key: string; value: JsonValue | undefined }

export type TemplateDocumentOperation =
  | DefinitionOperation
  | { type: 'set-template-name'; value: string }
  | { type: 'set-template-description'; value: string }
  | {
      type: 'insert-interface-requirement'
      index?: number
      requirement: TemplateInterfaceRequirement
    }
  | {
      type: 'update-interface-requirement'
      alias: string
      requirement: TemplateInterfaceRequirement
    }
  | { type: 'remove-interface-requirement'; alias: string }

export type FunctionDocumentOperation =
  | DefinitionOperation
  | { type: 'set-function-name'; value: string }
  | { type: 'insert-function-input'; index?: number; input: FunctionInputDef }
  | { type: 'update-function-input'; name: string; input: FunctionInputDef }
  | { type: 'remove-function-input'; name: string }
  | { type: 'insert-function-output'; index?: number; output: FunctionOutputDef }
  | { type: 'update-function-output'; name: string; output: FunctionOutputDef }
  | { type: 'remove-function-output'; name: string }

export type DocumentEditErrorCode =
  | 'NODE_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_NOT_FRAME'
  | 'ROOT_NODE_IMMUTABLE'
  | 'MOVE_INTO_DESCENDANT'
  | 'INVALID_INDEX'
  | 'WRONG_NODE_TYPE'
  | 'CONTENT_BLOCK_NOT_FOUND'
  | 'CONTENT_BLOCK_ID_CONFLICT'
  | 'TIMELINE_STEP_NOT_FOUND'
  | 'CHOICE_OPTION_NOT_FOUND'
  | 'CHOICE_OPTION_ID_CONFLICT'
  | 'SCHEMA_USE_NOT_FOUND'
  | 'SCHEMA_USE_ID_CONFLICT'
  | 'SCHEMA_ATTACHMENT_NOT_FOUND'
  | 'SCHEMA_ATTACHMENT_NAME_CONFLICT'
  | 'INTERFACE_REQUIREMENT_NOT_FOUND'
  | 'INTERFACE_ALIAS_CONFLICT'
  | 'FUNCTION_INPUT_NOT_FOUND'
  | 'FUNCTION_INPUT_NAME_CONFLICT'
  | 'FUNCTION_OUTPUT_NOT_FOUND'
  | 'FUNCTION_OUTPUT_NAME_CONFLICT'

export interface DocumentEditError {
  code: DocumentEditErrorCode
  path: string
  params: Readonly<Record<string, string | number>>
}

export interface DocumentEditChange {
  kind: 'insert' | 'update' | 'remove' | 'move' | 'cleanup'
  path: string
  previousPath?: string
  subjectId?: string
}

export type DocumentEditResult<TDocument, TOperation> =
  | {
      applied: true
      document: TDocument
      previousDocument: TDocument
      operation: TOperation
      changes: readonly DocumentEditChange[]
    }
  | {
      applied: false
      document: TDocument
      operation: TOperation
      error: DocumentEditError
    }

export interface DefinitionState {
  root: FrameNode
  schemaUses: SchemaUse[]
  editorState: Record<string, JsonValue>
  reservedNames: readonly string[]
}

export interface MutationSuccess {
  state: DefinitionState
  changes: DocumentEditChange[]
}

export type MutationResult = MutationSuccess | { error: DocumentEditError }
