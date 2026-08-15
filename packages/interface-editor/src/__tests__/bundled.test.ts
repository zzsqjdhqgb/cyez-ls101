import { describe, expect, it } from 'vitest'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createBuiltinInterfaceApplication } from '../builtin-entry'
import {
  BundledInterfaceRepositoryError,
  FileBundledInterfaceRepository,
  type ReadonlyInterfaceStore
} from '../bundled'
import { publishInterface } from '../id'
import { flattenFields } from '../queries'
import { FileInterfaceRepository, type InterfaceStore } from '../repository'
import type { InterfaceContent, InterfaceDef } from '../types'

const content: InterfaceContent = {
  name: '口语题型',
  description: '内置题型',
  promptTemplate: '生成口语题',
  fields: {
    order: ['title'],
    nodes: {
      title: {
        type: 'text',
        varName: 'title',
        description: '标题',
        example: '校园生活'
      }
    }
  }
}

describe('bundled Interface repository', () => {
  it('加载上海高考英语口语 builtin 并覆盖旧模板的全部 editableData', async () => {
    const repository = new FileBundledInterfaceRepository(
      new DiskReadonlyStore('resources/builtin/interface-editor')
    )

    const entries = await repository.loadAll()
    const entry = entries.find(({ builtinKey }) => builtinKey === 'shanghai-gaokao-speaking')
    expect(entry?.currentInterface).toMatchObject({
      id: 'sha256:a53e4092e675dcf366ffe5f9c3fa06ad213923ea3ced42ea3b6ee640919d9d14',
      name: '上海高考英语口语'
    })
    if (!entry) throw new Error('expected Shanghai Gaokao speaking builtin')
    expect(entry.currentInterface.promptTemplate).toContain('100至150词')
    expect(entry.currentInterface.promptTemplate).toContain('适合约1分钟陈述')
    expect(entry.currentInterface.promptTemplate).not.toContain('适合约1.5分钟陈述')
    expect(entry.currentInterface.promptTemplate).toContain(
      '不要为学生生成评分、训练建议或作答反馈'
    )
    expect(entry.currentInterface.promptTemplate).toContain("As far as I'm concerned")
    expect(entry.currentInterface.promptTemplate).toContain('In the foreground/background')
    expect(entry.currentInterface.promptTemplate).toContain('明确包含1:1正方形画幅要求')

    const leaves = flattenFields(entry.currentInterface.fields)
    const leavesByVarName = new Map(leaves.map(({ leaf }) => [leaf.varName, leaf]))
    const legacyFields = await loadLegacyShanghaiGaokaoFields()
    expect(leaves.map(({ leaf }) => leaf.varName).sort()).toEqual(
      legacyFields.map(({ id }) => id).sort()
    )
    expect(
      leaves.filter(({ leaf }) => leaf.type === 'image').map(({ leaf }) => leaf.varName)
    ).toEqual(['picture_file1', 'picture_file2', 'picture_file3', 'picture_file4'])
    expect(leavesByVarName.get('passage_1')?.description).toContain('不要求在30秒内读完')
    expect(leavesByVarName.get('picture_start')?.example).toBe('It was Sunday morning.')
    for (const varName of ['picture_file1', 'picture_file2', 'picture_file3', 'picture_file4']) {
      expect(leavesByVarName.get(varName)?.example).not.toMatch(/[\u3400-\u9fff]/u)
      expect(leavesByVarName.get(varName)?.description).toContain('1:1正方形画幅')
      expect(leavesByVarName.get(varName)?.example).toContain('square 1:1 aspect ratio')
    }
    expect(legacyFields).toHaveLength(27)
  })

  it('加载上海中考英语口语 builtin 并覆盖旧模板的全部 editableData', async () => {
    const repository = new FileBundledInterfaceRepository(
      new DiskReadonlyStore('resources/builtin/interface-editor')
    )

    const entries = await repository.loadAll()
    const entry = entries.find(({ builtinKey }) => builtinKey === 'shanghai-zhongkao-speaking')
    expect(entry?.currentInterface).toMatchObject({
      id: 'sha256:fd1bd229ebd711dce3655bdc3a4b41a9ecb93ce273b7643307a726ae403cc884',
      name: '上海中考英语口语'
    })
    if (!entry) throw new Error('expected Shanghai Zhongkao speaking builtin')
    expect(entry.currentInterface.promptTemplate).toContain('朗读词组')
    expect(entry.currentInterface.promptTemplate).toContain('听后复述')
    expect(entry.currentInterface.promptTemplate).toContain('no text')

    const leaves = flattenFields(entry.currentInterface.fields)
    const legacyFields = await loadLegacyFields('templates/SH-zhongkao-speaking/chunk')
    expect(leaves.map(({ leaf }) => leaf.varName).sort()).toEqual(
      legacyFields.map(({ id }) => id).sort()
    )
    expect(
      leaves.filter(({ leaf }) => leaf.type === 'image').map(({ leaf }) => leaf.varName)
    ).toEqual(['3_picture', '4_picture'])
    for (const { leaf } of leaves.filter(({ leaf }) => leaf.type === 'image')) {
      expect(leaf.example).not.toMatch(/[\u3400-\u9fff]/u)
      expect(leaf.example).toContain('no text')
    }
    expect(legacyFields).toHaveLength(16)
  })

  it('加载上海高考英语听力 builtin 并覆盖完整卷的全部 editableData', async () => {
    const repository = new FileBundledInterfaceRepository(
      new DiskReadonlyStore('resources/builtin/interface-editor')
    )

    const entries = await repository.loadAll()
    const entry = entries.find(({ builtinKey }) => builtinKey === 'shanghai-gaokao-listening')
    expect(entry?.currentInterface).toMatchObject({
      id: 'sha256:03e00d7f007b7b2281e13429ec89220d3d5abfa218f1f953f0d3c64ff1489838',
      name: '上海高考英语听力'
    })
    if (!entry) throw new Error('expected Shanghai Gaokao listening builtin')
    expect(entry.currentInterface.promptTemplate).toContain('10段短对话')
    expect(entry.currentInterface.promptTemplate).toContain('只有一个无争议的最佳答案')
    expect(entry.currentInterface.promptTemplate).toContain('“[Man]:”或“[Woman]:”')
    expect(entry.currentInterface.fields.order).toEqual([
      'shortDialogues',
      'passages',
      'longConversation'
    ])

    const leaves = flattenFields(entry.currentInterface.fields)
    const legacyFields = await loadLegacyTemplateFields('templates/gaokao-listening/template.json')
    expect(leaves.map(({ leaf }) => leaf.varName).sort()).toEqual(
      legacyFields.map(({ id }) => id).sort()
    )
    expect(leaves.every(({ leaf }) => leaf.type === 'text')).toBe(true)
    const dialogues = leaves.filter(({ leaf }) => leaf.varName.startsWith('dialogue_'))
    expect(dialogues).toHaveLength(11)
    for (const { leaf } of dialogues) {
      expect(leaf.example.split('\n').every((line) => /^\[(Man|Woman)\]: /.test(line))).toBe(true)
    }
    const answers = leaves.filter(({ leaf }) => leaf.varName.startsWith('answer_'))
    expect(answers).toHaveLength(20)
    expect(new Set(answers.map(({ leaf }) => leaf.example))).toEqual(new Set(['A', 'B', 'C', 'D']))
    expect(legacyFields).toHaveLength(133)
  })

  it('按 builtinKey 和内容摘要读取独立 Interface 文件', async () => {
    const def = await publishInterface(content)
    const store = bundledStore('speaking', def)
    const repository = new FileBundledInterfaceRepository(store.scope('interface-editor'))

    await expect(repository.loadAll()).resolves.toEqual([
      { builtinKey: 'speaking', currentInterface: def }
    ])
  })

  it('拒绝 current ID 与 Interface 内容不一致的 bundled 仓储', async () => {
    const def = await publishInterface(content)
    const store = bundledStore('speaking', { ...def, name: '被篡改' })
    const repository = new FileBundledInterfaceRepository(store.scope('interface-editor'))

    await expect(repository.loadAll()).rejects.toBeInstanceOf(BundledInterfaceRepositoryError)
  })

  it('完整读取 bundled 仓储后自动安装兼容项并返回删除计划', async () => {
    const installed = await publishInterface({ ...content, name: '已移除题型' })
    const bundled = await publishInterface(content)
    const writable = new MemoryStore()
    const repository = new FileInterfaceRepository(writable.scope('interfaces'))
    await repository.saveBuiltinInterface('removed', installed)
    await repository.setBuiltinCurrent('removed', installed.id)
    await repository.saveInterface(bundled)
    const application = createBuiltinInterfaceApplication({
      repository,
      references: {
        async replaceInterfaceReferences() {},
        async countInterfaceReferences(interfaceId) {
          return interfaceId === installed.id ? 1 : 0
        }
      }
    })

    const result = await application.reconcile(
      new FileBundledInterfaceRepository(
        bundledStore('speaking', bundled).scope('interface-editor')
      )
    )

    expect(result.applied).toEqual([
      expect.objectContaining({ kind: 'automatic', currentInterfaceId: bundled.id })
    ])
    await expect(repository.listPublishedInterfaceIds()).resolves.toEqual([])
    await expect(repository.getBuiltin('speaking')).resolves.toEqual({
      builtinKey: 'speaking',
      currentInterfaceId: bundled.id
    })
    expect(result.pending).toEqual([
      expect.objectContaining({
        kind: 'removal',
        builtinKey: 'removed',
        referenceCount: 1
      })
    ])
  })

  it('任一 bundled Interface 损坏时不会安装前面的有效 Interface', async () => {
    const valid = await publishInterface(content)
    const invalid = { ...valid, name: '损坏内容' }
    const bundled = bundledStore('a-valid', valid)
    addBundled(bundled, 'z-invalid', invalid)
    const writable = new MemoryStore()
    const repository = new FileInterfaceRepository(writable.scope('interfaces'))
    const application = createBuiltinInterfaceApplication({
      repository,
      references: {
        async replaceInterfaceReferences() {},
        async countInterfaceReferences() {
          return 0
        }
      }
    })

    await expect(
      application.reconcile(new FileBundledInterfaceRepository(bundled.scope('interface-editor')))
    ).rejects.toBeInstanceOf(BundledInterfaceRepositoryError)
    await expect(repository.listBuiltinKeys()).resolves.toEqual([])
  })
})

const LEGACY_CHUNKS = [
  '01_sectionA_reading.json',
  '02_sectionB_passage.json',
  '03_sectionC_situation.json',
  '04_sectionD_picture.json',
  '05_LS_sectionA_quickresponse.json',
  '06_LS_sectionB_passage.json'
]

async function loadLegacyShanghaiGaokaoFields(): Promise<Array<{ id: string; type: string }>> {
  const fields = await Promise.all(
    LEGACY_CHUNKS.map(async (filename) => {
      const value = JSON.parse(
        await readFile(path.join('templates/SH-gaokao-speaking/chunk', filename), 'utf8')
      ) as { editableData: Array<{ id: string; type: string }> }
      return value.editableData
    })
  )
  return fields.flat()
}

async function loadLegacyFields(directory: string): Promise<Array<{ id: string; type: string }>> {
  const filenames = (await readdir(directory))
    .filter((filename) => filename.endsWith('.json'))
    .sort()
  const fields = await Promise.all(
    filenames.map(async (filename) => {
      const value = JSON.parse(await readFile(path.join(directory, filename), 'utf8')) as {
        editableData: Array<{ id: string; type: string }>
      }
      return value.editableData
    })
  )
  return fields.flat()
}

async function loadLegacyTemplateFields(
  filename: string
): Promise<Array<{ id: string; type: string }>> {
  const value = JSON.parse(await readFile(filename, 'utf8')) as {
    editableData: Array<{ id: string; type: string }>
  }
  return value.editableData
}

function bundledStore(builtinKey: string, def: InterfaceDef): MemoryStore {
  const store = new MemoryStore()
  addBundled(store, builtinKey, def)
  return store
}

function addBundled(store: MemoryStore, builtinKey: string, def: InterfaceDef): void {
  const base = store.scope('interface-editor').scope('builtin').scope(builtinKey)
  base.setText('current.json', { builtinKey, currentInterfaceId: def.id })
  base.scope('versions').scope(def.id.slice('sha256:'.length)).setText('interface.json', def)
}

class MemoryStore implements InterfaceStore, ReadonlyInterfaceStore {
  constructor(
    private readonly texts = new Map<string, unknown>(),
    private readonly scopes = new Set<string>(),
    private readonly path: string[] = []
  ) {}

  scope(name: string): MemoryStore {
    const next = new MemoryStore(this.texts, this.scopes, [...this.path, name])
    this.scopes.add(next.scopeKey())
    return next
  }

  setText(filename: string, value: unknown): void {
    this.texts.set(this.key(filename), structuredClone(value))
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (structuredClone(this.texts.get(this.key(filename))) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.setText(filename, data)
  }

  async readAsset(): Promise<Uint8Array | null> {
    return null
  }

  async writeAsset(): Promise<void> {}

  async listAssets(): Promise<string[]> {
    return []
  }

  getAssetUrl(filename: string): string {
    return `memory://${this.key(filename)}`
  }

  async listScopes(): Promise<string[]> {
    const prefix = this.scopeKey() ? `${this.scopeKey()}/` : ''
    const children = new Set<string>()
    for (const scope of this.scopes) {
      if (!scope.startsWith(prefix)) continue
      const remainder = scope.slice(prefix.length)
      if (remainder && !remainder.includes('/')) children.add(remainder)
    }
    return [...children].sort()
  }

  async clear(): Promise<void> {
    const prefix = `${this.scopeKey()}/`
    for (const key of this.texts.keys()) {
      if (key.startsWith(prefix)) this.texts.delete(key)
    }
    for (const scope of this.scopes) {
      if (scope === this.scopeKey() || scope.startsWith(prefix)) this.scopes.delete(scope)
    }
  }

  private key(filename: string): string {
    return `${this.scopeKey()}/${filename}`
  }

  private scopeKey(): string {
    return this.path.join('/')
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
