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
const INSTANCE_ID = '10000000-0000-4000-8000-000000000001'
const IMAGE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('builtin content contract', () => {
  it('loads the shipped catalogs and compiles the builtin template into a valid exam archive', async () => {
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
    let locatedInstance: ReturnType<typeof createLocatedInstance> | null = null
    const application = createTemplateApplication({
      repository: templateRepository,
      getBuiltinFunctionLibraryManifest: async () => functionLibraryManifest,
      getBuiltinTemplateManifest: async () => templateManifest,
      listInterfaceManifests: async () => [...interfaceManifests.values()],
      getInterfaceManifest: async (interfaceId) => interfaceManifests.get(interfaceId) ?? null,
      getSchema: (schemaId) => schemaRepository.getSchema(schemaId),
      locateInterfaceInstance: async (instanceId) =>
        locatedInstance?.instance.instanceId === instanceId ? locatedInstance : null
    })

    await application.initialize()

    expect(bundledInterfaces.map(({ builtinKey }) => builtinKey)).toEqual([
      'shanghai-gaokao-listening',
      'shanghai-gaokao-speaking',
      'shanghai-zhongkao-speaking'
    ])
    await expect(application.browser.listBuiltinTemplates()).resolves.toEqual([
      expect.objectContaining({
        templateId: TEMPLATE_ID,
        name: '上海高考口语标准题型',
        available: true,
        errors: []
      })
    ])
    expect(await application.browser.listFunctionLibraries()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ libraryId: 'builtin:shanghai-gaokao-basic' }),
        expect.objectContaining({ libraryId: 'builtin:shanghai-gaokao-groups' })
      ])
    )

    const release = await application.builtinTemplates.get(TEMPLATE_ID)
    expect(release).not.toBeNull()
    if (!release) throw new Error('Builtin template was not initialized')
    expect(release.document.content.interfaces).toHaveLength(1)
    const requirement = release.document.content.interfaces[0]
    const interfaceManifest = interfaceManifests.get(requirement.interfaceId)
    expect(interfaceManifest).toBeDefined()
    if (!interfaceManifest) throw new Error(`Missing Interface ${requirement.interfaceId}`)
    locatedInstance = createLocatedInstance(interfaceManifest)
    const bindings = [
      {
        alias: requirement.alias,
        interfaceId: requirement.interfaceId,
        instanceId: locatedInstance.instance.instanceId
      }
    ]

    await expect(application.builtinTemplates.validate(TEMPLATE_ID)).resolves.toEqual({
      valid: true,
      errors: []
    })
    const preview = await application.builtinTemplates.preview(TEMPLATE_ID, bindings)
    if (!preview.success) {
      throw new Error(`Builtin template preview failed: ${JSON.stringify(preview.errors)}`)
    }
    expect(preview.preview.pages.length).toBeGreaterThan(0)
    expect(preview.preview.recordingIndices.length).toBeGreaterThan(0)

    const compiled = await application.builtinTemplates.compile(TEMPLATE_ID, bindings, {
      synthesizeSpeech: async () => ({
        data: new Uint8Array([1, 2, 3]),
        mediaType: 'audio/wav'
      })
    })
    if (!compiled.success) {
      throw new Error(`Builtin template compilation failed: ${JSON.stringify(compiled.errors)}`)
    }
    expect(compiled.examPackage.examData.player.pages.length).toBeGreaterThan(0)
    expect(compiled.examPackage.examData.player.recordingIndices.length).toBeGreaterThan(0)
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
    expect(decoded.exam.examData.title).toBe('上海高考口语标准题型')
    expect(decoded.exam.examData.player.pages.length).toBe(
      compiled.examPackage.examData.player.pages.length
    )
    expect(Object.keys(decoded.resources).sort()).toEqual(Object.keys(resources).sort())
  })
})

function createLocatedInstance(manifest: InterfaceVarManifest): {
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
      instanceId: INSTANCE_ID,
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
