import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceInstance, TaskProgressSnapshot } from '@ls101/core-types'
import {
  createInterfaceApplication,
  type InterfaceImageGenerator,
  type InterfaceTextGenerationChunk,
  type InterfaceTextGenerator,
  type InterfaceTextModelSelection
} from '../application'
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
import {
  applyBuiltinRemoval,
  applyBuiltinUpdate,
  classifyBuiltinUpdate,
  planBuiltinRemoval,
  planBuiltinUpdate
} from '../builtin'
import { createInterfaceDraft, publishInterface } from '../id'
import {
  FileInterfaceRepository,
  InterfaceRepositoryError,
  type InterfaceStore
} from '../repository'
import type { InterfaceContent } from '../types'
import { decodeInterfaceZip, encodeInterfaceZip } from '../zip'
import { strToU8, unzipSync, zipSync } from 'fflate'
import { collection } from './fieldFixtures'

afterEach(() => vi.unstubAllGlobals())

const INSTANCE_A = '10000000-0000-4000-8000-000000000001'
const INSTANCE_B = '10000000-0000-4000-8000-000000000002'

function content(name = '口语 Interface'): InterfaceContent {
  return {
    name,
    description: '用于测试',
    promptTemplate: '生成一套口语题',
    fields: collection({
      title: {
        type: 'text',
        varName: 'title',
        description: '标题',
        example: '模拟试卷'
      }
    })
  }
}

function contentWithImage(): InterfaceContent {
  return {
    ...content(),
    fields: collection({
      title: {
        type: 'text',
        varName: 'title',
        description: '标题',
        example: '模拟试卷'
      },
      picture: {
        type: 'image',
        varName: 'questionImage',
        description: '题目配图',
        example: '校园操场'
      }
    })
  }
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function instance(instanceId: string, title: string, name = `实例 ${title}`): InterfaceInstance {
  return {
    instanceId,
    name,
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
    const value = instance(INSTANCE_A, '第一套')

    expect(
      await repository.saveInstance(def.id, value, {
        'picture.png': new Uint8Array([1, 2, 3])
      })
    ).toBe('created')
    expect(await repository.getInstance(def.id, INSTANCE_A)).toEqual({
      instance: value,
      assetFilenames: ['picture.png']
    })
    expect(await repository.readInstanceAsset(def.id, INSTANCE_A, 'picture.png')).toEqual(
      new Uint8Array([1, 2, 3])
    )
    await expect(
      repository.getInstanceAssetUrl(def.id, INSTANCE_A, 'picture.png')
    ).resolves.toContain(`/published/${def.id.slice(7)}/instances/${INSTANCE_A}/picture.png`)
  })

  it('内容相同但 UUID 不同的实例作为两个实体保留', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)

    await repository.saveInstance(def.id, instance(INSTANCE_A, '相同内容'))
    await repository.saveInstance(def.id, instance(INSTANCE_B, '相同内容'))

    expect(await repository.listInstanceIds(def.id)).toEqual([INSTANCE_A, INSTANCE_B])
  })

  it('同 UUID、同内容去重，同 UUID、不同内容拒绝', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const original = instance(INSTANCE_A, '原始内容')

    await repository.saveInstance(def.id, original)
    expect(await repository.saveInstance(def.id, original)).toBe('existing')
    await expect(
      repository.saveInstance(def.id, instance(INSTANCE_A, '冲突内容'))
    ).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT' })
  })

  it('拒绝变量集合与 Interface 不一致的实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)

    await expect(
      repository.saveInstance(def.id, {
        ...instance(INSTANCE_A, '内容'),
        values: { unexpected: '值' }
      })
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('拒绝没有名称的实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)

    await expect(
      repository.saveInstance(def.id, instance(INSTANCE_A, '内容', '   '))
    ).rejects.toMatchObject({ code: 'INVALID_DATA' })
  })

  it('删除 Interface 时一并删除其实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    await repository.saveInstance(def.id, instance(INSTANCE_A, '内容'))

    await repository.deleteInterface(def.id)
    expect(await repository.getInterface(def.id)).toBeNull()
    expect(await repository.listInstanceIds(def.id)).toEqual([])
  })
})

describe('内置 Interface 更新', () => {
  it('首次安装时接管相同的已发布 Interface 并保留实例与资源', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    await repository.saveInstance(def.id, instance(INSTANCE_A, '已发布实例'), {
      'attachment.bin': new Uint8Array([4, 5, 6])
    })
    const references = { replaceInterfaceReferences: vi.fn().mockResolvedValue(undefined) }

    const result = await applyBuiltinUpdate(
      repository,
      references,
      await planBuiltinUpdate(repository, 'speaking', def)
    )

    expect(result).toMatchObject({
      kind: 'automatic',
      previousInterfaceId: null,
      currentInterfaceId: def.id
    })
    expect(await repository.listPublishedInterfaceIds()).toEqual([])
    expect(await repository.getBuiltin('speaking')).toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: def.id
    })
    expect(await repository.getInstance(def.id, INSTANCE_A)).toMatchObject({
      instance: { values: { title: '已发布实例' } }
    })
    expect(await repository.readInstanceAsset(def.id, INSTANCE_A, 'attachment.bin')).toEqual(
      new Uint8Array([4, 5, 6])
    )
    await expect(
      repository.getInstanceAssetUrl(def.id, INSTANCE_A, 'attachment.bin')
    ).resolves.toContain(`/builtin/speaking/versions/${def.id.slice('sha256:'.length)}/`)
    expect(references.replaceInterfaceReferences).not.toHaveBeenCalled()
  })

  it('语义字段变化自动迁移实例并删除旧内置版本', async () => {
    const { repository } = setup()
    const oldDef = await publishInterface(content())
    const nextDef = await publishInterface({
      ...content('新版名称'),
      description: '新版说明',
      promptTemplate: '新版提示词',
      fields: collection({
        title: {
          type: 'text',
          varName: 'title',
          description: '新版标题说明',
          example: '新版示例'
        }
      })
    })
    await repository.saveBuiltinInterface('speaking', oldDef)
    await repository.setBuiltinCurrent('speaking', oldDef.id)
    await repository.saveInstance(oldDef.id, instance(INSTANCE_A, '旧实例'), {
      'picture.png': new Uint8Array([1, 2, 3])
    })
    const migrated: Array<[string, string]> = []

    const plan = await planBuiltinUpdate(repository, 'speaking', nextDef)
    expect(plan.kind).toBe('automatic')
    const result = await applyBuiltinUpdate(
      repository,
      {
        async replaceInterfaceReferences(from, to) {
          migrated.push([from, to])
        }
      },
      plan
    )

    expect(result.migratedInstanceIds).toEqual([INSTANCE_A])
    expect(await repository.getInterface(oldDef.id)).toBeNull()
    expect(await repository.getInstance(nextDef.id, INSTANCE_A)).toMatchObject({
      instance: { instanceId: INSTANCE_A, values: { title: '旧实例' } }
    })
    expect(await repository.readInstanceAsset(nextDef.id, INSTANCE_A, 'picture.png')).toEqual(
      new Uint8Array([1, 2, 3])
    )
    expect(await repository.getBuiltin('speaking')).toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: nextDef.id
    })
    expect(migrated).toEqual([[oldDef.id, nextDef.id]])
  })

  it('结构变化可把旧版和实例物理备份到 published', async () => {
    const { repository } = setup()
    const oldDef = await publishInterface(content())
    const nextDef = await publishInterface({
      ...content(),
      fields: collection({
        section: {
          type: 'group',
          children: collection({
            heading: {
              type: 'text',
              varName: 'title',
              description: '标题',
              example: '模拟试卷'
            }
          })
        }
      })
    })
    await repository.saveBuiltinInterface('speaking', oldDef)
    await repository.setBuiltinCurrent('speaking', oldDef.id)
    await repository.saveInstance(oldDef.id, instance(INSTANCE_A, '旧实例'))
    const references: Array<[string, string]> = []

    const plan = await planBuiltinUpdate(repository, 'speaking', nextDef)
    expect(plan.kind).toBe('manual')
    const result = await applyBuiltinUpdate(
      repository,
      {
        async replaceInterfaceReferences(from, to) {
          references.push([from, to])
        }
      },
      plan,
      'backup-old'
    )

    expect(result.backedUpPrevious).toBe(true)
    expect(await repository.getInterface(oldDef.id)).toEqual(oldDef)
    expect(await repository.getInstance(oldDef.id, INSTANCE_A)).not.toBeNull()
    expect(await repository.listInstanceIds(nextDef.id)).toEqual([])
    await expect(
      repository.getInstanceAssetUrl(oldDef.id, INSTANCE_A, 'image.png')
    ).resolves.toContain(`/published/${oldDef.id.slice(7)}/instances/${INSTANCE_A}/image.png`)
    expect(await repository.getBuiltin('speaking')).toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: nextDef.id
    })
    expect(await repository.listPublishedInterfaceIds()).toContain(oldDef.id)
    expect(await repository.listBuiltinVersionIds('speaking')).toEqual([nextDef.id])
    expect(references).toEqual([])
  })

  it('禁止删除当前内置版本，也禁止发布与内置相同的内容', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)

    await expect(repository.deleteInterface(def.id)).rejects.toMatchObject({
      code: 'IDENTITY_CONFLICT'
    })
    await expect(repository.saveInterface(def)).rejects.toMatchObject({
      code: 'IDENTITY_CONFLICT'
    })
    expect(await repository.listBuiltinKeys()).toEqual(['speaking'])
  })

  it('结构变化可手动迁移，变量契约变化禁止更新', async () => {
    const oldDef = await publishInterface(content())
    const structural = await publishInterface({
      ...content(),
      fields: collection({
        group: {
          type: 'group',
          children: collection({
            title: content().fields.nodes.title
          })
        }
      })
    })
    const changedContract = await publishInterface({
      ...content(),
      fields: collection({
        title: {
          type: 'text',
          varName: 'renamedTitle',
          description: '标题',
          example: '模拟试卷'
        }
      })
    })

    expect(classifyBuiltinUpdate(oldDef, structural)).toBe('manual')
    expect(classifyBuiltinUpdate(oldDef, changedContract)).toBe('invalid-contract')

    const { repository } = setup()
    await repository.saveBuiltinInterface('speaking', oldDef)
    await repository.setBuiltinCurrent('speaking', oldDef.id)
    const plan = await planBuiltinUpdate(repository, 'speaking', changedContract)
    await expect(
      applyBuiltinUpdate(repository, { async replaceInterfaceReferences() {} }, plan)
    ).rejects.toThrow('changes its variable contract')
    expect(await repository.getBuiltin('speaking')).toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: oldDef.id
    })
  })

  it('结构变化选择迁移时保留实例 UUID并删除旧版', async () => {
    const { repository } = setup()
    const oldDef = await publishInterface(content())
    const nextDef = await publishInterface({
      ...content(),
      fields: collection({
        section: {
          type: 'group',
          children: collection({
            title: {
              type: 'text',
              varName: 'title',
              description: '标题',
              example: '模拟试卷'
            }
          })
        }
      })
    })
    await repository.saveBuiltinInterface('speaking', oldDef)
    await repository.setBuiltinCurrent('speaking', oldDef.id)
    await repository.saveInstance(oldDef.id, instance(INSTANCE_A, '待迁移'))
    const references: Array<[string, string]> = []

    const result = await applyBuiltinUpdate(
      repository,
      {
        async replaceInterfaceReferences(from, to) {
          references.push([from, to])
        }
      },
      await planBuiltinUpdate(repository, 'speaking', nextDef),
      'migrate'
    )

    expect(result.migratedInstanceIds).toEqual([INSTANCE_A])
    expect(await repository.getInterface(oldDef.id)).toBeNull()
    expect(await repository.getInstance(nextDef.id, INSTANCE_A)).toMatchObject({
      instance: { instanceId: INSTANCE_A, values: { title: '待迁移' } }
    })
    expect(references).toEqual([[oldDef.id, nextDef.id]])
  })

  it('删除内置 Interface 时可同时删除实例并报告受影响引用', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)
    await repository.saveInstance(def.id, instance(INSTANCE_A, '待删除'))
    const references = {
      async replaceInterfaceReferences() {},
      async countInterfaceReferences() {
        return 2
      }
    }

    const plan = await planBuiltinRemoval(repository, references, 'speaking')
    if (!plan) throw new Error('expected a removal plan')
    const result = await applyBuiltinRemoval(repository, plan, 'delete')

    expect(result).toMatchObject({
      affectedInstanceIds: [INSTANCE_A],
      affectedReferenceCount: 2,
      backedUpPrevious: false
    })
    expect(await repository.getBuiltin('speaking')).toBeNull()
    expect(await repository.getInterface(def.id)).toBeNull()
  })

  it('删除内置 Interface 时可将旧版和实例备份到 published', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)
    await repository.saveInstance(def.id, instance(INSTANCE_A, '待备份'))
    const references = {
      async replaceInterfaceReferences() {},
      async countInterfaceReferences() {
        return 1
      }
    }

    const plan = await planBuiltinRemoval(repository, references, 'speaking')
    if (!plan) throw new Error('expected a removal plan')
    const result = await applyBuiltinRemoval(repository, plan, 'backup-old')

    expect(result.backedUpPrevious).toBe(true)
    expect(await repository.getBuiltin('speaking')).toBeNull()
    expect(await repository.listPublishedInterfaceIds()).toContain(def.id)
    expect(await repository.getInstance(def.id, INSTANCE_A)).toMatchObject({
      instance: { values: { title: '待备份' } }
    })
  })
})

describe('Interface 交换包', () => {
  it('支持不附带、选择和附带全部实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    await repository.saveInstance(def.id, instance(INSTANCE_A, 'A'))
    await repository.saveInstance(def.id, instance(INSTANCE_B, 'B'))

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
    await source.saveInstance(def.id, instance(INSTANCE_A, 'A'), {
      'a.png': new Uint8Array([4, 5])
    })
    await source.saveInstance(def.id, instance(INSTANCE_B, 'B'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    const inspection = await inspectInterfacePackage(bundle)
    expect(inspection.instances).toHaveLength(2)
    expect(inspection.instances.map(({ name }) => name)).toEqual(['实例 A', '实例 B'])

    const result = await importInterfacePackage(target, bundle, {
      instances: { mode: 'selected', instanceIds: [INSTANCE_A] }
    })
    expect(result).toEqual({ interface: 'created', instances: { [INSTANCE_A]: 'created' } })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_A])
    expect(await target.readInstanceAsset(def.id, INSTANCE_A, 'a.png')).toEqual(
      new Uint8Array([4, 5])
    )
  })

  it('跳过已存在的 Interface 并继续导入新实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(def.id, instance(INSTANCE_A, 'A'))
    await source.saveInstance(def.id, instance(INSTANCE_B, 'B'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    await target.saveBuiltinInterface('speaking', def)
    await target.setBuiltinCurrent('speaking', def.id)
    await target.saveInstance(def.id, instance(INSTANCE_A, 'A'))
    const result = await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })

    expect(result).toEqual({
      interface: 'skipped-existing',
      instances: { [INSTANCE_A]: 'existing', [INSTANCE_B]: 'created' }
    })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_A, INSTANCE_B])
    expect(await target.listPublishedInterfaceIds()).toEqual([])
  })

  it('不同 UUID 的相同实例内容在导入时全部保留', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(def.id, instance(INSTANCE_A, '相同'))
    await source.saveInstance(def.id, instance(INSTANCE_B, '相同'))
    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })

    await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })
    expect(await target.listInstanceIds(def.id)).toEqual([INSTANCE_A, INSTANCE_B])
  })

  it('导入旧版包时跳过已迁移到其他 Interface 的同一实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const oldDef = await publishInterface(content('旧版'))
    const newDef = await publishInterface(content('新版'))
    await source.saveInterface(oldDef)
    await source.saveInstance(oldDef.id, instance(INSTANCE_A, '相同实例'))
    const bundle = await exportInterfacePackage(source, oldDef.id, { mode: 'all' })

    await target.saveInterface(newDef)
    await target.saveInstance(newDef.id, instance(INSTANCE_A, '相同实例'))
    const result = await importInterfacePackage(target, bundle, { instances: { mode: 'all' } })

    expect(result).toEqual({
      interface: 'created',
      instances: { [INSTANCE_A]: 'skipped-other-interface' }
    })
    expect(await target.getInstance(oldDef.id, INSTANCE_A)).toBeNull()
    expect(await target.getInstance(newDef.id, INSTANCE_A)).not.toBeNull()
  })

  it('导入前发现实例冲突，不写入包内其他实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(def.id, instance(INSTANCE_A, '来源内容'))
    await source.saveInstance(def.id, instance(INSTANCE_B, '待导入'))
    await target.saveInterface(def)
    await target.saveInstance(def.id, instance(INSTANCE_A, '本地冲突内容'))
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
    await source.saveInstance(def.id, instance(INSTANCE_A, 'A'), {
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
      version: 2,
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
    await source.saveInstance(def.id, instance(INSTANCE_A, 'A'))
    await source.saveInstance(def.id, instance(INSTANCE_B, 'B'))
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

describe('Interface application', () => {
  it('导入会话报告 Interface 跳过状态并继续导入新实例', async () => {
    const source = setup().repository
    const target = setup().repository
    const def = await publishInterface(content())
    await source.saveInterface(def)
    await source.saveInstance(def.id, instance(INSTANCE_A, 'A'))
    await source.saveInstance(def.id, instance(INSTANCE_B, 'B'))
    await target.saveInterface(def)
    await target.saveInstance(def.id, instance(INSTANCE_A, 'A'))

    const bundle = await exportInterfacePackage(source, def.id, { mode: 'all' })
    const app = createInterfaceApplication({
      repository: target,
      fileDialog: new TestFileDialog(await encodeInterfaceZip(bundle))
    })
    const session = await app.transfer.beginImport()
    if (!session) throw new Error('Expected an import session')

    await expect(session.commit({ mode: 'all' })).resolves.toEqual({
      interfaceId: def.id,
      interfaceStatus: 'skipped-existing',
      importedInstanceIds: [INSTANCE_B],
      skippedInstanceIds: [INSTANCE_A]
    })
  })

  it('按五个 UI 模块浏览、复制和发布 Interface', async () => {
    const { repository } = setup()
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })
    const draft = await app.drafts.create(content())

    expect(await app.browser.listDrafts()).toEqual([
      { draftId: draft.draftId, name: draft.name, description: draft.description }
    ])
    const published = await app.drafts.publish(draft.draftId)
    expect(published.status).toBe('published')
    if (published.status === 'invalid') throw new Error('Unexpected invalid draft')

    expect(await app.browser.listPublished()).toEqual([published.interface])
    expect((await app.published.get(published.interface.interfaceId))?.definition.name).toBe(
      draft.name
    )
    const prompts = await app.published.getPrompts(published.interface.interfaceId)
    expect(prompts.prompt).toBe(draft.promptTemplate)
    expect(prompts.fullPrompt).toContain(draft.promptTemplate)
    expect(JSON.parse(prompts.jsonSchema)).toMatchObject({
      type: 'object',
      properties: { title: { type: 'string' } }
    })
    expect(JSON.parse(prompts.jsonExample)).toEqual({ title: '模拟试卷' })
    const copy = await app.published.copyToDraft(published.interface.interfaceId)
    expect(copy.draftId).not.toBe(draft.draftId)
    expect(copy.fields).toEqual(draft.fields)
  })

  it('从内置 Interface 复制的未修改草稿发布为已存在内容', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveBuiltinInterface('speaking', def)
    await repository.setBuiltinCurrent('speaking', def.id)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })

    const draft = await app.published.copyToDraft(def.id)
    const result = await app.drafts.publish(draft.draftId)

    expect(result).toMatchObject({
      status: 'already-published',
      interface: { interfaceId: def.id, source: { type: 'builtin', builtinKey: 'speaking' } }
    })
  })

  it('创建正式空白实例并以整表保存和 JSON 导入覆盖同一 UUID', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })

    const blank = await app.published.createBlankInstance(def.id)
    expect(blank.instance.instanceId).toMatch(/^[0-9a-f-]{36}$/)
    expect(blank.instance.name).toBe('未命名题组')
    expect(blank.instance.values).toEqual({ title: '' })

    const saved = await app.instances.save(def.id, blank.instance.instanceId, {
      name: '第一套口语题',
      values: { title: '手动值' }
    })
    expect(saved.instance).toMatchObject({
      instanceId: blank.instance.instanceId,
      name: '第一套口语题',
      values: { title: '手动值' }
    })
    await expect(app.published.listInstances(def.id)).resolves.toEqual([
      {
        instanceId: blank.instance.instanceId,
        name: '第一套口语题',
        generatedAt: blank.instance.generatedAt
      }
    ])

    const invalid = await app.instances.replaceFromJson(
      def.id,
      blank.instance.instanceId,
      '{broken'
    )
    expect(invalid.status).toBe('invalid-json')
    expect((await app.instances.get(def.id, blank.instance.instanceId))?.instance.values).toEqual({
      title: '手动值'
    })
    expect((await app.instances.get(def.id, blank.instance.instanceId))?.instance.name).toBe(
      '第一套口语题'
    )

    const replaced = await app.instances.replaceFromJson(
      def.id,
      blank.instance.instanceId,
      '{"title":"JSON 值"}'
    )
    expect(replaced.status).toBe('replaced')
    if (replaced.status === 'replaced') {
      expect(replaced.instance.instance).toMatchObject({
        instanceId: blank.instance.instanceId,
        name: '第一套口语题',
        values: { title: 'JSON 值' }
      })
    }
  })

  it('手动保存图片字段时同时保留提示词并向下游暴露资源文件名', async () => {
    const { repository } = setup()
    const def = await publishInterface(contentWithImage())
    await repository.saveInterface(def)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })
    const blank = await app.published.createBlankInstance(def.id)

    const saved = await app.instances.save(def.id, blank.instance.instanceId, {
      name: '图片题组',
      values: { title: '看图回答', questionImage: '' },
      imagePrompts: { questionImage: '一名学生站在操场上' },
      imageFiles: { questionImage: PNG_BYTES }
    })

    const filename = saved.instance.values.questionImage
    expect(filename).toMatch(/^questionImage-[0-9a-f-]{36}\.png$/)
    expect(saved.instance.imagePrompts).toEqual({ questionImage: '一名学生站在操场上' })
    expect(saved.assetUrls[filename]).toContain(filename)
    await expect(
      repository.readInstanceAsset(def.id, blank.instance.instanceId, filename)
    ).resolves.toEqual(PNG_BYTES)
  })

  it('提示词与图片独立更新，显式移除图片时仍保留提示词', async () => {
    const { repository } = setup()
    const def = await publishInterface(contentWithImage())
    await repository.saveInterface(def)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })
    const blank = await app.published.createBlankInstance(def.id)
    const withImage = await app.instances.save(def.id, blank.instance.instanceId, {
      name: '图片题组',
      values: { title: '看图回答', questionImage: '' },
      imagePrompts: { questionImage: '初始提示词' },
      imageFiles: { questionImage: PNG_BYTES }
    })
    const previousFilename = withImage.instance.values.questionImage

    const withPrompt = await app.instances.save(def.id, blank.instance.instanceId, {
      name: '图片题组',
      values: withImage.instance.values,
      imagePrompts: { questionImage: '一名学生站在操场上' }
    })

    expect(withPrompt.instance.values.questionImage).toBe(previousFilename)
    expect(withPrompt.instance.imagePrompts).toEqual({
      questionImage: '一名学生站在操场上'
    })
    expect(withPrompt.assetUrls[previousFilename]).toContain(previousFilename)

    await expect(
      app.instances.save(def.id, blank.instance.instanceId, {
        name: '图片题组',
        values: withPrompt.instance.values,
        imagePrompts: withPrompt.instance.imagePrompts,
        imageFiles: { questionImage: null }
      })
    ).rejects.toThrow('提示词和图片必须同时填写')
    await expect(
      repository.readInstanceAsset(def.id, blank.instance.instanceId, previousFilename)
    ).resolves.toEqual(PNG_BYTES)
  })

  it('JSON 覆盖更新图片提示词但保留已绑定的图片值', async () => {
    const { repository } = setup()
    const def = await publishInterface(contentWithImage())
    await repository.saveInterface(def)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })
    const blank = await app.published.createBlankInstance(def.id)
    const withImage = await app.instances.save(def.id, blank.instance.instanceId, {
      name: '图片题组',
      values: { title: '旧标题', questionImage: '' },
      imagePrompts: { questionImage: '旧提示词' },
      imageFiles: { questionImage: PNG_BYTES }
    })
    const filename = withImage.instance.values.questionImage

    const replaced = await app.instances.replaceFromJson(
      def.id,
      blank.instance.instanceId,
      '{"title":"JSON 标题","picture":"JSON 图片提示词"}'
    )

    expect(replaced.status).toBe('replaced')
    if (replaced.status === 'replaced') {
      expect(replaced.instance.instance.values).toEqual({
        title: 'JSON 标题',
        questionImage: filename
      })
      expect(replaced.instance.instance.imagePrompts).toEqual({
        questionImage: 'JSON 图片提示词'
      })
      expect(replaced.instance.assetUrls[filename]).toContain(filename)
    }
  })

  it('拒绝非图片内容且不修改实例', async () => {
    const { repository } = setup()
    const def = await publishInterface(contentWithImage())
    await repository.saveInterface(def)
    const app = createInterfaceApplication({ repository, fileDialog: new TestFileDialog(null) })
    const blank = await app.published.createBlankInstance(def.id)

    await expect(
      app.instances.save(def.id, blank.instance.instanceId, {
        name: '图片题组',
        values: { title: '看图回答', questionImage: '' },
        imageFiles: { questionImage: new TextEncoder().encode('not an image') }
      })
    ).rejects.toThrow('Only PNG, JPEG, GIF, and WebP images are supported')
    expect((await app.instances.get(def.id, blank.instance.instanceId))?.instance.values).toEqual({
      title: '',
      questionImage: ''
    })
  })

  it('在 Electron CSP 下以扁平流式任务句柄展示 AI 过程并覆盖当前实例', async () => {
    vi.stubGlobal('Function', function blockedFunctionConstructor(): never {
      throw new Error('unsafe-eval blocked by CSP')
    })
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const generator = new TestTextGenerator()
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(null),
      textGenerator: generator
    })
    const blank = await app.published.createBlankInstance(def.id)
    await app.instances.save(def.id, blank.instance.instanceId, {
      name: 'AI 生成前名称',
      values: blank.instance.values
    })

    const selectedModel = { providerId: 'provider-a', modelId: 'model-b' }
    const handle = await app.instances.startAIGeneration(def.id, blank.instance.instanceId, {
      model: selectedModel
    })
    const snapshots: TaskProgressSnapshot[] = []
    handle.subscribe(() => snapshots.push(handle.getSnapshot()))
    generator.append('正在构造 JSON')
    generator.complete('{"title":"AI 值"}')

    const result = await handle.completion
    expect(result.status).toBe('completed')
    expect(generator.selectedModel).toEqual(selectedModel)
    expect(snapshots.some(({ items }) => items[0].log?.content.includes('正在构造'))).toBe(true)
    expect(handle.getSnapshot().items.map(({ status }) => status)).toEqual([
      'completed',
      'completed',
      'completed'
    ])
    expect((await app.instances.get(def.id, blank.instance.instanceId))?.instance.values).toEqual({
      title: 'AI 值'
    })
    expect((await app.instances.get(def.id, blank.instance.instanceId))?.instance.name).toBe(
      'AI 生成前名称'
    )
  })

  it('accepts a JSON code fence around an otherwise valid AI response', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const generator = new TestTextGenerator()
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(null),
      textGenerator: generator
    })
    const blank = await app.published.createBlankInstance(def.id)
    const handle = await app.instances.startAIGeneration(def.id, blank.instance.instanceId)

    generator.complete('```json\n{"title":"代码围栏内容"}\n```')

    await expect(handle.completion).resolves.toMatchObject({ status: 'completed' })
    await expect(app.instances.get(def.id, blank.instance.instanceId)).resolves.toMatchObject({
      instance: { values: { title: '代码围栏内容' } }
    })
  })

  it('AI 运行时拒绝第二个生成、整表保存和 JSON 覆盖', async () => {
    const { repository } = setup()
    const def = await publishInterface(content())
    await repository.saveInterface(def)
    const generator = new TestTextGenerator()
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(null),
      textGenerator: generator
    })
    const blank = await app.published.createBlankInstance(def.id)
    const handle = await app.instances.startAIGeneration(def.id, blank.instance.instanceId)

    await expect(
      app.instances.startAIGeneration(def.id, blank.instance.instanceId)
    ).rejects.toThrow('Instance is busy')
    await expect(
      app.instances.save(def.id, blank.instance.instanceId, {
        name: '手动名称',
        values: { title: '手动值' }
      })
    ).rejects.toThrow('Instance is busy')
    await expect(
      app.instances.replaceFromJson(def.id, blank.instance.instanceId, '{"title":"JSON 值"}')
    ).rejects.toThrow('Instance is busy')

    generator.complete('{"title":"AI 值"}')
    await handle.completion
  })

  it('在文本校验后生成图片并原子保存提示词和资源', async () => {
    const { repository } = setup()
    const def = await publishInterface(contentWithImage())
    await repository.saveInterface(def)
    const textGenerator = new TestTextGenerator()
    const selectedImageProvider = { providerId: 'manual-provider' }
    const imageGenerator: InterfaceImageGenerator = {
      listProviders: vi
        .fn()
        .mockResolvedValue([{ ...selectedImageProvider, providerName: '手动生成' }]),
      generate: vi.fn().mockResolvedValue({ data: PNG_BYTES })
    }
    const app = createInterfaceApplication({
      repository,
      fileDialog: new TestFileDialog(null),
      textGenerator,
      imageGenerator
    })
    const blank = await app.published.createBlankInstance(def.id)
    await expect(app.instances.listImageGenerationProviders()).resolves.toEqual([
      { providerId: 'manual-provider', providerName: '手动生成' }
    ])
    const handle = await app.instances.startAIGeneration(def.id, blank.instance.instanceId, {
      imageProvider: selectedImageProvider
    })
    textGenerator.complete('{"title":"AI 图片题","picture":"学生在校园操场上跑步"}')

    const result = await handle.completion
    expect(result.status).toBe('completed')
    expect(imageGenerator.generate).toHaveBeenCalledWith('学生在校园操场上跑步', {
      signal: expect.any(AbortSignal),
      provider: selectedImageProvider
    })
    expect(handle.getSnapshot().items.map((item) => item.label)).toEqual([
      'AI 生成',
      '校验生成结果',
      '生成图片：questionImage',
      '保存实例'
    ])
    const details = await app.instances.get(def.id, blank.instance.instanceId)
    expect(details?.instance.values.title).toBe('AI 图片题')
    expect(details?.instance.imagePrompts).toEqual({
      questionImage: '学生在校园操场上跑步'
    })
    const filename = details?.instance.values.questionImage ?? ''
    expect(filename).toMatch(/^questionImage-[0-9a-f-]{36}\.png$/)
    expect(await repository.readInstanceAsset(def.id, blank.instance.instanceId, filename)).toEqual(
      PNG_BYTES
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

class TestTextGenerator implements InterfaceTextGenerator {
  private readonly chunks: InterfaceTextGenerationChunk[] = []
  private finished = false
  private wake: (() => void) | null = null
  selectedModel: InterfaceTextModelSelection | null = null

  async *generate(
    _prompt: string,
    options: { signal: AbortSignal; model?: InterfaceTextModelSelection }
  ): AsyncIterable<InterfaceTextGenerationChunk> {
    this.selectedModel = options.model ?? null
    while (!this.finished || this.chunks.length > 0) {
      if (options.signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const chunk = this.chunks.shift()
      if (chunk) {
        yield chunk
        continue
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve
        options.signal.addEventListener('abort', () => resolve(), { once: true })
      })
    }
  }

  append(content: string): void {
    this.chunks.push({ type: 'reasoning', delta: content })
    this.wake?.()
    this.wake = null
  }

  complete(text: string): void {
    this.chunks.push({ type: 'output', delta: text })
    this.finished = true
    this.wake?.()
    this.wake = null
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
