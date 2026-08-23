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
import { decodeInterfaceZip, encodeInterfaceZip } from '../zip'

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
    const imageGenerator: InterfaceImageGenerator = {
      generate: vi.fn().mockResolvedValue({ data: PNG })
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      imageGenerator
    })

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
          varName: 'questionImage.inst',
          type: 'text',
          path: 'section.picture'
        }),
        expect.objectContaining({
          varName: 'questionImage.img',
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

    const instance = await app.published.createBlankInstance(interfaceId, '  第一套题组  ')
    expect(instance.instance.name).toBe('第一套题组')
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
    await expect(app.instances.locate(instance.instance.instanceId)).resolves.toMatchObject({
      interfaceId,
      instance: {
        values: {
          titleText: '校园生活',
          'questionImage.inst': '学生在校园里活动',
          'questionImage.img': filename,
          answerText: 'I like school.'
        }
      },
      assetUrls: saved.assetUrls
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
    vi.mocked(imageGenerator.generate).mockClear()
    await expect(
      app.instances.replaceFromJson(
        interfaceId,
        instance.instance.instanceId,
        '{"title":"","section":{"picture":"不应生成的配图","answer":"New answer"}}'
      )
    ).rejects.toThrow('变量 titleText 不能为空')
    expect(imageGenerator.generate).not.toHaveBeenCalled()
    const replaced = await app.instances.replaceFromJson(
      interfaceId,
      instance.instance.instanceId,
      '{"title":"新标题","section":{"picture":"新的配图提示词","answer":"New answer"}}',
      { imageProvider: { providerId: 'json-image-provider', modelId: 'json-image-model' } }
    )
    expect(imageGenerator.generate).toHaveBeenCalledWith('新的配图提示词', {
      signal: expect.any(AbortSignal),
      provider: { providerId: 'json-image-provider', modelId: 'json-image-model' }
    })
    expect(replaced).toMatchObject({
      status: 'replaced',
      instance: {
        instance: {
          name: '第一套题组',
          values: {
            titleText: '新标题',
            questionImage: expect.stringMatching(/^questionImage-[0-9a-f-]{36}\.png$/),
            answerText: 'New answer'
          },
          imagePrompts: { questionImage: '新的配图提示词' }
        }
      }
    })
    if (replaced.status === 'replaced') {
      expect(replaced.instance.instance.values.questionImage).not.toBe(filename)
      await expect(
        repository.readInstanceAsset(interfaceId, instance.instance.instanceId, filename)
      ).resolves.toBeNull()
    }
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
      values: { titleText: '原标题', questionImage: '', answerText: 'Original answer' },
      imagePrompts: { questionImage: '原提示词' },
      imageFiles: { questionImage: PNG }
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

  it('does not save an AI result with an empty text variable', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const imageGenerator: InterfaceImageGenerator = {
      generate: vi.fn().mockResolvedValue({ data: PNG })
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator: new ScriptedTextGenerator(
        '{"title":"","section":{"picture":"AI 配图","answer":"AI answer"}}'
      ),
      imageGenerator
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const blank = await app.published.createBlankInstance(interfaceId)

    const handle = await app.instances.startAIGeneration(interfaceId, blank.instance.instanceId)

    await expect(handle.completion).resolves.toMatchObject({
      status: 'failed',
      message: '变量 titleText 不能为空'
    })
    expect(imageGenerator.generate).not.toHaveBeenCalled()
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(blank)
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

  it('does not validate or save when a cancelled text stream ends normally', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    let outputConsumed!: () => void
    const consumed = new Promise<void>((resolve) => {
      outputConsumed = resolve
    })
    const textGenerator: InterfaceTextGenerator = {
      async *generate(_prompt, { signal }) {
        yield {
          type: 'output',
          delta: '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
        }
        outputConsumed()
        await new Promise<void>((resolve) => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
      }
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator,
      imageGenerator: { generate: vi.fn().mockResolvedValue({ data: PNG }) }
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const blank = await app.published.createBlankInstance(published.interface.interfaceId)
    const update = vi.spyOn(repository, 'updateInstance')

    const handle = await app.instances.startAIGeneration(
      published.interface.interfaceId,
      blank.instance.instanceId
    )
    await consumed
    handle.cancel()

    await expect(handle.completion).resolves.toEqual({ status: 'cancelled' })
    expect(update).not.toHaveBeenCalled()
    await expect(
      app.instances.get(published.interface.interfaceId, blank.instance.instanceId)
    ).resolves.toEqual(blank)
  })

  it('does not save when an image generator returns after cancellation', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    let imageStarted!: () => void
    let finishImage!: (value: { data: Uint8Array }) => void
    const started = new Promise<void>((resolve) => {
      imageStarted = resolve
    })
    const imageResult = new Promise<{ data: Uint8Array }>((resolve) => {
      finishImage = resolve
    })
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator: new ScriptedTextGenerator(
        '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
      ),
      imageGenerator: {
        async generate() {
          imageStarted()
          return imageResult
        }
      }
    })
    const draft = await app.drafts.create(content)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const blank = await app.published.createBlankInstance(published.interface.interfaceId)
    const update = vi.spyOn(repository, 'updateInstance')

    const handle = await app.instances.startAIGeneration(
      published.interface.interfaceId,
      blank.instance.instanceId
    )
    await started
    handle.cancel()
    finishImage({ data: PNG })

    await expect(handle.completion).resolves.toEqual({ status: 'cancelled' })
    expect(update).not.toHaveBeenCalled()
    await expect(
      app.instances.get(published.interface.interfaceId, blank.instance.instanceId)
    ).resolves.toEqual(blank)
  })

  it('retries from the failed image without regenerating text or completed images', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const twoImageContent = {
      ...content,
      fields: {
        order: ['first', 'second'],
        nodes: {
          first: {
            type: 'image' as const,
            varName: 'firstImage',
            description: '第一张图片',
            example: '第一张示例图'
          },
          second: {
            type: 'image' as const,
            varName: 'secondImage',
            description: '第二张图片',
            example: '第二张示例图'
          }
        }
      }
    }
    const textGenerator = new ScriptedTextGenerator(
      '{"first":"第一张提示词","second":"第二张提示词"}'
    )
    let secondAttempts = 0
    const imageGenerator: InterfaceImageGenerator = {
      generate: vi.fn().mockImplementation(async (prompt: string) => {
        if (prompt === '第二张提示词' && ++secondAttempts === 1) {
          throw new Error('第二张图片生成失败')
        }
        return { data: PNG }
      })
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(),
      textGenerator,
      imageGenerator
    })
    const draft = await app.drafts.create(twoImageContent)
    const published = await app.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected a valid draft')
    const interfaceId = published.interface.interfaceId
    const blank = await app.published.createBlankInstance(interfaceId)

    const failedHandle = await app.instances.startAIGeneration(
      interfaceId,
      blank.instance.instanceId
    )
    await expect(failedHandle.completion).resolves.toEqual({
      status: 'failed',
      message: '第二张图片生成失败'
    })
    expect(failedHandle.getSnapshot().items.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
      'completed',
      'failed',
      'waiting'
    ])
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(blank)

    vi.spyOn(repository, 'getInstance').mockRejectedValueOnce(new Error('temporary read failure'))
    await expect(failedHandle.retry()).rejects.toThrow('temporary read failure')

    const retryHandle = await failedHandle.retry()
    await expect(retryHandle.completion).resolves.toMatchObject({ status: 'completed' })
    expect(textGenerator.generateCalls).toBe(1)
    expect(imageGenerator.generate).toHaveBeenCalledTimes(3)
    expect(imageGenerator.generate).toHaveBeenNthCalledWith(1, '第一张提示词', {
      signal: expect.any(AbortSignal)
    })
    expect(imageGenerator.generate).toHaveBeenNthCalledWith(2, '第二张提示词', {
      signal: expect.any(AbortSignal)
    })
    expect(imageGenerator.generate).toHaveBeenNthCalledWith(3, '第二张提示词', {
      signal: expect.any(AbortSignal)
    })
    expect(retryHandle.getSnapshot().items.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed'
    ])
    const saved = await app.instances.get(interfaceId, blank.instance.instanceId)
    expect(saved?.instance.imagePrompts).toEqual({
      firstImage: '第一张提示词',
      secondImage: '第二张提示词'
    })
    expect(Object.keys(saved?.assetUrls ?? {})).toEqual([
      saved?.instance.values.firstImage,
      saved?.instance.values.secondImage
    ])
  })

  it('retries only the final save after an atomic repository write fails', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const textGenerator = new ScriptedTextGenerator(
      '{"title":"AI 标题","section":{"picture":"AI 配图","answer":"AI answer"}}'
    )
    const imageGenerator: InterfaceImageGenerator = {
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
    const blank = await app.published.createBlankInstance(interfaceId)
    const before = await app.instances.save(interfaceId, blank.instance.instanceId, {
      name: '原题组',
      values: { titleText: '原标题', questionImage: '', answerText: 'Original answer' },
      imagePrompts: { questionImage: '原提示词' },
      imageFiles: { questionImage: PNG }
    })
    vi.spyOn(repository, 'updateInstance').mockRejectedValueOnce(
      new Error('simulated write failure')
    )

    const failedHandle = await app.instances.startAIGeneration(
      interfaceId,
      blank.instance.instanceId
    )

    await expect(failedHandle.completion).resolves.toEqual({
      status: 'failed',
      message: 'simulated write failure'
    })
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toEqual(before)

    const retryHandle = await failedHandle.retry()
    await expect(retryHandle.completion).resolves.toMatchObject({ status: 'completed' })
    expect(textGenerator.generateCalls).toBe(1)
    expect(imageGenerator.generate).toHaveBeenCalledOnce()
    await expect(app.instances.get(interfaceId, blank.instance.instanceId)).resolves.toMatchObject({
      instance: {
        name: '原题组',
        values: { titleText: 'AI 标题', answerText: 'AI answer' },
        imagePrompts: { questionImage: 'AI 配图' }
      }
    })
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
      values: second.instance.values,
      imagePrompts: { questionImage: '未选择图片' },
      imageFiles: { questionImage: PNG }
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

  it('未知 builtinKey 在导入预览和提交时都拒绝', async () => {
    const sourceRepository = new FileInterfaceRepository(new MemoryStore())
    const sourceDialog = new TestFileDialog()
    const source = createInterfaceApplication({
      repository: sourceRepository,
      fileDialog: sourceDialog
    })
    const definition = await publishInterface(createInterfaceDraft(content))
    await sourceRepository.saveBuiltinInterface('known-builtin', definition)
    await sourceRepository.setBuiltinCurrent('known-builtin', definition.id)
    await source.transfer.export(definition.id, { mode: 'none' })
    const packageValue = await decodeInterfaceZip(sourceDialog.writtenData as Uint8Array)
    packageValue.builtin = { builtinKey: 'removed-builtin', interfaceId: packageValue.interface.id }

    const target = createInterfaceApplication({
      repository: new FileInterfaceRepository(new MemoryStore()),
      fileDialog: new TestFileDialog(await encodeInterfaceZip(packageValue))
    })
    const session = await target.transfer.beginImport()
    if (!session) throw new Error('expected an import session')
    expect(session.preview.builtin?.builtinKey).toBe('removed-builtin')
    await expect(session.commit({ mode: 'all' })).rejects.toThrow('不认识这个内置题型')
    await expect(target.browser.listPublished()).resolves.toEqual([])
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
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
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

  it('installs a new builtin Interface through the public facade', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const builtins = createBuiltinInterfaceApplication({
      repository,
      references: {
        replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
        countInterfaceReferences: vi.fn().mockResolvedValue(0)
      }
    })
    const def = await publishInterface(content)

    const plan = await builtins.check('speaking', def)
    expect(plan).toMatchObject({
      builtinKey: 'speaking',
      previous: null,
      next: def,
      kind: 'automatic'
    })

    await expect(builtins.apply(plan)).resolves.toMatchObject({
      kind: 'automatic',
      previousInterfaceId: null,
      currentInterfaceId: def.id,
      migratedInstanceIds: [],
      backedUpPrevious: false
    })
    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: def.id
    })
    await expect(repository.listPublishedInterfaceIds()).resolves.toEqual([])
  })

  it('migrates builtin instances and references through the public facade', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const previous = await publishInterface(content)
    const next = await publishInterface({
      ...content,
      name: '听说综合题新版',
      fields: {
        order: ['section'],
        nodes: {
          section: {
            type: 'group',
            children: structuredClone(content.fields)
          }
        }
      }
    })
    await repository.saveBuiltinInterface('speaking', previous)
    await repository.setBuiltinCurrent('speaking', previous.id)
    const blank = await app.published.createBlankInstance(previous.id)
    const saved = await app.instances.save(previous.id, blank.instance.instanceId, {
      name: '待迁移题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '原始提示词' },
      imageFiles: { questionImage: PNG }
    })

    const plan = await builtins.check('speaking', next)
    expect(plan.kind).toBe('manual')

    await expect(builtins.apply(plan, 'migrate')).resolves.toMatchObject({
      kind: 'manual',
      previousInterfaceId: previous.id,
      currentInterfaceId: next.id,
      migratedInstanceIds: [blank.instance.instanceId],
      backedUpPrevious: false
    })
    expect(references.replaceInterfaceReferences).toHaveBeenCalledWith(previous.id, next.id)
    await expect(repository.getInterface(previous.id)).resolves.toBeNull()
    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: next.id
    })
    await expect(app.instances.get(next.id, blank.instance.instanceId)).resolves.toMatchObject({
      interfaceId: next.id,
      instance: {
        instanceId: blank.instance.instanceId,
        name: '待迁移题组',
        values: saved.instance.values,
        imagePrompts: { questionImage: '原始提示词' }
      }
    })
    const migrated = await app.instances.get(next.id, blank.instance.instanceId)
    const filename = migrated?.instance.values.questionImage ?? ''
    await expect(
      repository.readInstanceAsset(next.id, blank.instance.instanceId, filename)
    ).resolves.toEqual(PNG)
  })

  it('rolls back builtin instance migration when reference replacement fails', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const references = {
      replaceInterfaceReferences: vi.fn().mockRejectedValue(new Error('reference write failed')),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const previous = await publishInterface(content)
    const next = await publishInterface({
      ...content,
      fields: {
        order: ['section'],
        nodes: {
          section: {
            type: 'group',
            children: structuredClone(content.fields)
          }
        }
      }
    })
    await repository.saveBuiltinInterface('speaking', previous)
    await repository.setBuiltinCurrent('speaking', previous.id)
    const blank = await app.published.createBlankInstance(previous.id)
    const saved = await app.instances.save(previous.id, blank.instance.instanceId, {
      name: '回滚题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '原始提示词' },
      imageFiles: { questionImage: PNG }
    })

    const plan = await builtins.check('speaking', next)
    await expect(builtins.apply(plan, 'migrate')).rejects.toThrow('reference write failed')

    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: previous.id
    })
    await expect(repository.getInterface(previous.id)).resolves.toEqual(previous)
    await expect(repository.getInterface(next.id)).resolves.toEqual(next)
    await expect(app.instances.get(previous.id, blank.instance.instanceId)).resolves.toMatchObject({
      interfaceId: previous.id,
      instance: { name: '回滚题组', values: saved.instance.values }
    })
    await expect(app.instances.get(next.id, blank.instance.instanceId)).resolves.toBeNull()
  })

  it('rolls back the whole builtin migration when deleting the previous version fails', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const previous = await publishInterface(content)
    const next = await publishInterface({
      ...content,
      fields: {
        order: ['section'],
        nodes: {
          section: {
            type: 'group',
            children: structuredClone(content.fields)
          }
        }
      }
    })
    await repository.saveBuiltinInterface('speaking', previous)
    await repository.setBuiltinCurrent('speaking', previous.id)
    const blank = await app.published.createBlankInstance(previous.id)
    await app.instances.save(previous.id, blank.instance.instanceId, {
      name: '删除失败回滚题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '回滚图片' },
      imageFiles: { questionImage: PNG }
    })
    vi.spyOn(repository, 'deleteInterface').mockRejectedValueOnce(
      new Error('previous version delete failed')
    )

    const plan = await builtins.check('speaking', next)
    await expect(builtins.apply(plan, 'migrate')).rejects.toThrow('previous version delete failed')

    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: previous.id
    })
    await expect(repository.getInterface(previous.id)).resolves.toEqual(previous)
    await expect(repository.getInterface(next.id)).resolves.toEqual(next)
    await expect(app.instances.get(previous.id, blank.instance.instanceId)).resolves.toMatchObject({
      interfaceId: previous.id,
      instance: { name: '删除失败回滚题组' }
    })
    await expect(app.instances.get(next.id, blank.instance.instanceId)).resolves.toBeNull()
    expect(references.replaceInterfaceReferences).toHaveBeenNthCalledWith(1, previous.id, next.id)
    expect(references.replaceInterfaceReferences).toHaveBeenNthCalledWith(2, next.id, previous.id)
  })

  it('backs up the previous builtin version instead of migrating its instances', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const previous = await publishInterface(content)
    const next = await publishInterface({
      ...content,
      fields: {
        order: ['section'],
        nodes: {
          section: {
            type: 'group',
            children: structuredClone(content.fields)
          }
        }
      }
    })
    await repository.saveBuiltinInterface('speaking', previous)
    await repository.setBuiltinCurrent('speaking', previous.id)
    const blank = await app.published.createBlankInstance(previous.id)
    await app.instances.save(previous.id, blank.instance.instanceId, {
      name: '保留旧版题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '旧版图片' },
      imageFiles: { questionImage: PNG }
    })

    const plan = await builtins.check('speaking', next)
    expect(plan.kind).toBe('manual')
    await expect(builtins.apply(plan, 'backup-old')).resolves.toMatchObject({
      kind: 'manual',
      currentInterfaceId: next.id,
      migratedInstanceIds: [],
      backedUpPrevious: true
    })
    await expect(repository.listPublishedInterfaceIds()).resolves.toEqual([previous.id])
    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: next.id
    })
    await expect(app.published.get(previous.id)).resolves.toMatchObject({
      definition: { id: previous.id },
      source: { type: 'published' }
    })
    await expect(app.published.listInstances(previous.id)).resolves.toEqual([
      expect.objectContaining({ instanceId: blank.instance.instanceId, name: '保留旧版题组' })
    ])
    expect(references.replaceInterfaceReferences).not.toHaveBeenCalled()
  })

  it('removes a builtin through the public facade and can back it up', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(3)
    }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const def = await publishInterface(content)
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)
    const blank = await app.published.createBlankInstance(def.id)
    await app.instances.save(def.id, blank.instance.instanceId, {
      name: '待处理题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '待处理图片' },
      imageFiles: { questionImage: PNG }
    })

    const plan = await builtins.checkRemoval('speaking')
    expect(plan).toMatchObject({
      builtinKey: 'speaking',
      previous: { id: def.id },
      instanceIds: [blank.instance.instanceId],
      referenceCount: 3
    })
    if (!plan) throw new Error('expected a builtin removal plan')

    await expect(builtins.applyRemoval(plan, 'backup-old')).resolves.toMatchObject({
      previousInterfaceId: def.id,
      affectedInstanceIds: [blank.instance.instanceId],
      affectedReferenceCount: 3,
      backedUpPrevious: true
    })
    await expect(repository.getBuiltin('speaking')).resolves.toBeNull()
    await expect(repository.listPublishedInterfaceIds()).resolves.toEqual([def.id])
    await expect(app.published.listInstances(def.id)).resolves.toEqual([
      expect.objectContaining({ instanceId: blank.instance.instanceId, name: '待处理题组' })
    ])
  })

  it('restores builtin ownership when removal fails after backing up the previous version', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const references = {
      replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined),
      countInterfaceReferences: vi.fn().mockResolvedValue(0)
    }
    const builtins = createBuiltinInterfaceApplication({ repository, references })
    const def = await publishInterface(content)
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)
    const blank = await app.published.createBlankInstance(def.id)
    await app.instances.save(def.id, blank.instance.instanceId, {
      name: '删除失败恢复题组',
      values: blank.instance.values,
      imagePrompts: { questionImage: '恢复图片' },
      imageFiles: { questionImage: PNG }
    })
    const plan = await builtins.checkRemoval('speaking')
    if (!plan) throw new Error('expected a builtin removal plan')
    vi.spyOn(repository, 'removeBuiltin').mockRejectedValueOnce(new Error('remove failed'))

    await expect(builtins.applyRemoval(plan, 'backup-old')).rejects.toThrow('remove failed')

    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: def.id
    })
    await expect(repository.listPublishedInterfaceIds()).resolves.toEqual([])
    await expect(repository.getInterface(def.id)).resolves.toEqual(def)
    await expect(app.published.listInstances(def.id)).resolves.toEqual([
      expect.objectContaining({ instanceId: blank.instance.instanceId, name: '删除失败恢复题组' })
    ])
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
  generateCalls = 0

  constructor(private readonly response: string) {}

  async listModels() {
    return this.models
  }

  async *generate(
    prompt: string,
    options: { signal: AbortSignal; model?: InterfaceTextModelSelection }
  ): AsyncIterable<InterfaceTextGenerationChunk> {
    this.generateCalls += 1
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
