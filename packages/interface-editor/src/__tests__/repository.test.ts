import { describe, expect, it } from 'vitest'
import type { InterfaceInstance } from '@ls101/core-types'
import {
  exportInterfacePackage,
  importInterfacePackage,
  inspectInterfacePackage
} from '../exchange'
import {
  exportInterfaceFile,
  importInterfaceFile,
  inspectInterfaceFile,
  type InterfaceFileDialog
} from '../fileExchange'
import { createInterfaceDraft, publishInterface } from '../id'
import {
  FileInterfaceRepository,
  InterfaceRepositoryError,
  type InterfaceStore
} from '../repository'
import type { InterfaceContent } from '../types'
import { decodeInterfaceZip, encodeInterfaceZip } from '../zip'
import { strToU8, unzipSync, zipSync } from 'fflate'

const INSTANCE_A = '10000000-0000-4000-8000-000000000001'
const INSTANCE_B = '10000000-0000-4000-8000-000000000002'

function content(name = '口语 Interface'): InterfaceContent {
  return {
    name,
    description: '用于测试',
    promptTemplate: '生成一套口语题',
    fields: {
      title: {
        type: 'text',
        varName: 'title',
        description: '标题',
        example: '模拟试卷'
      }
    }
  }
}

function instance(interfaceId: string, instanceId: string, title: string): InterfaceInstance {
  return {
    instanceId,
    interfaceId,
    generatedAt: '2026-07-28T10:00:00.000Z',
    values: { title }
  }
}

function setup(): { repository: FileInterfaceRepository; store: MemoryStore } {
  const store = new MemoryStore()
  return { store, repository: new FileInterfaceRepository(store.scope('interfaces')) }
}

describe('FileInterfaceRepository', () => {
  it('保存、读取、列出和删除草稿', async () => {
    const { repository } = setup()
    const draft = createInterfaceDraft(content())

    await repository.saveDraft(draft)
    expect(await repository.listDraftIds()).toEqual([draft.draftId])
    expect(await repository.getDraft(draft.draftId)).toEqual(draft)

    await repository.deleteDraft(draft.draftId)
    expect(await repository.getDraft(draft.draftId)).toBeNull()
  })

  it('发布草稿并按内容 ID 去重', async () => {
    const { repository } = setup()
    const first = createInterfaceDraft(content())
    const second = createInterfaceDraft(content())
    await repository.saveDraft(first)
    await repository.saveDraft(second)

    const firstPublished = await repository.publishDraft(first.draftId)
    const secondPublished = await repository.publishDraft(second.draftId)

    expect(firstPublished.id).toBe(secondPublished.id)
    expect(await repository.listInterfaceIds()).toEqual([firstPublished.id])
  })

  it('拒绝内容 ID 与内容不匹配的 Interface', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())

    await expect(repository.saveInterface({ ...def, name: '篡改内容' })).rejects.toMatchObject({
      code: 'INVALID_DATA'
    })
  })

  it('拒绝发布不完整的 Interface', async () => {
    const { repository } = setup()
    const invalid = await publishInterface({ ...content(), promptTemplate: '' })

    await expect(repository.saveInterface(invalid)).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('保存实例及资源，并生成资源 URL', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const value = instance(def.id, INSTANCE_A, '第一套')

    expect(await repository.saveInstance(value, { 'picture.png': new Uint8Array([1, 2, 3]) })).toBe(
      'created'
    )
    expect(await repository.getInstance(def.id, INSTANCE_A)).toEqual({
      instance: value,
      assetFilenames: ['picture.png']
    })
    expect(await repository.readInstanceAsset(def.id, INSTANCE_A, 'picture.png')).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(repository.getInstanceAssetUrl(def.id, INSTANCE_A, 'picture.png')).toContain(
      `/published/${def.id.slice(7)}/instances/${INSTANCE_A}/picture.png`
    )
  })

  it('内容相同但 UUID 不同的实例作为两个实体保留', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)

    await repository.saveInstance(instance(def.id, INSTANCE_A, '相同内容'))
    await repository.saveInstance(instance(def.id, INSTANCE_B, '相同内容'))

    expect(await repository.listInstanceIds(def.id)).toEqual([INSTANCE_A, INSTANCE_B])
  })

  it('同 UUID、同内容去重，同 UUID、不同内容拒绝', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const original = instance(def.id, INSTANCE_A, '原始内容')

    await repository.saveInstance(original)
    expect(await repository.saveInstance(original)).toBe('existing')
    await expect(
      repository.saveInstance(instance(def.id, INSTANCE_A, '冲突内容'))
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
  })

  it('拒绝变量集合与 Interface 不一致的实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)

    await expect(
      repository.saveInstance({
        ...instance(def.id, INSTANCE_A, '内容'),
        values: { unexpected: '值' }
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('删除 Interface 时一并删除其实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    await repository.saveInstance(instance(def.id, INSTANCE_A, '内容'))

    await repository.deleteInterface(def.id)
    expect(await repository.getInterface(def.id)).toBeNull()
    expect(await repository.listInstanceIds(def.id)).toEqual([])
  })
})

describe('Interface 交换包', () => {
  it('支持不附带、选择和附带全部实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    await repository.saveInstance(instance(def.id, INSTANCE_A, 'A'))
    await repository.saveInstance(instance(def.id, INSTANCE_B, 'B'))

    const none = await exportInterfacePackage(repository, def.id, { mode: 'none' })
    const selected = await exportInterfacePackage(repository, def.id, {
      mode: 'selected',
      instanceIds: [INSTANCE_B]
    })
    const all = await exportInterfacePackage(repository, def.id, { mode: 'all' })

    expect(none.instances).toHaveLength(0)
    expect(selected.instances.map(({ instance }) => instance.instanceId)).toEqual([INSTANCE_B])
    expect(all.instances.map(({ instance }) => instance.instanceId)).toEqual([
      INSTANCE_A,
      INSTANCE_B
    ])
  })

  it('检查包并按导入选择保存实例和资源', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, 'A'), {
      'a.png': new Uint8Array([4, 5])
    })
    await source.saveInstance(instance(def.id, INSTANCE_B, 'B'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    const inspection = await inspectInterfacePackage(bundle)
    expect(inspection.instances).toHaveLength(2)

    const result = await importInterfacePackage(target, bundle, {
      instances: { mode: 'selected', instanceIds: [INSTANCE_A] }
    })
    expect(result).toEqual({ interface: 'created', instances: { [INSTANCE_A]: 'created' } })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_A])
    expect(await target.readInstanceAsset(def.id, INSTANCE_A, 'a.png')).toEqual(
      new Uint8Array([4, 5])
    )
  })

  it('重复导入同一实例时返回 existing', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, 'A'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })
    const result = await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })

    expect(result).toEqual({ interface: 'existing', instances: { [INSTANCE_A]: 'existing' } })
  })

  it('不同 UUID 的相同实例内容在导入时全部保留', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, '相同'))
    await source.saveInstance(instance(def.id, INSTANCE_B, '相同'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_A, INSTANCE_B])
  })

  it('导入前发现实例冲突，不写入包内其他实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, '来源内容'))
    await source.saveInstance(instance(def.id, INSTANCE_B, '待导入'))
    await target.saveInterface(def)
    await target.saveInstance(instance(def.id, INSTANCE_A, '本地冲突内容'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    await expect(
      importInterfacePackage(target, bundle, { instances: { mode: 'all' } })
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
    expect(await target.getInstance(def.id, INSTANCE_B)).toBeNull()
  })

  it('拒绝内容 ID 被篡改的包和不存在的选择项', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'none' })

    await expect(
      inspectInterfacePackage({ ...bundle, interface: { ...def, name: '篡改' } })
    ).rejects.toBeInstanceOf(InterfaceRepositoryError)
    await expect(
      importInterfacePackage(target, bundle, {
        instances: { mode: 'selected', instanceIds: [INSTANCE_A] }
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

describe('Interface ZIP 与文件对话框', () => {
  it('ZIP 往返保留定义、实例和二进制资源', async () => {
    const source = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, 'A'), {
      'picture.png': new Uint8Array([0, 1, 2, 255])
    })
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    const bytes = await encodeInterfaceZip(bundle)
    expect(Object.keys(unzipSync(bytes)).sort()).toEqual([
      `instances/${INSTANCE_A}/assets/picture.png`,
      `instances/${INSTANCE_A}/instance.json`,
      'interface.json',
      'manifest.json'
    ])

    const decoded = await decodeInterfaceZip(bytes)
    expect(decoded.interface).toEqual(bundle.interface)
    expect(decoded.instances[0].instance).toEqual(bundle.instances[0].instance)
    expect(decoded.instances[0].assets['picture.png']).toEqual(new Uint8Array([0, 1, 2, 255]))
  })

  it('拒绝缺少文件、额外文件和无效 JSON 的 ZIP', async () => {
    const def = await publishInterface(content())
    const manifest = {
      format: 'ls101-interface-zip',
      version: 1,
      exportedAt: '2026-07-28T10:00:00.000Z',
      interfaceId: def.id,
      instances: []
    }

    await expect(
      decodeInterfaceZip(zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)) }))
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    await expect(
      decodeInterfaceZip(
        zipSync({
          'manifest.json': strToU8(JSON.stringify(manifest)),
          'interface.json': strToU8(JSON.stringify(def)),
          'unexpected.txt': strToU8('nope')
        })
      )
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
    await expect(
      decodeInterfaceZip(
        zipSync({
          'manifest.json': strToU8('{broken'),
          'interface.json': strToU8(JSON.stringify(def))
        })
      )
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('通过 file-dialog 导出 ZIP，并清洗默认文件名', async () => {
    const repository = setup().repository
    const def = await publishInterface(content('口语/Interface:*?'))
    await repository.saveInterface(def)
    const dialog = new TestFileDialog()

    await expect(exportInterfaceFile(repository, def.id, { mode: 'none' }, dialog)).resolves.toBe(
      true
    )
    expect(dialog.writeOptions).toMatchObject({
      title: '导出 Interface',
      defaultName: '口语_Interface___.lsinterface'
    })
    expect((await decodeInterfaceZip(dialog.writtenData as Uint8Array)).interface).toEqual(def)
  })

  it('通过 file-dialog 检查并选择性导入实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(instance(def.id, INSTANCE_A, 'A'))
    await source.saveInstance(instance(def.id, INSTANCE_B, 'B'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })
    const dialog = new TestFileDialog(await encodeInterfaceZip(bundle), 'shared.lsinterface')

    const inspected = await inspectInterfaceFile(dialog)
    expect(inspected?.filename).toBe('shared.lsinterface')
    expect(inspected?.inspection.instances.map(({ instanceId }) => instanceId)).toEqual([
      INSTANCE_A,
      INSTANCE_B
    ])

    const imported = await importInterfaceFile(
      target,
      { mode: 'selected', instanceIds: [INSTANCE_B] },
      dialog
    )
    expect(imported).toEqual({
      filename: 'shared.lsinterface',
      interface: 'created',
      instances: { [INSTANCE_B]: 'created' }
    })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_B])
  })

  it('file-dialog 取消导入和导出时保留取消语义', async () => {
    const repository = setup().repository
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const dialog = new TestFileDialog(null)
    dialog.writeResult = false

    await expect(inspectInterfaceFile(dialog)).resolves.toBeNull()
    await expect(exportInterfaceFile(repository, def.id, { mode: 'none' }, dialog)).resolves.toBe(
      false
    )
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
    if (this.path.length > 0) this.data.scopes.add(this.key())
  }

  scope(name: string): MemoryStore {
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
    return `asset://local/${[...this.path, filename].join('/')}`
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
    private readonly readData: Uint8Array | null = null,
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

function isWithin(value: string, scope: string): boolean {
  return value === scope || value.startsWith(`${scope}/`) || value.startsWith(`${scope}::`)
}
