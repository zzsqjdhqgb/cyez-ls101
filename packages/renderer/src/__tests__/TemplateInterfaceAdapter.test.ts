import { describe, expect, it } from 'vitest'
import { createInterfaceApplication } from '@ls101/interface-editor'
import type { InterfaceFileDialog, InterfaceStore } from '@ls101/interface-editor/adapters'
import { FileInterfaceRepository } from '@ls101/interface-editor/adapters'
import { createTemplateInterfaceDependencies } from '../features/templates/TemplateInterfaceAdapter'

describe('Template Interface adapter', () => {
  it('uses the published manifest order and locates an instance globally', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const application = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const draft = await application.drafts.create({
      name: '有序题型',
      description: '',
      promptTemplate: '生成内容',
      fields: {
        order: ['second', 'first'],
        nodes: {
          first: {
            type: 'text',
            varName: 'firstValue',
            description: '第一项',
            example: 'A'
          },
          second: {
            type: 'image',
            varName: 'secondValue',
            description: '第二项',
            example: 'B'
          }
        }
      }
    })
    const published = await application.drafts.publish(draft.draftId)
    if (published.status === 'invalid') throw new Error('expected valid Interface content')
    const interfaceId = published.interface.interfaceId
    const instance = await application.published.createBlankInstance(interfaceId)
    const saved = await application.instances.save(interfaceId, instance.instance.instanceId, {
      name: '完整题组',
      values: instance.instance.values,
      imagePrompts: { secondValue: '操场上的学生' },
      imageFiles: {
        secondValue: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      }
    })
    const adapter = createTemplateInterfaceDependencies(application)

    await expect(adapter.listInterfaceManifests()).resolves.toEqual([
      {
        interfaceId,
        interfaceName: '有序题型',
        vars: [
          {
            varName: 'secondValue.inst',
            type: 'text',
            description: '第二项（图片提示词）',
            example: 'B',
            path: 'second'
          },
          {
            varName: 'secondValue.img',
            type: 'image',
            description: '第二项',
            example: 'B',
            path: 'second'
          },
          {
            varName: 'firstValue',
            type: 'text',
            description: '第一项',
            example: 'A',
            path: 'first'
          }
        ]
      }
    ])
    await expect(adapter.getInterfaceManifest(interfaceId)).resolves.toMatchObject({
      interfaceId,
      vars: [
        { varName: 'secondValue.inst', type: 'text', path: 'second' },
        { varName: 'secondValue.img', type: 'image', path: 'second' },
        { varName: 'firstValue', type: 'text', path: 'first' }
      ]
    })
    await expect(adapter.locateInterfaceInstance(saved.instance.instanceId)).resolves.toMatchObject(
      {
        interfaceId,
        instance: {
          values: {
            firstValue: '',
            'secondValue.inst': '操场上的学生',
            'secondValue.img': expect.stringMatching(/^secondValue-.*\.png$/)
          }
        },
        assetUrls: expect.objectContaining({
          [saved.instance.values.secondValue]: expect.stringContaining(
            saved.instance.values.secondValue
          )
        })
      }
    )
  })

  it('returns null for unknown Interface and instance IDs', async () => {
    const repository = new FileInterfaceRepository(new MemoryStore())
    const application = createInterfaceApplication({ repository, fileDialog: new TestFileDialog() })
    const adapter = createTemplateInterfaceDependencies(application)

    await expect(adapter.listInterfaceManifests()).resolves.toEqual([])
    await expect(adapter.getInterfaceManifest(`sha256:${'f'.repeat(64)}`)).resolves.toBeNull()
    await expect(
      adapter.locateInterfaceInstance('10000000-0000-4000-8000-000000000001')
    ).resolves.toBeNull()
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
    if (path.length > 0) this.data.scopes.add(this.key())
  }

  scope(name: string): MemoryStore {
    return new MemoryStore([...this.path, name], this.data)
  }

  async readText<T>(filename: string): Promise<T | null> {
    return (this.data.texts.get(this.fileKey(filename)) as T | undefined) ?? null
  }

  async writeText<T>(filename: string, data: T): Promise<void> {
    this.ensureScopes()
    this.data.texts.set(this.fileKey(filename), structuredClone(data))
  }

  async readAsset(filename: string): Promise<Uint8Array | null> {
    const data = this.data.assets.get(this.fileKey(filename))
    return data ? new Uint8Array(data) : null
  }

  async writeAsset(filename: string, data: Uint8Array): Promise<void> {
    this.ensureScopes()
    this.data.assets.set(this.fileKey(filename), new Uint8Array(data))
  }

  async listAssets(): Promise<string[]> {
    return this.listFiles(this.data.assets)
  }

  getAssetUrl(filename: string): string {
    return `asset://test/${[...this.path, filename].join('/')}`
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
    for (const key of [...this.data.texts.keys()]) {
      if (isWithin(key, prefix)) this.data.texts.delete(key)
    }
    for (const key of [...this.data.assets.keys()]) {
      if (isWithin(key, prefix)) this.data.assets.delete(key)
    }
    for (const key of [...this.data.scopes]) {
      if (isWithin(key, prefix)) this.data.scopes.delete(key)
    }
  }

  private listFiles(data: Map<string, unknown>): string[] {
    const prefix = `${this.key()}::`
    return [...data.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .sort()
  }

  private ensureScopes(): void {
    for (let index = 1; index <= this.path.length; index += 1) {
      this.data.scopes.add(this.path.slice(0, index).join('/'))
    }
  }

  private key(): string {
    return this.path.join('/')
  }

  private fileKey(filename: string): string {
    return `${this.key()}::${filename}`
  }
}

class TestFileDialog implements InterfaceFileDialog {
  async readBinary(): Promise<null> {
    return null
  }

  async writeBinary(): Promise<boolean> {
    return false
  }
}

function isWithin(value: string, scope: string): boolean {
  return value === scope || value.startsWith(`${scope}/`) || value.startsWith(`${scope}::`)
}
