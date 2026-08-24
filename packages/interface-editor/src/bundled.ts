import { verifyInterfaceId } from './id'
import { isInterfaceDef } from './repository'
import type { InterfaceDef } from './types'
import { validateInterfaceDef } from './validation'

const CURRENT_FILE = 'current.json'
const INTERFACE_FILE = 'interface.json'
const BUILTIN_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export interface ReadonlyInterfaceStore {
  scope(name: string): ReadonlyInterfaceStore
  readText<T>(filename: string): Promise<T | null>
  listScopes(): Promise<string[]>
}

export interface BundledInterfaceEntry {
  builtinKey: string
  currentInterface: InterfaceDef
}

export interface BundledInterfaceSource {
  loadAll(): Promise<readonly BundledInterfaceEntry[]>
}

export class BundledInterfaceRepositoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundledInterfaceRepositoryError'
  }
}

/** Reads the immutable Interface releases shipped under resources/builtin. */
export class FileBundledInterfaceRepository implements BundledInterfaceSource {
  private readonly builtins: ReadonlyInterfaceStore

  constructor(root: ReadonlyInterfaceStore) {
    this.builtins = root.scope('builtin')
  }

  async loadAll(): Promise<readonly BundledInterfaceEntry[]> {
    const builtinKeys = await this.builtins.listScopes()
    const entries = await Promise.all(builtinKeys.map((builtinKey) => this.load(builtinKey)))
    return entries.sort((a, b) => a.builtinKey.localeCompare(b.builtinKey))
  }

  private async load(builtinKey: string): Promise<BundledInterfaceEntry> {
    if (!BUILTIN_KEY_PATTERN.test(builtinKey)) {
      throw new BundledInterfaceRepositoryError(`Bundled builtin key is invalid: ${builtinKey}`)
    }

    const builtinScope = this.builtins.scope(builtinKey)
    const current = await builtinScope.readText<unknown>(CURRENT_FILE)
    if (
      !isRecord(current) ||
      Reflect.ownKeys(current).length !== 2 ||
      current.builtinKey !== builtinKey ||
      typeof current.currentInterfaceId !== 'string'
    ) {
      throw new BundledInterfaceRepositoryError(
        `Bundled Interface current entry is invalid: ${builtinKey}`
      )
    }

    const digest = interfaceDigest(current.currentInterfaceId, builtinKey)
    const value = await builtinScope
      .scope('versions')
      .scope(digest)
      .readText<unknown>(INTERFACE_FILE)
    if (!isInterfaceDef(value) || !validateInterfaceDef(value).valid) {
      throw new BundledInterfaceRepositoryError(
        `Bundled Interface definition is invalid: ${builtinKey}`
      )
    }
    if (value.id !== current.currentInterfaceId || !(await verifyInterfaceId(value))) {
      throw new BundledInterfaceRepositoryError(
        `Bundled Interface content ID does not match: ${builtinKey}`
      )
    }

    return { builtinKey, currentInterface: structuredClone(value) }
  }
}

function interfaceDigest(interfaceId: string, builtinKey: string): string {
  const match = /^sha256:([0-9a-f]{64})$/.exec(interfaceId)
  if (!match) {
    throw new BundledInterfaceRepositoryError(
      `Bundled Interface current ID is invalid: ${builtinKey}`
    )
  }
  return match[1]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
