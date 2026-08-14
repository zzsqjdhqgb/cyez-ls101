// @ls101/schema-editor - UI-independent Schema structure and publication domain

export {
  canonicalizeSchemaStructure,
  createSchemaDraft,
  createSchemaDraftLibrary,
  createSchemaDefinition,
  createSchemaId,
  deriveSchemaStructureHash,
  isSchemaId,
  isSchemaDraftId,
  isSchemaLibraryId,
  isSchemaStructureHash,
  updateSchemaDefinition,
  updateSchemaDraft,
  verifySchemaDefinition
} from './identity'
export {
  validateSchemaDefinition,
  validateSchemaData,
  validateSchemaDraft,
  validateSchemaDraftLibrary,
  validateGradingResult,
  validateSchemaStructure,
  type SchemaValidationError,
  type SchemaValidationErrorCode,
  type SchemaValidationResult
} from './validation'
export { parseSchemaDefinition, parseSchemaDraftLibrary } from './parser'
export {
  createSchemaStructure,
  isSchemaBuiltinInput,
  schemaBuiltinInputDescription,
  SCHEMA_OBJECTIVE_ANALYSIS_INPUT_ID,
  SCHEMA_QUESTION_DESCRIPTION_INPUT_ID
} from './structure'
export {
  addSchemaDraft,
  removeSchemaDraft,
  replaceSchemaDraft,
  type SchemaDraftLibraryEditResult
} from './library'
export {
  FileSchemaRepository,
  SchemaRepositoryError,
  type SchemaRepository,
  type SchemaStore
} from './repository'
export {
  BuiltinSchemaInitializationError,
  initializeBuiltinSchemas,
  type BundledSchemaManifest
} from './builtin-initializer'
export type {
  GradingResult,
  SchemaAnswerDefinition,
  SchemaAnswerType,
  SchemaData,
  SchemaDefinition,
  SchemaDraft,
  SchemaDraftLibraryDocument,
  SchemaQuestionType,
  SchemaStructure,
  SchemaTemplateInputDefinition,
  SchemaTemplateInputType
} from '@ls101/core-types'
