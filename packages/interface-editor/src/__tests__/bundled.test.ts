import { describe, expect, it } from 'vitest'
import { createBuiltinInterfaceApplication } from '../builtin-entry'
import {
  BundledInterfaceRepositoryError,
  FileBundledInterfaceRepository,
  type ReadonlyInterfaceStore
} from '../bundled'
import { publishInterface } from '../id'
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
