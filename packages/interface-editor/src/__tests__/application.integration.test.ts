import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createInterfaceApplication,
  type InterfaceImageGenerator,
  type InterfaceTextGenerator,
  type InterfaceTextGenerationChunk,
  type InterfaceTextModelSelection
} from '../index'
import { createBuiltinInterfaceApplication } from '../builtin-entry'
import { createInterfaceDraft, publishInterface } from '../id'
import { FileInterfaceRepository, type InterfaceStore } from '../repository'
import type { InterfaceFileDialog } from '../fileExchange'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

const content = {
  name: '听说综合题',
  description: '用于集成测试的题型',
  promptTemplate: '请生成一套听说练习',
  fields: {
    order: ['title', 'section'],
    nodes: {
      title: {
        type: 'text' as const,
        varName: 'titleText',
        description: '题目标题',
        example: '校园生活'
      },
      section: {
        type: 'group' as const,
        children: {
          order: ['picture', 'answer'],
          nodes: {
            picture: {
              type: 'image' as const,
              varName: 'questionImage',
              description: '题目配图',
              example: '学生在校园里活动'
            },
            answer: {
              type: 'text' as const,
              varName: 'answerText',
              description: '参考回答',
              example: 'I enjoy school life.'
            }
          }
        }
      }
    }
  }
}

describe('interface editor application integration', () => {
  afterEach(() => vi.restoreAllMocks())

  it('runs the draft, publish, definition and instance workflow through the public facade', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })

    const draft = await app.drafts.create(content)
    expect((await app.browser.listDrafts()).map(({ draftId }) => draftId)).toEqual([draft.draftId])

    const published = await app.drafts.publish(draft.draftId)
    expect(published.status).toBe('published')
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    expect(interfaceId).toMatch(/^sha256:[0-9a-f]{64}$/)
    await expect(app.drafts.publish(draft.draftId)).resolves.toMatchObject({
      status: 'already-published',
      interface: { interfaceId }
    })

    await expect(app.browser.listPublished()).resolves.toEqual([
      expect.objectContaining({ interfaceId, name: content.name, instanceCount: 0 })
    ])
    await expect(app.published.get(interfaceId)).resolves.toMatchObject({
      definition: { id: interfaceId, fields: content.fields },
      source: { type: 'published' }
    })
    await expect(app.published.getVarManifest(interfaceId)).resolves.toMatchObject({
      interfaceId,
      vars: [
        expect.objectContaining({ varName: 'titleText', path: 'title' }),
        expect.objectContaining({
          varName: 'questionImage',
          type: 'image',
          path: 'section.picture'
        }),
        expect.objectContaining({ varName: 'answerText', path: 'section.answer' })
      ]
    })
    const prompts = await app.published.getPrompts(interfaceId)
    expect(prompts.prompt).toBe(content.promptTemplate)
    expect(prompts.fullPrompt).toContain('学生在校园里活动')
    expect(JSON.parse(prompts.jsonExample)).toEqual({
      title: '校园生活',
      section: { picture: '学生在校园里活动', answer: 'I enjoy school life.' }
    })

    const instance = await app.published.createBlankInstance(interfaceId)
    expect(instance.instance.values).toEqual({ titleText: '', questionImage: '', answerText: '' })
    const saved = await app.instances.save(interfaceId, instance.instance.instanceId, {
      name: '第一套题组',
      values: { titleText: '校园生活', questionImage: '', answerText: 'I like school.' },
      imagePrompts: { questionImage: '学生在校园里活动' },
      imageFiles: { questionImage: PNG }
    })
    const filename = saved.instance.values.questionImage
    expect(filename).toMatch(/^questionImage-[0-9a-f-]{36}\.png$/)
    expect(saved.assetUrls[filename]).toContain(filename)
    await expect(app.instances.locate(instance.instance.instanceId)).resolves.toEqual({
      interfaceId,
      instance: saved.instance
    })
    await expect(app.instances.locate('10000000-0000-4000-8000-000000000001')).resolves.toBeNull()
    await expect(
      repository.readInstanceAsset(interfaceId, instance.instance.instanceId, filename)
    ).resolves.toEqual(PNG)

    const invalid = await app.instances.replaceFromJson(
      interfaceId,
      instance.instance.instanceId,
      '{"title":"缺少 section"}'
    )
    expect(invalid.status).toBe('invalid-json')
    const replaced = await app.instances.replaceFromJson(
      interfaceId,
      instance.instance.instanceId,
      '{"title":"新标题","section":{"picture":"新的配图提示词","answer":"New answer"}}'
    )
    expect(replaced).toMatchObject({
      status: 'replaced',
      instance: {
        instance: {
          name: '第一套题组',
          values: { titleText: '新标题', questionImage: filename, answerText: 'New answer' },
          imagePrompts: { questionImage: '新的配图提示词' }
        }
      }
    })
    await expect(app.published.listInstances(interfaceId)).resolves.toHaveLength(1)

    const copied = await app.published.copyToDraft(interfaceId)
    expect(copied.draftId).not.toBe(draft.draftId)
    expect(copied.fields).toEqual(content.fields)
    await app.instances.delete(interfaceId, instance.instance.instanceId)
    await expect(app.published.listInstances(interfaceId)).resolves.toEqual([])
    await app.drafts.delete(copied.draftId)
    await expect(app.drafts.get(copied.draftId)).resolves.toBeNull()
  })

  it('streams AI output, validates it, generates images, and persists one atomic result', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const textGenerator = new ScriptedTextGenerator(
      '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
    )
    const imageGenerator: InterfaceImageGenerator = {
      listProviders: vi
        .fn()
        .mockResolvedValue([
          { providerId: 'image-provider', providerName: '测试生图', modelId: 'image-model' }
        ]),
      generate: vi.fn().mockResolvedValue({ data: PNG })
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator,
      imageGenerator
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const instance = await app.published.createBlankInstance(interfaceId)
    const model: InterfaceTextModelSelection = {
      providerId: 'text-provider',
      modelId: 'text-model'
    }

    await expect(app.instances.listAIGenerationModels()).resolves.toEqual([
      { providerId: 'text-provider', modelId: 'text-model', providerName: '测试文本' }
    ])
    await expect(app.instances.listImageGenerationProviders()).resolves.toEqual([
      { providerId: 'image-provider', providerName: '测试生图', modelId: 'image-model' }
    ])
    const handle = await app.instances.startAIGeneration(
      interfaceId,
      instance.instance.instanceId,
      {
        model,
        imageProvider: { providerId: 'image-provider', modelId: 'image-model' }
      }
    )
    const result = await handle.completion
    expect(result.status).toBe('completed')
    expect(textGenerator.lastModel).toEqual(model)
    expect(textGenerator.lastPrompt).toContain(content.promptTemplate)
    expect(imageGenerator.generate).toHaveBeenCalledWith('AI 配图', {
      signal: expect.any(AbortSignal),
      provider: { providerId: 'image-provider', modelId: 'image-model' }
    })
    expect(handle.getSnapshot().items.map(({ label, status }) => ({ label, status }))).toEqual([
      { label: 'AI 生成', status: 'completed' },
      { label: '校验生成结果', status: 'completed' },
      { label: '生成图片：questionImage', status: 'completed' },
      { label: '保存实例', status: 'completed' }
    ])
    const details = await app.instances.get(interfaceId, instance.instance.instanceId)
    expect(details?.instance.values.titleText).toBe('AI 标题')
    expect(details?.instance.values.answerText).toBe('AI answer')
    expect(details?.instance.imagePrompts).toEqual({ questionImage: 'AI 配图' })
    const filename = details?.instance.values.questionImage ?? ''
    expect(
      await repository.readInstanceAsset(interfaceId, instance.instance.instanceId, filename)
    ).toEqual(PNG)

    const generated = await app.instances.generateImage('独立图片', {
      provider: { providerId: 'image-provider' }
    })
    expect(generated).toEqual(PNG)
  })

  it('keeps the current instance unchanged after an invalid AI response and releases its lock', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator: new ScriptedTextGenerator('{"title":"缺少 section"}')
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const blank = await app.published.createBlankInstance(interfaceId)
    const before = await app.instances.save(interfaceId, blank.instance.instanceId, {
      name: '原题组',
      values: { titleText: '原标题', questionImage: '', answerText: 'Original answer' }
    })

    const handle = await app.instances.startAIGeneration(interfaceId, blank.instance.instanceId)

    await expect(handle.completion).resolves.toMatchObject({ status: 'invalid-response' })
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(before)
    expect(handle.getSnapshot().items.at(-1)).toMatchObject({ id: 'save', status: 'waiting' })
    await expect(
      app.instances.save(interfaceId, blank.instance.instanceId, {
        name: '锁已释放',
        values: before.instance.values
      })
    ).resolves.toMatchObject({ instance: { name: '锁已释放' } })
  })

  it('cancels during image generation without replacing values or assets', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    let imageStarted!: () => void
    const started = new Promise<void>((resolve) => {
      imageStarted = resolve
    })
    const imageGenerator: InterfaceImageGenerator = {
      async generate(_prompt, { signal }) {
        imageStarted()
        return new Promise((_, reject) => {
          const abort = (): void => reject(new DOMException('Aborted', 'AbortError'))
          if (signal.aborted) abort()
          else signal.addEventListener('abort', abort, { once: true })
        })
      }
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator: new ScriptedTextGenerator(
        '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
      ),
      imageGenerator
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const blank = await app.published.createBlankInstance(interfaceId)
    const before = await app.instances.save(interfaceId, blank.instance.instanceId, {
      name: '原题组',
      values: { titleText: '原标题', questionImage: '', answerText: 'Original answer' },
      imagePrompts: { questionImage: '原提示词' },
      imageFiles: { questionImage: PNG }
    })
    const oldFilename = before.instance.values.questionImage

    const handle = await app.instances.startAIGeneration(interfaceId, blank.instance.instanceId)
    await started
    handle.cancel()

    await expect(handle.completion).resolves.toEqual({ status: 'cancelled' })
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(before)
    await expect(
      repository.readInstanceAsset(interfaceId, blank.instance.instanceId, oldFilename)
    ).resolves.toEqual(PNG)
    await expect(
      app.instances.save(interfaceId, blank.instance.instanceId, {
        name: '锁已释放',
        values: before.instance.values,
        imagePrompts: before.instance.imagePrompts
      })
    ).resolves.toMatchObject({ instance: { name: '锁已释放' } })
  })

  it('does not persist generated data when the final repository update fails', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator: new ScriptedTextGenerator(
        '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
      ),
      imageGenerator: { generate: vi.fn().mockResolvedValue({ data: PNG }) }
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const blank = await app.published.createBlankInstance(interfaceId)
    const before = await app.instances.save(interfaceId, blank.instance.instanceId, {
      name: '原题组',
      values: { titleText: '原标题', questionImage: '', answerText: 'Original answer' }
    })
    vi.spyOn(repository, 'updateInstance').mockRejectedValueOnce(
      new Error('simulated write failure')
    )

    const handle = await app.instances.startAIGeneration(interfaceId, blank.instance.instanceId)

    await expect(handle.completion).resolves.toEqual({
      status: 'failed',
      message: 'simulated write failure'
    })
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(before)
    await expect(
      app.instances.save(interfaceId, blank.instance.instanceId, {
        name: '锁已释放',
        values: before.instance.values
      })
    ).resolves.toMatchObject({ instance: { name: '锁已释放' } })
  })

  it('exports an app package and imports a selected instance into another app', async () => {
    const sourceDialog = new TestFileDialog()
    const sourceRepository = new FileInterfaceRepository(new MemoryStore())
    const source = createInterfaceApplication({
      repository: sourceRepository,
      fileDialog: sourceDialog
    })
    const draft = await source.drafts.create(content)
    const published = await source.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const first = await source.published.createBlankInstance(interfaceId)
    const second = await source.published.createBlankInstance(interfaceId)
    await source.instances.save(interfaceId, first.instance.instanceId, {
      name: '导出图片题组',
      values: { titleText: '导出', questionImage: '', answerText: 'A' },
      imagePrompts: { questionImage: '导出图片' },
      imageFiles: { questionImage: PNG }
    })
    await source.instances.save(interfaceId, second.instance.instanceId, {
      name: '未选择题组',
      values: second.instance.values
    })

    await expect(source.transfer.export(interfaceId, { mode: 'all' })).resolves.toEqual({
      status: 'exported'
    })
    expect(sourceDialog.writtenData).toBeInstanceOf(Uint8Array)
    expect(sourceDialog.writeOptions).toMatchObject({ defaultName: '听说综合题.lsinterface' })

    const targetDialog = new TestFileDialog(sourceDialog.writtenData, '课堂题型.lsinterface')
    const targetRepository = new FileInterfaceRepository(new MemoryStore())
    const target = createInterfaceApplication({
      repository: targetRepository,
      fileDialog: targetDialog
    })
    const session = await target.transfer.beginImport()
    expect(session?.preview).toMatchObject({
      filename: '课堂题型.lsinterface',
      interface: { interfaceId, name: content.name },
      instances: expect.arrayContaining([
        expect.objectContaining({
          instanceId: first.instance.instanceId,
          assetFilenames: expect.any(Array)
        }),
        expect.objectContaining({ instanceId: second.instance.instanceId })
      ])
    })
    if (!session) throw new Error('expected an import session')
    await expect(
      session.commit({ mode: 'selected', instanceIds: [first.instance.instanceId] })
    ).resolves.toEqual({
      interfaceId,
      interfaceStatus: 'created',
      importedInstanceIds: [first.instance.instanceId],
      skippedInstanceIds: []
    })
    await expect(target.published.listInstances(interfaceId)).resolves.toEqual([
      expect.objectContaining({ instanceId: first.instance.instanceId, name: '导出图片题组' })
    ])
    const imported = await target.instances.get(interfaceId, first.instance.instanceId)
    const importedFilename = imported?.instance.values.questionImage ?? ''
    await expect(
      targetRepository.readInstanceAsset(interfaceId, first.instance.instanceId, importedFilename)
    ).resolves.toEqual(PNG)
    await expect(session.commit({ mode: 'all' })).rejects.toThrow('no longer active')
  })

  it('keeps invalid drafts and cancelled transfers explicit at the application boundary', async () => {
    const dialog = new TestFileDialog()
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: dialog })
    const invalid = await app.drafts.create()
    await expect(app.drafts.publish(invalid.draftId)).resolves.toMatchObject({ status: 'invalid' })
    expect((await app.browser.listPublished()).length).toBe(0)

    const defDraft = await app.drafts.create(content)
    const published = await app.drafts.publish(defDraft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    dialog.writeResult = false
    await expect(
      app.transfer.export(published.interface.interfaceId, { mode: 'none' })
    ).resolves.toEqual({ status: 'cancelled' })
    dialog.readData = null
    await expect(app.transfer.beginImport()).resolves.toBeNull()
  })

  it('cancels an import session without writing and rejects a later commit', async () => {
    const sourceDialog = new TestFileDialog()
    const source = createInterfaceApplication({
      repository: new FileInterfaceRepository(new MemoryStore()),
      fileDialog: sourceDialog
    })
    const draft = await source.drafts.create(content)
    const published = await source.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    await source.transfer.export(published.interface.interfaceId, { mode: 'none' })

    const target = createInterfaceApplication({
      repository: new FileInterfaceRepository(new MemoryStore()),
      fileDialog: new TestFileDialog(sourceDialog.writtenData)
    })
    const session = await target.transfer.beginImport()
    if (!session) throw new Error('expected an import session')

    session.cancel()

    await expect(session.commit({ mode: 'all' })).rejects.toThrow('no longer active')
    await expect(target.browser.listPublished()).resolves.toEqual([])
  })

  it('rejects a stale builtin update plan through the public builtin facade', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const references = { replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined) }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const previous = await publishInterface(createInterfaceDraft(content))
    const next = await publishInterface(
      createInterfaceDraft({ ...content, description: '下一版本说明' })
    )
    const intervening = await publishInterface(
      createInterfaceDraft({ ...content, description: '抢先发布的版本' })
    )
    await repository.saveBuiltinInterface('speaking', previous)
    await repository.setBuiltinCurrent('speaking', previous.id)
    const stalePlan = await builtins.check('speaking', next)
    await repository.saveBuiltinInterface('speaking', intervening)
    await repository.setBuiltinCurrent('speaking', intervening.id)

    await expect(builtins.apply(stalePlan)).rejects.toThrow('plan is stale')
    await expect(repository.getBuiltin('speaking')).resolves.toMatchObject({
      currentInterfaceId: intervening.id
    })
    expect(references.replaceInterfaceReferences).not.toHaveBeenCalled()
  })
})

interface MemoryData {
  texts: Map<string, unknown>
  assets: Map<string, Uint8Array>
  scopes: Set<string>
}

class MemoryStore implements InterfaceStore {
  private readonly data: MemoryData

  constructor(
    private readonly path: string[] = [],
    data?: MemoryData
  ) {
    this.data = data ?? { texts: new Map(), assets: new Map(), scopes: new Set() }
    if (this.path.length) this.data.scopes.add(this.key())
  }

  scope(name: string): InterfaceStore {
    return new MemoryStore([...this.path, name], this.data)
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (this.data.texts.get(this.fileKey(filename)) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, value: T): Promise<void> {
    this.ensureScope()
    this.data.texts.set(this.fileKey(filename), structuredClone(value))
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const value = this.data.assets.get(this.fileKey(filename))
    return value ? new Uint8Array(value) : null
  }

  async writeAsset(filename: string, value: Uint8Array): Promise<void> {
    this.ensureScope()
    this.data.assets.set(this.fileKey(filename), new Uint8Array(value))
  }

  async listAssets(): Promise<string[]> {
    return this.listFiles(this.data.assets)
  }

  getAssetUrl(filename: string): string {
    return `asset://integration/${[...this.path, filename].join('/')}`
  }

  async listScopes(): Promise<string[]> {
    const prefix = this.key()
    const depth = this.path.length + 1
    return [...this.data.scopes]
      .filter(
        (scope) => scope.startsWith(prefix ? `${prefix}/` : '') && scope.split('/').length === depth
      )
      .map((scope) => scope.split('/').at(-1) as string)
      .sort()
  }

  async clear(): Promise<void> {
    const prefix = this.key()
    for (const key of [...this.data.texts.keys()])
      if (isWithin(key, prefix)) this.data.texts.delete(key)
    for (const key of [...this.data.assets.keys()])
      if (isWithin(key, prefix)) this.data.assets.delete(key)
    for (const key of [...this.data.scopes]) if (isWithin(key, prefix)) this.data.scopes.delete(key)
  }

  private listFiles(map: Map<string, unknown>): string[] {
    const prefix = `${this.key()}::`
    return [...map.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort()
  }

  private ensureScope(): void {
    for (let i = 1; i <= this.path.length; i++)
      this.data.scopes.add(this.path.slice(0, i).join('/'))
  }

  private key(): string {
    return this.path.join('/')
  }

  private fileKey(filename: string): string {
    return `${this.key()}::${filename}`
  }
}

class TestFileDialog implements InterfaceFileDialog {
  writtenData: Uint8Array | null = null
  writeOptions: unknown
  writeResult = true

  constructor(
    public readData: Uint8Array | null = null,
    private readonly readName = 'interface.lsinterface'
  ) {}

  async readBinary(): Promise<{ name: string; data: Uint8Array } | null> {
    return this.readData ? { name: this.readName, data: this.readData } : null
  }

  async writeBinary(data: Uint8Array, options?: unknown): Promise<boolean> {
    this.writtenData = data
    this.writeOptions = options
    return this.writeResult
  }
}

class ScriptedTextGenerator implements InterfaceTextGenerator {
  readonly models = [
    { providerId: 'text-provider', modelId: 'text-model', providerName: '测试文本' }
  ]
  lastModel: InterfaceTextModelSelection | undefined
  lastPrompt = ''

  constructor(private readonly response: string) {}

  async listModels() {
    return this.models
  }

  async *generate(
    prompt: string,
    options: { signal: AbortSignal; model?: InterfaceTextModelSelection }
  ): AsyncIterable<InterfaceTextGenerationChunk> {
    this.lastPrompt = prompt
    this.lastModel = options.model
    if (options.signal.aborted) return
    yield { type: 'reasoning', delta: '正在生成' }
    yield { type: 'output', delta: this.response }
  }
}

function isWithin(value: string, scope: string): boolean {
  return value === scope || value.startsWith(`${scope}/`) || value.startsWith(`${scope}::`)
}
