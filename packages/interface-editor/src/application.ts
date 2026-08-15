import type {
  InterfaceInstance,
  TaskProgressHandle,
  TaskProgressItem,
  TaskProgressSnapshot
} from '@ls101/core-types'
import {
  buildAIPrompt,
  buildExposedInstance,
  buildFormatInstructions,
  buildInstanceFromJson,
  buildVarManifest
} from './conversions'
import { importInterfacePackage, inspectInterfacePackage } from './exchange'
import type { InstanceSelection } from './exchange'
import { exportInterfaceFile, readInterfaceFile, type InterfaceFileDialog } from './fileExchange'
import { createInterfaceDraft, publishInterface } from './id'
import { addNode, removeNode, renameNode, updateNode } from './mutations'
import type { InterfaceRepository } from './repository'
import { buildJsonExample, buildJsonSchema, validateJson } from './schema'
import type {
  FieldCollection,
  FieldNode,
  InterfaceContent,
  InterfaceDef,
  InterfaceDraft
} from './types'
import { validateInterfaceDef, type ValidationError } from './validation'

export type PublishedInterfaceSource =
  | { type: 'published' }
  | { type: 'builtin'; builtinKey: string }

export interface InterfaceDraftSummary {
  draftId: string
  name: string
  description: string
}

export interface PublishedInterfaceSummary {
  interfaceId: string
  name: string
  description: string
  source: PublishedInterfaceSource
  instanceCount: number
}

export interface PublishedInterfaceDetails {
  definition: InterfaceDef
  source: PublishedInterfaceSource
}

export interface InterfaceInstanceSummary {
  instanceId: string
  name: string
  generatedAt: string
}

export interface InterfaceInstanceDetails {
  interfaceId: string
  instance: InterfaceInstance
  assetUrls: Record<string, string>
}

/** 跨模块按 instanceId 定位实例时使用的最小只读 DTO。 */
export interface InterfaceInstanceLocation {
  interfaceId: string
  instance: InterfaceInstance
  assetUrls: Record<string, string>
}

export interface InterfaceInstanceEdit {
  name: string
  values: Record<string, string>
  imagePrompts?: Readonly<Record<string, string>>
  /** 以图片变量名为 key；二进制表示新增或替换，null 表示移除，缺少 key 表示保留。 */
  imageFiles?: Readonly<Record<string, Uint8Array | null>>
}

export interface InterfacePromptBundle {
  prompt: string
  formatInstructions: string
  fullPrompt: string
  jsonSchema: string
  jsonExample: string
}

export type InterfaceDraftOperation =
  | { type: 'set-name'; value: string }
  | { type: 'set-description'; value: string }
  | { type: 'set-prompt'; value: string }
  | { type: 'add-node'; parentPath: readonly string[]; key: string; node: FieldNode }
  | { type: 'update-node'; path: readonly string[]; node: FieldNode }
  | { type: 'rename-node'; path: readonly string[]; key: string }
  | { type: 'remove-node'; path: readonly string[] }

export interface EditInterfaceDraftResult {
  draft: InterfaceDraft
  operationApplied: boolean
}

export type PublishDraftResult =
  | { status: 'published' | 'already-published'; interface: PublishedInterfaceSummary }
  | { status: 'invalid'; errors: readonly ValidationError[] }

export interface InstanceDataError {
  path: string
  message: string
}

export type ReplaceInstanceFromJsonResult =
  | { status: 'replaced'; instance: InterfaceInstanceDetails }
  | { status: 'invalid-json'; errors: readonly InstanceDataError[] }

export type InterfaceAIGenerationResult =
  | { status: 'completed'; instance: InterfaceInstanceDetails }
  | { status: 'invalid-response'; rawOutput: string; errors: readonly InstanceDataError[] }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' }

export interface InterfaceTextGenerationChunk {
  type: 'reasoning' | 'output'
  /** 本次事件新增的文本，不是截至当前的完整快照。 */
  delta: string
}

export interface InterfaceTextModelSelection {
  providerId: string
  modelId: string
}

export interface InterfaceTextModelOption extends InterfaceTextModelSelection {
  providerName: string
  modelName?: string
}

export interface InterfaceImageProviderSelection {
  providerId: string
  modelId?: string
}

export interface InterfaceImageProviderOption extends InterfaceImageProviderSelection {
  providerName: string
  modelName?: string
}

/** AIRouter 或其他 AI 适配器只需提供此窄能力。 */
export interface InterfaceTextGenerator {
  listModels?(): Promise<readonly InterfaceTextModelOption[]>
  generate(
    prompt: string,
    options: { signal: AbortSignal; model?: InterfaceTextModelSelection }
  ): AsyncIterable<InterfaceTextGenerationChunk>
}

export interface InterfaceImageGenerator {
  listProviders?(): Promise<readonly InterfaceImageProviderOption[]>
  generate(
    prompt: string,
    options: { signal: AbortSignal; provider?: InterfaceImageProviderSelection }
  ): Promise<{ data: Uint8Array }>
}

export interface InterfaceBrowser {
  listDrafts(): Promise<InterfaceDraftSummary[]>
  listPublished(): Promise<PublishedInterfaceSummary[]>
}

export interface InterfaceDraftApplication {
  create(initial?: Partial<InterfaceContent>): Promise<InterfaceDraft>
  get(draftId: string): Promise<InterfaceDraft | null>
  save(draft: InterfaceDraft): Promise<void>
  delete(draftId: string): Promise<void>
  publish(draftId: string): Promise<PublishDraftResult>
}

export interface PublishedInterfaceApplication {
  get(interfaceId: string): Promise<PublishedInterfaceDetails | null>
  listInstances(interfaceId: string): Promise<InterfaceInstanceSummary[]>
  getPrompts(interfaceId: string): Promise<InterfacePromptBundle>
  getVarManifest(interfaceId: string): Promise<import('@ls101/core-types').InterfaceVarManifest>
  createBlankInstance(interfaceId: string, name?: string): Promise<InterfaceInstanceDetails>
  copyToDraft(interfaceId: string): Promise<InterfaceDraft>
}

export interface InterfaceInstanceApplication {
  get(interfaceId: string, instanceId: string): Promise<InterfaceInstanceDetails | null>
  /**
   * 按全局唯一 instanceId 定位实例并返回其 Interface 归属。
   * Template 等跨模块消费者不需要知道 Interface 的仓储分区。
   */
  locate(instanceId: string): Promise<InterfaceInstanceLocation | null>
  listAIGenerationModels(): Promise<readonly InterfaceTextModelOption[]>
  listImageGenerationProviders(): Promise<readonly InterfaceImageProviderOption[]>
  save(
    interfaceId: string,
    instanceId: string,
    edit: InterfaceInstanceEdit
  ): Promise<InterfaceInstanceDetails>
  replaceFromJson(
    interfaceId: string,
    instanceId: string,
    json: string,
    options?: { imageProvider?: InterfaceImageProviderSelection }
  ): Promise<ReplaceInstanceFromJsonResult>
  startAIGeneration(
    interfaceId: string,
    instanceId: string,
    options?: {
      model?: InterfaceTextModelSelection
      imageProvider?: InterfaceImageProviderSelection
    }
  ): Promise<TaskProgressHandle<InterfaceAIGenerationResult>>
  generateImage(
    prompt: string,
    options?: { signal?: AbortSignal; provider?: InterfaceImageProviderSelection }
  ): Promise<Uint8Array>
  delete(interfaceId: string, instanceId: string): Promise<void>
}

export type ExportInterfaceResult = { status: 'exported' } | { status: 'cancelled' }

export interface InterfaceImportPreview {
  filename: string
  interface: { interfaceId: string; name: string; description: string }
  instances: Array<{
    instanceId: string
    name: string
    generatedAt: string
    assetFilenames: string[]
  }>
}

export interface InterfaceImportSession {
  readonly preview: InterfaceImportPreview
  commit(instances: InstanceSelection): Promise<InterfaceImportResult>
  cancel(): void
}

export interface InterfaceImportResult {
  interfaceId: string
  interfaceStatus: 'created' | 'skipped-existing'
  importedInstanceIds: string[]
  skippedInstanceIds: string[]
}

export interface InterfaceTransferApplication {
  export(interfaceId: string, instances: InstanceSelection): Promise<ExportInterfaceResult>
  beginImport(): Promise<InterfaceImportSession | null>
}

export interface InterfaceApplication {
  readonly browser: InterfaceBrowser
  readonly drafts: InterfaceDraftApplication
  readonly published: PublishedInterfaceApplication
  readonly instances: InterfaceInstanceApplication
  readonly transfer: InterfaceTransferApplication
}

export interface InterfaceApplicationDependencies {
  repository: InterfaceRepository
  fileDialog: InterfaceFileDialog
  textGenerator?: InterfaceTextGenerator
  imageGenerator?: InterfaceImageGenerator
}

const EMPTY_CONTENT: InterfaceContent = {
  name: '',
  description: '',
  promptTemplate: '',
  fields: { order: [], nodes: {} }
}

export function editInterfaceDraft(
  draft: InterfaceDraft,
  operation: InterfaceDraftOperation
): EditInterfaceDraftResult {
  if (operation.type === 'set-name') {
    return { draft: { ...draft, name: operation.value }, operationApplied: true }
  }
  if (operation.type === 'set-description') {
    return { draft: { ...draft, description: operation.value }, operationApplied: true }
  }
  if (operation.type === 'set-prompt') {
    return { draft: { ...draft, promptTemplate: operation.value }, operationApplied: true }
  }
  const fields =
    operation.type === 'add-node'
      ? addNode(draft.fields, operation.parentPath, operation.key, operation.node)
      : operation.type === 'update-node'
        ? updateNode(draft.fields, operation.path, operation.node)
        : operation.type === 'rename-node'
          ? renameNode(draft.fields, operation.path, operation.key)
          : removeNode(draft.fields, operation.path)
  return fields
    ? { draft: { ...draft, fields }, operationApplied: true }
    : { draft, operationApplied: false }
}

export function createInterfaceApplication(
  dependencies: InterfaceApplicationDependencies
): InterfaceApplication {
  const { repository, fileDialog, textGenerator, imageGenerator } = dependencies
  const busyInstances = new Set<string>()

  const acquireInstance = (interfaceId: string, instanceId: string): (() => void) => {
    const key = `${interfaceId}/${instanceId}`
    if (busyInstances.has(key)) throw new Error('Instance is busy')
    busyInstances.add(key)
    return () => busyInstances.delete(key)
  }

  const sourceOf = async (interfaceId: string): Promise<PublishedInterfaceSource> => {
    if ((await repository.listPublishedInterfaceIds()).includes(interfaceId)) {
      return { type: 'published' }
    }
    for (const builtinKey of await repository.listBuiltinKeys()) {
      if ((await repository.listBuiltinVersionIds(builtinKey)).includes(interfaceId)) {
        return { type: 'builtin', builtinKey }
      }
    }
    throw new Error(`Interface not found: ${interfaceId}`)
  }

  const summaryOf = async (def: InterfaceDef): Promise<PublishedInterfaceSummary> => ({
    interfaceId: def.id,
    name: def.name,
    description: def.description,
    source: await sourceOf(def.id),
    instanceCount: (await repository.listInstanceIds(def.id)).length
  })

  const getInstanceDetails = async (
    interfaceId: string,
    instanceId: string
  ): Promise<InterfaceInstanceDetails | null> => {
    const stored = await repository.getInstance(interfaceId, instanceId)
    if (!stored) return null
    const def = await requireInterface(repository, interfaceId)
    const instance = normalizeImagePromptValues(def.fields, stored)
    const assetUrls: Record<string, string> = {}
    for (const filename of stored.assetFilenames) {
      assetUrls[filename] = await repository.getInstanceAssetUrl(interfaceId, instanceId, filename)
    }
    return { interfaceId, instance, assetUrls }
  }

  const replaceFromJson = async (
    interfaceId: string,
    instanceId: string,
    json: string,
    options: { imageProvider?: InterfaceImageProviderSelection } = {}
  ): Promise<ReplaceInstanceFromJsonResult> => {
    const release = acquireInstance(interfaceId, instanceId)
    try {
      const def = await requireInterface(repository, interfaceId)
      const current = await requireInstance(repository, interfaceId, instanceId)
      const validation = validateJson(buildJsonSchema(def.fields), json)
      if (!validation.valid || !validation.data) {
        return { status: 'invalid-json', errors: jsonErrors(validation.errors) }
      }
      const mapped = buildInstanceFromJson(def, validation.data)
      const prompts = Object.entries(mapped.imagePrompts ?? {})
      if (prompts.some(([, prompt]) => !prompt.trim())) {
        throw new Error('图片变量的提示词不能为空')
      }
      if (prompts.length && !imageGenerator) {
        throw new Error('Interface image generator is not configured')
      }

      const controller = new AbortController()
      const generatedImages: Record<string, Uint8Array> = {}
      for (const [varName, prompt] of prompts) {
        const generated = await imageGenerator?.generate(prompt, {
          signal: controller.signal,
          ...(options.imageProvider ? { provider: options.imageProvider } : {})
        })
        if (!generated) throw new Error('Interface image generator is not configured')
        assertSupportedImage(generated.data)
        generatedImages[varName] = new Uint8Array(generated.data)
      }

      const values = { ...mapped.values }
      const imageVarNames = new Set(flattenImageVarNames(def.fields))
      const assets = await loadInstanceAssets(repository, interfaceId, instanceId, current)
      const usedAssetNames = new Set(current.assetFilenames)
      for (const varName of imageVarNames) {
        const previous = current.instance.values[varName]
        if (current.assetFilenames.includes(previous)) delete assets[previous]
        const data = generatedImages[varName]
        if (!data) continue
        const filename = createImageFilename(varName, supportedImageExtension(data), usedAssetNames)
        usedAssetNames.add(filename)
        assets[filename] = data
        values[varName] = filename
      }
      assertCompleteImageValues(imageVarNames, values, mapped.imagePrompts ?? {})
      await repository.updateInstance(
        interfaceId,
        {
          ...current.instance,
          values,
          imagePrompts: mapped.imagePrompts
        },
        prompts.length ? assets : undefined
      )
      return {
        status: 'replaced',
        instance: (await getInstanceDetails(interfaceId, instanceId)) as InterfaceInstanceDetails
      }
    } finally {
      release()
    }
  }

  return {
    browser: {
      async listDrafts() {
        const values = await Promise.all(
          (await repository.listDraftIds()).map((id) => repository.getDraft(id))
        )
        return values
          .filter((draft): draft is InterfaceDraft => draft !== null)
          .map(({ draftId, name, description }) => ({ draftId, name, description }))
      },
      async listPublished() {
        const ids = new Set(await repository.listPublishedInterfaceIds())
        for (const builtinKey of await repository.listBuiltinKeys()) {
          const entry = await repository.getBuiltin(builtinKey)
          if (entry) ids.add(entry.currentInterfaceId)
        }
        const defs = await Promise.all([...ids].sort().map((id) => repository.getInterface(id)))
        return Promise.all(
          defs.filter((def): def is InterfaceDef => def !== null).map((def) => summaryOf(def))
        )
      }
    },
    drafts: {
      async create(initial = {}) {
        const draft = createInterfaceDraft({ ...structuredClone(EMPTY_CONTENT), ...initial })
        await repository.saveDraft(draft)
        return draft
      },
      get: (draftId) => repository.getDraft(draftId),
      save: (draft) => repository.saveDraft(draft),
      delete: (draftId) => repository.deleteDraft(draftId),
      async publish(draftId) {
        const draft = await repository.getDraft(draftId)
        if (!draft) throw new Error(`Draft not found: ${draftId}`)
        const candidate = { ...draft, id: 'sha256:' + '0'.repeat(64) }
        const validation = validateInterfaceDef(candidate)
        const contentErrors = validation.errors.filter(({ code }) => code !== 'INVALID_ID')
        if (contentErrors.length > 0) return { status: 'invalid', errors: contentErrors }
        const def = await publishInterface(draft)
        const existing = await repository.getInterface(def.id)
        if (existing) {
          return { status: 'already-published', interface: await summaryOf(existing) }
        }
        await repository.saveInterface(def)
        return {
          status: 'published',
          interface: await summaryOf(def)
        }
      }
    },
    published: {
      async get(interfaceId) {
        const definition = await repository.getInterface(interfaceId)
        return definition ? { definition, source: await sourceOf(interfaceId) } : null
      },
      async listInstances(interfaceId) {
        const values = await Promise.all(
          (await repository.listInstanceIds(interfaceId)).map((id) =>
            repository.getInstance(interfaceId, id)
          )
        )
        return values
          .filter((stored): stored is NonNullable<typeof stored> => stored !== null)
          .map(({ instance }) => ({
            instanceId: instance.instanceId,
            name: instance.name,
            generatedAt: instance.generatedAt
          }))
      },
      async getPrompts(interfaceId) {
        const def = await requireInterface(repository, interfaceId)
        return {
          prompt: def.promptTemplate,
          formatInstructions: buildFormatInstructions(def),
          fullPrompt: buildAIPrompt(def),
          jsonSchema: JSON.stringify(buildJsonSchema(def.fields), null, 2),
          jsonExample: JSON.stringify(buildJsonExample(def.fields), null, 2)
        }
      },
      async getVarManifest(interfaceId) {
        return buildVarManifest(await requireInterface(repository, interfaceId))
      },
      async createBlankInstance(interfaceId, name) {
        const def = await requireInterface(repository, interfaceId)
        const now = new Date().toISOString()
        const instance = buildInstanceFromJson(def, {}, name?.trim() || '未命名题组')
        instance.generatedAt = now
        for (const key of Object.keys(instance.values)) instance.values[key] = ''
        await repository.saveInstance(interfaceId, instance)
        return (await getInstanceDetails(
          interfaceId,
          instance.instanceId
        )) as InterfaceInstanceDetails
      },
      async copyToDraft(interfaceId) {
        const def = await requireInterface(repository, interfaceId)
        const draft = createInterfaceDraft({
          name: def.name,
          description: def.description,
          promptTemplate: def.promptTemplate,
          fields: structuredClone(def.fields)
        })
        await repository.saveDraft(draft)
        return draft
      }
    },
    instances: {
      get: getInstanceDetails,
      async locate(instanceId) {
        const located = await repository.findInstance(instanceId)
        if (!located) return null
        const definition = await requireInterface(repository, located.interfaceId)
        const assetUrls: Record<string, string> = {}
        for (const filename of located.assetFilenames) {
          assetUrls[filename] = await repository.getInstanceAssetUrl(
            located.interfaceId,
            instanceId,
            filename
          )
        }
        return {
          interfaceId: located.interfaceId,
          instance: buildExposedInstance(
            definition,
            normalizeImagePromptValues(definition.fields, located)
          ),
          assetUrls
        }
      },
      async listAIGenerationModels() {
        return (await textGenerator?.listModels?.()) ?? []
      },
      async listImageGenerationProviders() {
        return (await imageGenerator?.listProviders?.()) ?? []
      },
      async save(interfaceId, instanceId, edit) {
        const release = acquireInstance(interfaceId, instanceId)
        try {
          const def = await requireInterface(repository, interfaceId)
          const current = await requireInstance(repository, interfaceId, instanceId)
          const imageVarNames = new Set(flattenImageVarNames(def.fields))
          const selectedImages = edit.imageFiles ?? {}
          const nextImagePrompts = {
            ...(current.instance.imagePrompts ?? {}),
            ...(edit.imagePrompts ?? {})
          }
          const selectedImageExtensions = new Map<string, string>()
          for (const [varName, data] of Object.entries(selectedImages)) {
            if (!imageVarNames.has(varName)) {
              throw new Error(`Not an image variable: ${varName}`)
            }
            if (data === null) continue
            assertSupportedImage(data)
            selectedImageExtensions.set(varName, supportedImageExtension(data))
          }
          for (const [varName, prompt] of Object.entries(nextImagePrompts)) {
            if (!imageVarNames.has(varName)) {
              throw new Error(`Not an image variable: ${varName}`)
            }
            if (typeof prompt !== 'string') throw new TypeError('Image prompt must be a string')
          }

          const nextValues = { ...edit.values }
          const replacedAssetNames = new Set<string>()
          const selectedAssetData: Record<string, Uint8Array> = {}
          const usedAssetNames = new Set(current.assetFilenames)

          for (const varName of imageVarNames) {
            if (!Object.hasOwn(selectedImages, varName)) continue
            const previousValue = current.instance.values[varName]
            if (current.assetFilenames.includes(previousValue)) {
              replacedAssetNames.add(previousValue)
            }

            const selected = selectedImages[varName]
            if (selected === null) {
              nextValues[varName] = ''
              continue
            }
            const filename = createImageFilename(
              varName,
              selectedImageExtensions.get(varName) as string,
              usedAssetNames
            )
            usedAssetNames.add(filename)
            selectedAssetData[filename] = new Uint8Array(selected)
            nextValues[varName] = filename
          }

          assertCompleteImageValues(imageVarNames, nextValues, nextImagePrompts)

          const retainedAssetNames = new Set(
            [...imageVarNames]
              .map((varName) => nextValues[varName])
              .filter((value) => current.assetFilenames.includes(value))
          )
          const instance = {
            ...current.instance,
            name: edit.name,
            values: nextValues,
            imagePrompts: Object.keys(nextImagePrompts).length ? nextImagePrompts : undefined
          }
          const assetsChanged =
            Object.keys(selectedImages).length > 0 || replacedAssetNames.size > 0
          if (!assetsChanged) {
            await repository.updateInstance(interfaceId, instance)
          } else {
            const nextAssets = await loadInstanceAssets(
              repository,
              interfaceId,
              instanceId,
              current
            )
            for (const filename of replacedAssetNames) {
              if (!retainedAssetNames.has(filename)) delete nextAssets[filename]
            }
            Object.assign(nextAssets, selectedAssetData)
            await repository.updateInstance(interfaceId, instance, nextAssets)
          }
          return (await getInstanceDetails(interfaceId, instanceId)) as InterfaceInstanceDetails
        } finally {
          release()
        }
      },
      replaceFromJson,
      async startAIGeneration(interfaceId, instanceId, options = {}) {
        if (!textGenerator) throw new Error('Interface text generator is not configured')
        const release = acquireInstance(interfaceId, instanceId)
        try {
          await requireInstance(repository, interfaceId, instanceId)
          const def = await requireInterface(repository, interfaceId)
          const controller = new AbortController()
          const stream = textGenerator.generate(buildAIPrompt(def), {
            signal: controller.signal,
            model: options.model
          })
          return createGenerationHandle(
            stream,
            controller,
            async (text, progress) => {
              const validation = validateJson(
                buildJsonSchema(def.fields),
                normalizeAIJsonOutput(text)
              )
              if (!validation.valid || !validation.data) {
                return {
                  status: 'invalid-response',
                  rawOutput: text,
                  errors: jsonErrors(validation.errors)
                }
              }
              const current = await requireInstance(repository, interfaceId, instanceId)
              const mapped = buildInstanceFromJson(def, validation.data)
              const prompts = Object.entries(mapped.imagePrompts ?? {})
              if (prompts.some(([, prompt]) => !prompt.trim())) {
                throw new Error('图片变量的提示词不能为空')
              }
              if (prompts.length && !imageGenerator) {
                throw new Error('Interface image generator is not configured')
              }
              progress.prepareImages(prompts.map(([varName]) => varName))
              const generatedImages: Record<string, Uint8Array> = {}
              for (const [index, [varName, prompt]] of prompts.entries()) {
                progress.startImage(index)
                const generated = await imageGenerator?.generate(prompt, {
                  signal: controller.signal,
                  ...(options.imageProvider ? { provider: options.imageProvider } : {})
                })
                if (!generated) throw new Error('Interface image generator is not configured')
                assertSupportedImage(generated.data)
                generatedImages[varName] = new Uint8Array(generated.data)
                progress.completeImage(index)
              }

              const values = { ...mapped.values }
              const assets = await loadInstanceAssets(repository, interfaceId, instanceId, current)
              const imageVarNames = new Set(flattenImageVarNames(def.fields))
              const usedAssetNames = new Set(current.assetFilenames)
              for (const varName of imageVarNames) {
                const previous = current.instance.values[varName]
                if (current.assetFilenames.includes(previous)) delete assets[previous]
                const data = generatedImages[varName]
                if (!data) continue
                const filename = createImageFilename(
                  varName,
                  supportedImageExtension(data),
                  usedAssetNames
                )
                usedAssetNames.add(filename)
                assets[filename] = data
                values[varName] = filename
              }

              assertCompleteImageValues(imageVarNames, values, mapped.imagePrompts ?? {})

              progress.saving()
              await repository.updateInstance(
                interfaceId,
                {
                  ...current.instance,
                  values,
                  imagePrompts: mapped.imagePrompts
                },
                assets
              )
              return {
                status: 'completed',
                instance: (await getInstanceDetails(
                  interfaceId,
                  instanceId
                )) as InterfaceInstanceDetails
              }
            },
            () => {
              release()
            }
          )
        } catch (error) {
          release()
          throw error
        }
      },
      async generateImage(prompt, options = {}) {
        if (!imageGenerator) throw new Error('Interface image generator is not configured')
        const controller = new AbortController()
        const abort = (): void => controller.abort()
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })
        try {
          const image = await imageGenerator.generate(prompt, {
            signal: controller.signal,
            ...(options.provider ? { provider: options.provider } : {})
          })
          assertSupportedImage(image.data)
          return new Uint8Array(image.data)
        } finally {
          options.signal?.removeEventListener('abort', abort)
        }
      },
      async delete(interfaceId, instanceId) {
        const release = acquireInstance(interfaceId, instanceId)
        try {
          await repository.deleteInstance(interfaceId, instanceId)
        } finally {
          release()
        }
      }
    },
    transfer: {
      async export(interfaceId, instances) {
        return (await exportInterfaceFile(repository, interfaceId, instances, fileDialog))
          ? { status: 'exported' }
          : { status: 'cancelled' }
      },
      async beginImport() {
        const selected = await readInterfaceFile(fileDialog)
        if (!selected) return null
        const value = selected.package
        const inspection = await inspectInterfacePackage(value)
        let active = true
        return {
          preview: {
            filename: selected.filename,
            interface: {
              interfaceId: inspection.interface.id,
              name: inspection.interface.name,
              description: inspection.interface.description
            },
            instances: inspection.instances
          },
          async commit(instances) {
            if (!active) throw new Error('Import session is no longer active')
            active = false
            const result = await importInterfacePackage(repository, value, { instances })
            return {
              interfaceId: value.interface.id,
              interfaceStatus: result.interface,
              importedInstanceIds: Object.entries(result.instances)
                .filter(([, status]) => status === 'created')
                .map(([instanceId]) => instanceId),
              skippedInstanceIds: Object.entries(result.instances)
                .filter(([, status]) => status !== 'created')
                .map(([instanceId]) => instanceId)
            }
          },
          cancel() {
            active = false
          }
        }
      }
    }
  }
}

const MAX_IMAGE_BYTES = 20 * 1024 * 1024

function flattenImageVarNames(fields: FieldCollection): string[] {
  const result: string[] = []
  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') result.push(...flattenImageVarNames(node.children))
    else if (node.type === 'image') result.push(node.varName)
  }
  return result
}

function normalizeImagePromptValues(
  fields: FieldCollection,
  stored: { instance: InterfaceInstance; assetFilenames: readonly string[] }
): InterfaceInstance {
  const values = { ...stored.instance.values }
  const imagePrompts = { ...(stored.instance.imagePrompts ?? {}) }
  for (const varName of flattenImageVarNames(fields)) {
    const value = values[varName]
    if (value && !stored.assetFilenames.includes(value) && !Object.hasOwn(imagePrompts, varName)) {
      imagePrompts[varName] = value
      values[varName] = ''
    }
  }
  return {
    ...stored.instance,
    values,
    imagePrompts: Object.keys(imagePrompts).length ? imagePrompts : undefined
  }
}

function assertCompleteImageValues(
  imageVarNames: ReadonlySet<string>,
  values: Readonly<Record<string, string>>,
  imagePrompts: Readonly<Record<string, string>>
): void {
  for (const varName of imageVarNames) {
    if (!values[varName]?.trim() || !imagePrompts[varName]?.trim()) {
      throw new Error(`图片变量 ${varName} 的提示词和图片必须同时填写`)
    }
  }
}

async function loadInstanceAssets(
  repository: InterfaceRepository,
  interfaceId: string,
  instanceId: string,
  current: { assetFilenames: readonly string[] }
): Promise<Record<string, Uint8Array>> {
  const assets: Record<string, Uint8Array> = {}
  for (const filename of current.assetFilenames) {
    const data = await repository.readInstanceAsset(interfaceId, instanceId, filename)
    if (!data) throw new Error(`Instance asset is missing: ${filename}`)
    assets[filename] = data
  }
  return assets
}

function assertSupportedImage(data: Uint8Array): void {
  if (!(data instanceof Uint8Array)) throw new TypeError('Image data must be a Uint8Array')
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Image must not exceed 20 MB')
  supportedImageExtension(data)
}

function supportedImageExtension(data: Uint8Array): 'png' | 'jpg' | 'gif' | 'webp' {
  if (data.length >= 8 && samePrefix(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png'
  }
  if (data.length >= 3 && samePrefix(data, [0xff, 0xd8, 0xff])) return 'jpg'
  if (
    data.length >= 6 &&
    (samePrefix(data, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
      samePrefix(data, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
  ) {
    return 'gif'
  }
  if (
    data.length >= 12 &&
    samePrefix(data, [0x52, 0x49, 0x46, 0x46]) &&
    sameAt(data, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return 'webp'
  }
  throw new Error('Only PNG, JPEG, GIF, and WebP images are supported')
}

function createImageFilename(
  varName: string,
  extension: string,
  existing: ReadonlySet<string>
): string {
  let filename = ''
  do filename = `${varName}-${crypto.randomUUID()}.${extension}`
  while (existing.has(filename))
  return filename
}

function samePrefix(data: Uint8Array, expected: readonly number[]): boolean {
  return sameAt(data, 0, expected)
}

function sameAt(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => data[offset + index] === value)
}

async function requireInterface(
  repository: InterfaceRepository,
  interfaceId: string
): Promise<InterfaceDef> {
  const def = await repository.getInterface(interfaceId)
  if (!def) throw new Error(`Interface not found: ${interfaceId}`)
  return def
}

async function requireInstance(
  repository: InterfaceRepository,
  interfaceId: string,
  instanceId: string
): Promise<NonNullable<Awaited<ReturnType<InterfaceRepository['getInstance']>>>> {
  const stored = await repository.getInstance(interfaceId, instanceId)
  if (!stored) throw new Error(`Instance not found: ${instanceId}`)
  return stored
}

function jsonErrors(
  errors: Array<{ instancePath?: string; message?: string }> | null
): InstanceDataError[] {
  return (errors ?? []).map((error) => ({
    path: error.instancePath ?? '',
    message: error.message ?? 'Invalid value'
  }))
}

function createGenerationHandle(
  stream: AsyncIterable<InterfaceTextGenerationChunk>,
  controller: AbortController,
  apply: (
    text: string,
    progress: {
      prepareImages(varNames: readonly string[]): void
      startImage(index: number): void
      completeImage(index: number): void
      saving(): void
    }
  ) => Promise<InterfaceAIGenerationResult>,
  dispose: () => void
): TaskProgressHandle<InterfaceAIGenerationResult> {
  let cancelled = false
  let snapshot: TaskProgressSnapshot = {
    items: [
      { id: 'ai', label: 'AI 生成', status: 'running' },
      { id: 'validate', label: '校验生成结果', status: 'waiting' },
      { id: 'save', label: '保存实例', status: 'waiting' }
    ]
  }
  const listeners = new Set<() => void>()
  const publish = (items: readonly TaskProgressItem[]): void => {
    snapshot = { items }
    for (const listener of listeners) listener()
  }
  let reasoning = ''
  let output = ''
  let imageItems: TaskProgressItem[] = []
  const aiItem = (status: 'running' | 'completed'): TaskProgressItem => {
    const sections: string[] = []
    if (reasoning) sections.push(`### 思考\n\n${reasoning}`)
    if (output) sections.push(`### 输出\n\n${output}`)
    return {
      id: 'ai',
      label: 'AI 生成',
      status,
      ...(sections.length > 0
        ? { log: { format: 'markdown' as const, content: sections.join('\n\n') } }
        : {})
    }
  }

  const completion = (async (): Promise<InterfaceAIGenerationResult> => {
    try {
      for await (const chunk of stream) {
        if (cancelled) return { status: 'cancelled' }
        if (chunk.type === 'reasoning') reasoning += chunk.delta
        else output += chunk.delta
        publish([aiItem('running'), ...snapshot.items.slice(-2)])
      }
      if (cancelled) return { status: 'cancelled' }
      publish([
        aiItem('completed'),
        { id: 'validate', label: '校验生成结果', status: 'running' },
        { id: 'save', label: '保存实例', status: 'waiting' }
      ])
      const applied = await apply(output, {
        prepareImages(varNames) {
          if (cancelled) throw new GenerationCancelledError()
          imageItems = varNames.map((varName, index) => ({
            id: `image-${index}`,
            label: `生成图片：${varName}`,
            status: 'waiting'
          }))
          publish([
            aiItem('completed'),
            { id: 'validate', label: '校验生成结果', status: 'completed' },
            ...imageItems,
            { id: 'save', label: '保存实例', status: 'waiting' }
          ])
        },
        startImage(index) {
          if (cancelled) throw new GenerationCancelledError()
          imageItems = imageItems.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'running' } : item
          )
          publish([
            aiItem('completed'),
            { id: 'validate', label: '校验生成结果', status: 'completed' },
            ...imageItems,
            { id: 'save', label: '保存实例', status: 'waiting' }
          ])
        },
        completeImage(index) {
          imageItems = imageItems.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'completed' } : item
          )
          publish([
            aiItem('completed'),
            { id: 'validate', label: '校验生成结果', status: 'completed' },
            ...imageItems,
            { id: 'save', label: '保存实例', status: 'waiting' }
          ])
        },
        saving() {
          if (cancelled) throw new GenerationCancelledError()
          publish([
            aiItem('completed'),
            { id: 'validate', label: '校验生成结果', status: 'completed' },
            ...imageItems,
            { id: 'save', label: '保存实例', status: 'running' }
          ])
        }
      })
      if (applied.status === 'invalid-response') {
        publish([
          aiItem('completed'),
          {
            id: 'validate',
            label: '校验生成结果',
            status: 'completed',
            log: {
              format: 'text',
              content: applied.errors.map((error) => error.message).join('\n')
            }
          },
          { id: 'save', label: '保存实例', status: 'waiting' }
        ])
        return applied
      }
      publish([
        aiItem('completed'),
        { id: 'validate', label: '校验生成结果', status: 'completed' },
        ...imageItems,
        { id: 'save', label: '保存实例', status: 'completed' }
      ])
      return applied
    } catch (error: unknown) {
      if (error instanceof GenerationCancelledError) return { status: 'cancelled' as const }
      if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
        return { status: 'cancelled' as const }
      }
      const message = error instanceof Error ? error.message : String(error)
      publish(
        snapshot.items.map((item) =>
          item.status === 'running'
            ? {
                ...item,
                status: 'completed',
                log: { format: 'text', content: message }
              }
            : item
        )
      )
      return { status: 'failed' as const, message }
    } finally {
      dispose()
    }
  })()

  return {
    getSnapshot: () => snapshot,
    subscribe(listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    cancel: () => {
      cancelled = true
      controller.abort()
    },
    completion
  }
}

class GenerationCancelledError extends Error {}

/** Remove presentation wrappers that some text models add around an otherwise valid object. */
function normalizeAIJsonOutput(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  const objectStart = candidate.indexOf('{')
  if (objectStart <= 0) return candidate
  const objectEnd = candidate.lastIndexOf('}')
  return objectEnd >= objectStart
    ? candidate.slice(objectStart, objectEnd + 1)
    : candidate.slice(objectStart)
}
