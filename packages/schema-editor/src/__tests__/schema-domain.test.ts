import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { SchemaData, SchemaStructure } from '@ls101/core-types'
import {
  addSchemaDraft,
  createSchemaDefinition,
  createSchemaDraft,
  createSchemaDraftLibrary,
  createSchemaStructure,
  deriveSchemaStructureHash,
  FileSchemaRepository,
  initializeBuiltinSchemas,
  parseSchemaDefinition,
  SchemaRepositoryError,
  updateSchemaDefinition,
  validateGradingResult,
  validateSchemaData,
  validateSchemaDefinition,
  validateSchemaStructure,
  verifySchemaDefinition,
  type SchemaStore
} from '../index'

function objectiveStructure(): SchemaStructure {
  return createSchemaStructure('objective', [{ answerId: 'answer', type: 'text' }])
}

function fixedReadingStructure(): SchemaStructure {
  return createSchemaStructure('fixed-reading', [
    { answerId: 'sentence-1', type: 'fixed-speech' },
    { answerId: 'sentence-2', type: 'fixed-speech' }
  ])
}

function freetalkStructure(): SchemaStructure {
  return createSchemaStructure('freetalk', [{ answerId: 'response', type: 'free-speech' }])
}

function schemaData(name = '朗读评分', maxScore = 10): SchemaData {
  return {
    name,
    description: '两句朗读合并评分',
    maxScore,
    answerDescriptions: { 'sentence-1': '第一句', 'sentence-2': '第二句' },
    inputDescriptions: {},
    rubricMarkdown: '根据发音和流利度评分。',
    extraPromptMarkdown: ''
  }
}

describe('Schema domain', () => {
  it('validates the answer contract for each question type', () => {
    expect(validateSchemaStructure(objectiveStructure()).valid).toBe(true)
    expect(validateSchemaStructure(fixedReadingStructure()).valid).toBe(true)
    expect(validateSchemaStructure(freetalkStructure()).valid).toBe(true)
    expect(objectiveStructure().templateInputs.map((input) => input.inputId)).toEqual([
      'question-description',
      'analysis'
    ])
    expect(fixedReadingStructure().templateInputs.map((input) => input.inputId)).toEqual([
      'question-description',
      'reference-answer'
    ])
    expect(freetalkStructure().templateInputs.map((input) => input.inputId)).toEqual([
      'question-description',
      'reference-answer'
    ])

    const invalid: SchemaStructure = {
      ...fixedReadingStructure(),
      answerFormat: [{ answerId: 'answer', type: 'free-speech' }]
    }
    expect(validateSchemaStructure(invalid).errors.map((error) => error.code)).toContain(
      'INVALID_ANSWER_FORMAT_FOR_QUESTION_TYPE'
    )
  })

  it('keeps builtin input descriptions out of published Schema data', () => {
    expect(validateSchemaData(schemaData(), fixedReadingStructure()).valid).toBe(true)
    expect(
      validateSchemaData(
        {
          ...schemaData(),
          inputDescriptions: {
            'question-description': '重复的题目描述',
            'reference-answer': '重复的参考答案'
          }
        },
        fixedReadingStructure()
      ).errors
    ).toContainEqual(
      expect.objectContaining({
        path: 'inputDescriptions.question-description',
        code: 'UNKNOWN_INPUT_DESCRIPTION'
      })
    )
    expect(
      validateSchemaData(
        {
          ...schemaData(),
          inputDescriptions: { 'reference-answer': '重复的参考答案' }
        },
        fixedReadingStructure()
      ).errors
    ).toContainEqual(
      expect.objectContaining({
        path: 'inputDescriptions.reference-answer',
        code: 'UNKNOWN_INPUT_DESCRIPTION'
      })
    )
  })

  it('publishes multiple independent schemas from one structure draft', async () => {
    const draft = createSchemaDraft('双句朗读', fixedReadingStructure())
    const first = await createSchemaDefinition(draft, schemaData('普通评分', 10))
    const second = await createSchemaDefinition(draft, schemaData('严格评分', 20))

    expect(first.schemaId).not.toBe(second.schemaId)
    expect(first.sourceDraftId).toBe(draft.draftId)
    expect(first.structureHash).toBe(second.structureHash)
    expect(first.structureHash).toBe(await deriveSchemaStructureHash(draft.structure))
    expect(await verifySchemaDefinition(first)).toBe(true)
    expect(validateSchemaDefinition(first)).toEqual({ valid: true, errors: [] })
  })

  it('updates published data without changing identity or structure', async () => {
    const draft = createSchemaDraft('双句朗读', fixedReadingStructure())
    const published = await createSchemaDefinition(draft, schemaData())
    const updated = updateSchemaDefinition(published, schemaData('新名称', 15))

    expect(updated.schemaId).toBe(published.schemaId)
    expect(updated.structureHash).toBe(published.structureHash)
    expect(updated.structure).toEqual(published.structure)
    expect(updated.revision).toBe(published.revision + 1)
    expect(updated.data.maxScore).toBe(15)
    expect(await verifySchemaDefinition(updated)).toBe(true)
  })

  it('detects structure tampering independently of editable data', async () => {
    const draft = createSchemaDraft('双句朗读', fixedReadingStructure())
    const published = await createSchemaDefinition(draft, schemaData())
    const tampered = {
      ...published,
      structure: {
        ...published.structure,
        answerFormat: [
          ...published.structure.answerFormat,
          { answerId: 'sentence-3', type: 'fixed-speech' as const }
        ]
      },
      data: {
        ...published.data,
        answerDescriptions: { ...published.data.answerDescriptions, 'sentence-3': '第三句' }
      }
    }

    expect(validateSchemaDefinition(tampered).valid).toBe(true)
    expect(await verifySchemaDefinition(tampered)).toBe(false)
    expect(parseSchemaDefinition(tampered)).not.toBeNull()
  })

  it('validates score bounds and Markdown comment shape', () => {
    expect(validateGradingResult({ score: 8.5, comment: '**Good**' }, 10).valid).toBe(true)
    expect(validateGradingResult({ score: 11, comment: '' }, 10).errors).toEqual([
      expect.objectContaining({ code: 'INVALID_SCORE' })
    ])
  })
})

describe('Schema repository', () => {
  it('creates and updates a complete Schema without a draft', async () => {
    const repository = new FileSchemaRepository(new MemorySchemaStore())
    const created = await repository.createSchema(fixedReadingStructure(), schemaData())

    expect(created.revision).toBe(0)
    expect(created.data.name).toBe('朗读评分')
    expect(created.sourceDraftId).not.toBe('')

    const updated = await repository.updateSchema(
      created.schemaId,
      created.revision,
      fixedReadingStructure(),
      schemaData('已调整说明', 15)
    )

    expect(updated.revision).toBe(1)
    expect(updated.structure).toEqual(created.structure)
    expect(updated.structureHash).toBe(created.structureHash)

    const changedStructure = createSchemaStructure('fixed-reading', [
      ...fixedReadingStructure().answerFormat,
      { answerId: 'sentence-3', type: 'fixed-speech' }
    ])
    await expect(
      repository.updateSchema(updated.schemaId, updated.revision, changedStructure, {
        ...schemaData('再次修改', 20),
        answerDescriptions: {
          ...schemaData('再次修改', 20).answerDescriptions,
          'sentence-3': '第三句'
        }
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('replaces a persisted bundled Schema from an obsolete structure', async () => {
    const manifest = JSON.parse(
      await readFile('resources/builtin/schema-editor/.text/builtin-schemas.json', 'utf8')
    ) as { schemas: unknown[] }
    const bundled = parseSchemaDefinition(manifest.schemas[0])
    if (!bundled) throw new Error('Bundled Schema fixture is invalid')

    const legacyStructure: SchemaStructure = {
      ...bundled.structure,
      templateInputs: bundled.structure.templateInputs.filter(
        (input) => input.inputId !== 'reference-answer'
      )
    }
    const legacy = {
      ...bundled,
      structureHash: await deriveSchemaStructureHash(legacyStructure),
      structure: legacyStructure
    }
    expect(await verifySchemaDefinition(legacy)).toBe(true)
    expect(validateSchemaDefinition(legacy).valid).toBe(false)

    const store = new MemorySchemaStore()
    await store.scope('published').scope(bundled.schemaId).writeText('schema.json', legacy)
    const repository = new FileSchemaRepository(store)

    await initializeBuiltinSchemas(repository, manifest)

    expect(await repository.getSchema(bundled.schemaId)).toEqual(bundled)
    expect(await repository.listBuiltinSchemaIds()).toContain(bundled.schemaId)
  })

  it('registers bundled schemas idempotently and keeps them immutable', async () => {
    const repository = new FileSchemaRepository(new MemorySchemaStore())
    const manifest = JSON.parse(
      await readFile('resources/builtin/schema-editor/.text/builtin-schemas.json', 'utf8')
    ) as unknown

    const first = await initializeBuiltinSchemas(repository, manifest)
    const sentenceSchema = first.find((item) => item.data.name === '上海高考 - 朗读句子')
    const passageSchema = first.find((item) => item.data.name === '上海高考 - 朗读短文')
    expect(first).toHaveLength(7)
    expect(sentenceSchema?.structure.answerFormat).toEqual([
      { answerId: 'sentence-1', type: 'fixed-speech' },
      { answerId: 'sentence-2', type: 'fixed-speech' }
    ])
    expect(sentenceSchema?.data.maxScore).toBe(1)
    expect(passageSchema?.structure.templateInputs).toContainEqual({
      inputId: 'reference-answer',
      type: 'text',
      required: true
    })
    expect(passageSchema?.data.rubricMarkdown).toContain(
      '考生在规定时间内未朗读完整篇短文，不得因此扣分'
    )

    if (!sentenceSchema) throw new Error('Bundled sentence Schema was not found')
    await expect(
      repository.updateSchemaData(sentenceSchema.schemaId, 0, {
        ...sentenceSchema.data,
        description: '用户调整后的说明'
      })
    ).rejects.toMatchObject({ code: 'BUILTIN_SCHEMA' })
    await initializeBuiltinSchemas(repository, manifest)

    expect((await repository.getSchema(sentenceSchema.schemaId))?.data.description).toBe(
      sentenceSchema.data.description
    )
    expect(await repository.listSchemaIds()).toHaveLength(7)
    expect(await repository.listBuiltinSchemaIds()).toContain(
      '69fc2dc6-31d6-4666-bf6f-4b65a1e996dd'
    )
    await expect(repository.deleteSchema(sentenceSchema.schemaId)).rejects.toMatchObject({
      code: 'BUILTIN_SCHEMA'
    } satisfies Partial<SchemaRepositoryError>)
    expect(await repository.getSchema(sentenceSchema.schemaId)).not.toBeNull()
  })

  it('uses revision checks when saving draft libraries', async () => {
    const repository = new FileSchemaRepository(new MemorySchemaStore())
    const created = await repository.saveDraftLibrary(createSchemaDraftLibrary('评分结构'))
    const updated = await repository.saveDraftLibrary({ ...created, name: '已修改' })

    expect(updated.revision).toBe(1)
    await expect(
      repository.saveDraftLibrary({ ...created, name: '过期修改' })
    ).rejects.toMatchObject({
      code: 'REVISION_CONFLICT'
    } satisfies Partial<SchemaRepositoryError>)
  })

  it('saves draft libraries, publishes repeatedly, and updates only formal data', async () => {
    const repository = new FileSchemaRepository(new MemorySchemaStore())
    const draft = createSchemaDraft('双句朗读', fixedReadingStructure())
    const added = addSchemaDraft(createSchemaDraftLibrary('口语评分结构'), draft)
    expect(added.success).toBe(true)
    if (!added.success) return

    const storedLibrary = await repository.saveDraftLibrary(added.library)
    const first = await repository.publishDraft(
      storedLibrary.libraryId,
      draft.draftId,
      schemaData('普通评分', 10)
    )
    const second = await repository.publishDraft(
      storedLibrary.libraryId,
      draft.draftId,
      schemaData('严格评分', 20)
    )

    expect(await repository.listSchemaIds()).toEqual([first.schemaId, second.schemaId].sort())
    expect(first.schemaId).not.toBe(second.schemaId)
    expect(first.structureHash).toBe(second.structureHash)

    const updated = await repository.updateSchemaData(first.schemaId, 0, schemaData('已调整', 12))
    expect(updated.revision).toBe(1)
    expect(updated.structure).toEqual(first.structure)
    expect((await repository.getSchema(first.schemaId))?.data.maxScore).toBe(12)

    await expect(
      repository.updateSchemaData(first.schemaId, 0, schemaData('过期修改', 8))
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' } satisfies Partial<SchemaRepositoryError>)
  })

  it('rejects publishing an invalid draft structure', async () => {
    const repository = new FileSchemaRepository(new MemorySchemaStore())
    const invalidDraft = createSchemaDraft('无题面', {
      ...objectiveStructure(),
      templateInputs: []
    })
    const added = addSchemaDraft(createSchemaDraftLibrary('无效结构'), invalidDraft)
    if (!added.success) throw new Error('fixture setup failed')
    const library = await repository.saveDraftLibrary(added.library)

    await expect(
      repository.publishDraft(library.libraryId, invalidDraft.draftId, {
        ...schemaData('客观题', 1),
        answerDescriptions: { answer: '学生答案' },
        inputDescriptions: {},
        rubricMarkdown: ''
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' } satisfies Partial<SchemaRepositoryError>)
  })
})

interface MemoryData {
  texts: Map<string, unknown>
  scopes: Set<string>
}

class MemorySchemaStore implements SchemaStore {
  constructor(
    private readonly data: MemoryData = { texts: new Map(), scopes: new Set() },
    private readonly path: string[] = []
  ) {}

  scope(name: string): SchemaStore {
    const path = [...this.path, name]
    this.data.scopes.add(path.join('/'))
    return new MemorySchemaStore(this.data, path)
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = this.data.texts.get(this.key(filename))
    return value === undefined ? null : (structuredClone(value) as T)
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.data.texts.set(this.key(filename), structuredClone(data))
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.data.texts.get(key)
    const currentValue = current === undefined ? null : current
    if (JSON.stringify(currentValue) !== JSON.stringify(expected)) return false
    this.data.texts.set(key, structuredClone(data))
    return true
  }

  async listScopes(): Promise<string[]> {
    const prefix = this.path.length === 0 ? '' : `${this.path.join('/')}/`
    const children = new Set<string>()
    for (const scope of this.data.scopes) {
      if (!scope.startsWith(prefix)) continue
      const rest = scope.slice(prefix.length)
      if (rest && !rest.includes('/')) children.add(rest)
    }
    return [...children]
  }

  async clear(): Promise<void> {
    const prefix = `${this.path.join('/')}/`
    for (const key of [...this.data.texts.keys()]) {
      if (key.startsWith(prefix)) this.data.texts.delete(key)
    }
    for (const scope of [...this.data.scopes]) {
      if (scope === this.path.join('/') || scope.startsWith(prefix)) this.data.scopes.delete(scope)
    }
  }

  private key(filename: string): string {
    return `${this.path.join('/')}/${filename}`
  }
}
