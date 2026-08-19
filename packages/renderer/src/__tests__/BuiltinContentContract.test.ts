import type { InterfaceInstance, InterfaceVarManifest } from '@ls101/core-types'
import { decodeExamPackage, encodeExamPackage } from '@ls101/exam-package'
import { createInterfaceApplication } from '@ls101/interface-editor'
import { FileInterfaceRepository, type InterfaceStore } from '@ls101/interface-editor/adapters'
import {
  FileBundledInterfaceRepository,
  type ReadonlyInterfaceStore
} from '@ls101/interface-editor/builtin'
import {
  FileSchemaRepository,
  initializeBuiltinSchemas,
  type SchemaStore
} from '@ls101/schema-editor'
import { createTemplateApplication } from '@ls101/template-editor'
import { FileTemplateRepository, type TemplateStore } from '@ls101/template-editor/adapters'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const BUILTIN_ROOT = path.resolve(import.meta.dirname, '../../../../resources/builtin')
const TEMPLATE_ID = '0c283c54-683a-498c-bf69-fb1490f99356'
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('builtin content contract', () => {
  it('loads the shipped catalogs and compiles every builtin template into a valid exam archive', async () => {
    const store = new MemoryStore()
    const interfaceRepository = new FileInterfaceRepository(store.scope('interfaces'))
    const bundledInterfaces = await new FileBundledInterfaceRepository(
      new DiskReadonlyStore(path.join(BUILTIN_ROOT, 'interface-editor'))
    ).loadAll()
    for (const entry of bundledInterfaces) {
      await interfaceRepository.installBuiltinInterface(entry.builtinKey, entry.currentInterface)
    }

    const interfaceApplication = createInterfaceApplication({
      repository: interfaceRepository,
      fileDialog: {
        readBinary: async () => null,
        writeBinary: async () => false
      }
    })
    const interfaceManifests = new Map(
      await Promise.all(
        bundledInterfaces.map(async ({ currentInterface }) => {
          const manifest = await interfaceApplication.published.getVarManifest(currentInterface.id)
          return [manifest.interfaceId, manifest] as const
        })
      )
    )

    const schemaRepository = new FileSchemaRepository(store.scope('schema-editor'))
    await initializeBuiltinSchemas(
      schemaRepository,
      await readJson(path.join(BUILTIN_ROOT, 'schema-editor', '.text', 'builtin-schemas.json'))
    )

    const templateRepository = new FileTemplateRepository(store.scope('template-editor'))
    const functionLibraryManifest = await readJson(
      path.join(BUILTIN_ROOT, 'template-editor', '.text', 'builtin-function-libraries.json')
    )
    const templateManifest = await readJson(
      path.join(BUILTIN_ROOT, 'template-editor', '.text', 'builtin-templates.json')
    )
    const locatedByInterface = new Map<string, ReturnType<typeof createLocatedInstance>>()
    const locatedByInstance = new Map<string, ReturnType<typeof createLocatedInstance>>()
    const application = createTemplateApplication({
      repository: templateRepository,
      getBuiltinFunctionLibraryManifest: async () => functionLibraryManifest,
      getBuiltinTemplateManifest: async () => templateManifest,
      listInterfaceManifests: async () => [...interfaceManifests.values()],
      getInterfaceManifest: async (interfaceId) => interfaceManifests.get(interfaceId) ?? null,
      getSchema: (schemaId) => schemaRepository.getSchema(schemaId),
      locateInterfaceInstance: async (instanceId) => locatedByInstance.get(instanceId) ?? null
    })

    await application.initialize()

    expect(bundledInterfaces.map(({ builtinKey }) => builtinKey)).toEqual([
      'shanghai-gaokao-listening',
      'shanghai-gaokao-speaking',
      'shanghai-zhongkao-speaking'
    ])
    const templateSummaries = await application.browser.listBuiltinTemplates()
    expect(templateSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          templateId: TEMPLATE_ID,
          name: '上海高考口语标准题型',
          available: true,
          errors: []
        })
      ])
    )
    expect(templateSummaries.length).toBeGreaterThan(0)
    for (const summary of templateSummaries) {
      expect(summary).toMatchObject({ available: true, errors: [] })
    }
    expect(await application.browser.listFunctionLibraries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libraryId: 'builtin:shanghai-gaokao-basic' }),
        expect.objectContaining({ libraryId: 'builtin:shanghai-gaokao-choice' }),
        expect.objectContaining({ libraryId: 'builtin:shanghai-gaokao-groups' })
      ])
    )

    const choiceTemplate = await application.templates.create({ name: '选择题1~20契约' })
    const insertedChoiceGroup = await application.templates.insertFunctionCall(
      choiceTemplate.templateId,
      {
        library: { source: 'builtin', libraryId: 'builtin:shanghai-gaokao-choice' },
        functionId: 'builtin:shanghai-gaokao-choice-group-1-10'
      },
      'root'
    )
    const insertedPassageGroup = await application.templates.insertFunctionCall(
      choiceTemplate.templateId,
      {
        library: { source: 'builtin', libraryId: 'builtin:shanghai-gaokao-choice' },
        functionId: 'builtin:shanghai-gaokao-choice-passage-group-11-16'
      },
      'root'
    )
    const insertedConversationGroup = await application.templates.insertFunctionCall(
      choiceTemplate.templateId,
      {
        library: { source: 'builtin', libraryId: 'builtin:shanghai-gaokao-choice' },
        functionId: 'builtin:shanghai-gaokao-choice-long-conversation-group-17-20'
      },
      'root'
    )
    const composedChoiceTemplate = insertedConversationGroup.template
    composedChoiceTemplate.content.root.choiceCollector = {
      pages: [5, 5, 3, 3, 4].map((questionCount) => ({ questionCount }))
    }
    const insertedChoiceCall = composedChoiceTemplate.content.root.children.find(
      (child) => child.id === insertedChoiceGroup.callNodeId
    )
    const insertedPassageCall = composedChoiceTemplate.content.root.children.find(
      (child) => child.id === insertedPassageGroup.callNodeId
    )
    const insertedConversationCall = composedChoiceTemplate.content.root.children.find(
      (child) => child.id === insertedConversationGroup.callNodeId
    )
    if (
      insertedChoiceCall?.type !== 'function' ||
      insertedPassageCall?.type !== 'function' ||
      insertedConversationCall?.type !== 'function'
    ) {
      throw new Error('Builtin choice group calls were not inserted')
    }
    insertedChoiceCall.inputs.choice = {
      type: 'choice-group',
      source: 'global',
      selection: { kind: 'range', startPage: 0 }
    }
    insertedPassageCall.inputs.choice = {
      type: 'choice-group',
      source: 'global',
      selection: { kind: 'range', startPage: 2 }
    }
    insertedConversationCall.inputs.choice = {
      type: 'choice-group',
      source: 'global',
      selection: { kind: 'range', startPage: 4 }
    }
    const savedChoiceTemplate = await application.templates.save(composedChoiceTemplate)
    await expect(application.templates.validate(choiceTemplate.templateId)).resolves.toEqual({
      valid: true,
      errors: []
    })
    insertedChoiceCall.inputs.tts = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Dialogue 1' }]
    }
    insertedChoiceCall.inputs.stem1 = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Stem 1' }]
    }
    insertedPassageCall.inputs.tts = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Passage 1' }]
    }
    insertedPassageCall.inputs.stem11 = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Stem 11' }]
    }
    insertedConversationCall.inputs.tts = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Long conversation' }]
    }
    insertedConversationCall.inputs.stem17 = {
      type: 'string',
      parts: [{ type: 'literal', value: 'Stem 17' }]
    }
    const choicePreview = await application.templates.preview(savedChoiceTemplate, [])
    if (!choicePreview.success) {
      throw new Error(
        `Builtin choice group preview failed: ${JSON.stringify(choicePreview.errors)}`
      )
    }
    expect(choicePreview.preview.pages).toHaveLength(31)
    expect(choicePreview.preview.choiceMeta?.pages).toEqual([
      { questionIndices: [0, 1, 2, 3, 4] },
      { questionIndices: [5, 6, 7, 8, 9] },
      { questionIndices: [10, 11, 12] },
      { questionIndices: [13, 14, 15] },
      { questionIndices: [16, 17, 18, 19] }
    ])
    expect(choicePreview.preview.pages[1]?.timeline[0]).toEqual({
      type: 'play',
      text: 'Dialogue 1\nQuestion: Stem 1'
    })
    expect(choicePreview.preview.pages[13]?.timeline[0]).toEqual({
      type: 'play',
      text: 'Passage 1'
    })
    expect(choicePreview.preview.pages[14]?.timeline[0]).toEqual({
      type: 'play',
      text: 'Passage 1'
    })
    expect(choicePreview.preview.pages[15]?.timeline[0]).toEqual({
      type: 'play',
      text: '\nQuestion: Stem 11'
    })
    expect(choicePreview.preview.pages[25]?.timeline[0]).toEqual({
      type: 'play',
      text: 'Long conversation'
    })
    expect(choicePreview.preview.choiceMeta?.questions.map(({ stem }) => stem)).toEqual(
      Array.from({ length: 20 }, (_value, index) => String(index + 1))
    )

    for (const summary of templateSummaries) {
      const release = await application.builtinTemplates.get(summary.templateId)
      if (!release) throw new Error(`Builtin template was not initialized: ${summary.templateId}`)
      const bindings = release.document.content.interfaces.map((requirement) => {
        const manifest = interfaceManifests.get(requirement.interfaceId)
        if (!manifest) throw new Error(`Missing Interface ${requirement.interfaceId}`)
        let located = locatedByInterface.get(requirement.interfaceId)
        if (!located) {
          located = createLocatedInstance(manifest, locatedByInterface.size)
          locatedByInterface.set(requirement.interfaceId, located)
          locatedByInstance.set(located.instance.instanceId, located)
        }
        return {
          alias: requirement.alias,
          interfaceId: requirement.interfaceId,
          instanceId: located.instance.instanceId
        }
      })

      await expect(application.builtinTemplates.validate(summary.templateId)).resolves.toEqual({
        valid: true,
        errors: []
      })
      const preview = await application.builtinTemplates.preview(summary.templateId, bindings)
      if (!preview.success) {
        throw new Error(
          `Builtin template preview failed (${summary.name}): ${JSON.stringify(preview.errors)}`
        )
      }
      expect(preview.preview.pages.length).toBeGreaterThan(0)
      if (summary.name.startsWith('上海高考英语听力')) {
        expect(preview.preview.recordingIndices).toEqual([])
      } else {
        expect(preview.preview.recordingIndices.length).toBeGreaterThan(0)
      }

      const compiled = await application.builtinTemplates.compile(summary.templateId, bindings, {
        synthesizeSpeech: async () => ({
          data: new Uint8Array([1, 2, 3]),
          mediaType: 'audio/wav'
        })
      })
      if (!compiled.success) {
        throw new Error(
          `Builtin template compilation failed (${summary.name}): ${JSON.stringify(compiled.errors)}`
        )
      }
      expect(compiled.examPackage.examData.player.pages.length).toBeGreaterThan(0)
      if (summary.name.startsWith('上海高考英语听力')) {
        expect(compiled.examPackage.examData.player.recordingIndices).toEqual([])
      } else {
        expect(compiled.examPackage.examData.player.recordingIndices.length).toBeGreaterThan(0)
      }
      expect(compiled.examPackage.submissionTemplate.schemaUses.length).toBeGreaterThan(0)
      expect(compiled.resourceSources.length).toBeGreaterThan(0)

      const resources = Object.fromEntries(
        compiled.resourceSources.map((source) => [
          source.assetKey,
          'data' in source ? source.data : IMAGE_BYTES
        ])
      )
      const decoded = await decodeExamPackage(
        await encodeExamPackage(compiled.examPackage, resources)
      )
      expect(decoded.exam.examData.title).toBe(summary.name)
      expect(decoded.exam.examData.player.pages.length).toBe(
        compiled.examPackage.examData.player.pages.length
      )
      expect(Object.keys(decoded.resources).sort()).toEqual(Object.keys(resources).sort())
    }
  })
})

function createLocatedInstance(
  manifest: InterfaceVarManifest,
  index: number
): {
  interfaceId: string
  instance: InterfaceInstance
  assetUrls: Record<string, string>
} {
  const values: Record<string, string> = {}
  const assetUrls: Record<string, string> = {}
  for (const variable of manifest.vars) {
    if (variable.type === 'image') {
      const filename = `${variable.varName.replaceAll('.', '-')}.png`
      values[variable.varName] = filename
      assetUrls[filename] = `memory://builtin-interface/${filename}`
    } else {
      values[variable.varName] = variable.example.trim() || `Example ${variable.varName}`
    }
  }
  return {
    interfaceId: manifest.interfaceId,
    instance: {
      instanceId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      name: 'Builtin content contract fixture',
      generatedAt: '2026-08-17T00:00:00.000Z',
      values
    },
    assetUrls
  }
}

async function readJson(filename: string): Promise<unknown> {
  return JSON.parse(await readFile(filename, 'utf8')) as unknown
}

class MemoryStore implements InterfaceStore, SchemaStore, TemplateStore {
  constructor(
    private readonly texts = new Map<string, unknown>(),
    private readonly assets = new Map<string, Uint8Array>(),
    private readonly segments: readonly string[] = []
  ) {}

  scope(name: string): MemoryStore {
    return new MemoryStore(this.texts, this.assets, [...this.segments, name])
  }

  async readText<T>(filename: string): Promise<T | null> {
    const value = this.texts.get(this.key(filename))
    return value === undefined ? null : (structuredClone(value) as T)
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.texts.set(this.key(filename), structuredClone(data))
  }

  async compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean> {
    const key = this.key(filename)
    const current = this.texts.has(key) ? this.texts.get(key) : null
    if (JSON.stringify(current) !== JSON.stringify(expected)) return false
    this.texts.set(key, structuredClone(data))
    return true
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = this.assets.get(this.key(filename))
    return value ? new Uint8Array(value) : null
  }

  async writeAsset(filename: string, data: Uint8Array): Promise<void> {
    this.assets.set(this.key(filename), new Uint8Array(data))
  }

  async listAssets(): Promise<string[]> {
    return this.directChildren(this.assets.keys())
  }

  getAssetUrl(filename: string): string {
    return `memory://${this.key(filename)}`
  }

  async listScopes(): Promise<string[]> {
    const keys = [...this.texts.keys(), ...this.assets.keys()]
    const prefix = this.prefix()
    const scopes = new Set<string>()
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const remainder = key.slice(prefix.length)
      if (remainder.includes('/')) scopes.add(remainder.split('/')[0])
    }
    return [...scopes].sort()
  }

  async clear(): Promise<void> {
    const prefix = this.prefix()
    for (const key of this.texts.keys()) if (key.startsWith(prefix)) this.texts.delete(key)
    for (const key of this.assets.keys()) if (key.startsWith(prefix)) this.assets.delete(key)
  }

  private directChildren(keys: IterableIterator<string>): string[] {
    const prefix = this.prefix()
    return [...keys]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter((key) => key.length > 0 && !key.includes('/'))
      .sort()
  }

  private key(filename: string): string {
    return [...this.segments, filename].join('/')
  }

  private prefix(): string {
    const scope = this.segments.join('/')
    return scope ? `${scope}/` : ''
  }
}

class DiskReadonlyStore implements ReadonlyInterfaceStore {
  constructor(private readonly directory: string) {}

  scope(name: string): DiskReadonlyStore {
    return new DiskReadonlyStore(path.join(this.directory, name))
  }

  async readText<T>(filename: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(path.join(this.directory, '.text', filename), 'utf8')) as T
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async listScopes(): Promise<string[]> {
    try {
      const entries = await readdir(this.directory, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => name)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }
}
