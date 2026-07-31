import type { InterfaceInstance } from '@ls101/core-types'
import { compareInterfaceIdentity, isInterfaceId, verifyInterfaceId } from './id'
import {
  InterfaceRepositoryError,
  type InterfaceRepository,
  type LocatedInterfaceInstance,
  type SaveEntityResult
} from './repository'
import type { InterfaceDef } from './types'

export type InstanceSelection =
  | { mode: 'none' }
  | { mode: 'all' }
  | { mode: 'selected'; instanceIds: readonly string[] }

export interface InterfaceExchangeInstance {
  instance: InterfaceInstance
  assets: Record<string, Uint8Array>
}

export interface InterfaceExchangePackage {
  format: 'ls101-interface'
  version: 2
  exportedAt: string
  interface: InterfaceDef
  instances: InterfaceExchangeInstance[]
}

export interface InterfacePackageInspection {
  interface: InterfaceDef
  instances: Array<{
    instanceId: string
    name: string
    generatedAt: string
    assetFilenames: string[]
  }>
}

export interface InterfacePackageImportOptions {
  instances: InstanceSelection
}

export type InterfaceDefinitionImportResult = 'created' | 'skipped-existing'

export interface InterfacePackageImportResult {
  interface: InterfaceDefinitionImportResult
  instances: Record<string, SaveEntityResult | 'skipped-other-interface'>
}

/** 构建与具体 ZIP 库无关的交换包，Electron 适配层负责将它编码为文件。 */
export async function exportInterfacePackage(
  repository: InterfaceRepository,
  interfaceId: string,
  selection: InstanceSelection
): Promise<InterfaceExchangePackage> {
  const def = await repository.getInterface(interfaceId)
  if (!def) throw new InterfaceRepositoryError('NOT_FOUND', `Interface not found: ${interfaceId}`)

  const instanceIds = await resolveExportSelection(repository, interfaceId, selection)
  const instances: InterfaceExchangeInstance[] = []

  for (const instanceId of instanceIds) {
    const stored = await repository.getInstance(interfaceId, instanceId)
    if (!stored) {
      throw new InterfaceRepositoryError('NOT_FOUND', `Instance not found: ${instanceId}`)
    }

    const assets: Record<string, Uint8Array> = {}
    for (const filename of stored.assetFilenames) {
      const asset = await repository.readInstanceAsset(interfaceId, instanceId, filename)
      if (!asset) {
        throw new InterfaceRepositoryError(
          'MISSING_ASSET',
          `Instance ${instanceId} is missing asset ${filename}`
        )
      }
      assets[filename] = asset
    }
    instances.push({ instance: stored.instance, assets })
  }

  return {
    format: 'ls101-interface',
    version: 2,
    exportedAt: new Date().toISOString(),
    interface: def,
    instances
  }
}

/** 严格检查交换包，但不写入仓储。可用于导入选择界面的预览。 */
export async function inspectInterfacePackage(
  value: InterfaceExchangePackage
): Promise<InterfacePackageInspection> {
  assertPackageShape(value)
  let verified = false
  try {
    verified = await verifyInterfaceId(value.interface)
  } catch {
    throw invalidPackage('Interface content is malformed')
  }
  if (!verified) {
    throw invalidPackage('Interface content ID does not match its content')
  }

  const seen = new Set<string>()
  const instances = value.instances.map(({ instance, assets }) => {
    assertExchangeInstance(instance, assets)
    if (seen.has(instance.instanceId)) {
      throw invalidPackage(`Duplicate instance ID in package: ${instance.instanceId}`)
    }
    seen.add(instance.instanceId)
    return {
      instanceId: instance.instanceId,
      name: instance.name,
      generatedAt: instance.generatedAt,
      assetFilenames: Object.keys(assets).sort()
    }
  })

  return { interface: value.interface, instances }
}

/**
 * 导入前先完成包校验和所有身份冲突检查。不同 UUID 的实例不会按内容去重。
 */
export async function importInterfacePackage(
  repository: InterfaceRepository,
  value: InterfaceExchangePackage,
  options: InterfacePackageImportOptions
): Promise<InterfacePackageImportResult> {
  const inspection = await inspectInterfacePackage(value)
  const selectedIds = resolveImportSelection(inspection, options.instances)
  const selected = value.instances.filter(({ instance }) => selectedIds.has(instance.instanceId))

  const existingDef = await repository.getInterface(value.interface.id)
  if (existingDef && compareInterfaceIdentity(existingDef, value.interface) !== 'same') {
    throw identityConflict(`Interface ${value.interface.id} has an identity collision`)
  }

  for (const incoming of selected) {
    const existing = await repository.findInstance(incoming.instance.instanceId)
    if (!existing) continue

    const same = await exportedInstanceMatches(repository, existing, incoming)
    if (!same) {
      throw identityConflict(`Instance ID conflict: ${incoming.instance.instanceId}`)
    }
  }

  let interfaceResult: InterfaceDefinitionImportResult = 'skipped-existing'
  const createdInstances: string[] = []
  const instances: Record<string, SaveEntityResult | 'skipped-other-interface'> = {}
  try {
    if (!existingDef) {
      const saved = await repository.saveInterface(value.interface)
      interfaceResult = saved === 'created' ? 'created' : 'skipped-existing'
    }
    for (const incoming of selected) {
      const existing = await repository.findInstance(incoming.instance.instanceId)
      if (existing && existing.interfaceId !== value.interface.id) {
        instances[incoming.instance.instanceId] = 'skipped-other-interface'
        continue
      }
      const result = await repository.saveInstance(
        value.interface.id,
        incoming.instance,
        incoming.assets
      )
      instances[incoming.instance.instanceId] = result
      if (result === 'created') createdInstances.push(incoming.instance.instanceId)
    }
  } catch (error) {
    if (interfaceResult === 'created') {
      await repository.deleteInterface(value.interface.id)
    } else {
      for (const instanceId of createdInstances) {
        await repository.deleteInstance(value.interface.id, instanceId)
      }
    }
    throw error
  }
  return { interface: interfaceResult, instances }
}

async function resolveExportSelection(
  repository: InterfaceRepository,
  interfaceId: string,
  selection: InstanceSelection
): Promise<string[]> {
  if (selection.mode === 'none') return []
  if (selection.mode === 'all') return repository.listInstanceIds(interfaceId)
  return uniqueSelection(selection.instanceIds)
}

function resolveImportSelection(
  inspection: InterfacePackageInspection,
  selection: InstanceSelection
): Set<string> {
  const available = new Set(inspection.instances.map(({ instanceId }) => instanceId))
  if (selection.mode === 'none') return new Set()
  if (selection.mode === 'all') return available

  const selected = uniqueSelection(selection.instanceIds)
  for (const instanceId of selected) {
    if (!available.has(instanceId)) {
      throw new InterfaceRepositoryError('NOT_FOUND', `Package instance not found: ${instanceId}`)
    }
  }
  return new Set(selected)
}

function uniqueSelection(instanceIds: readonly string[]): string[] {
  const unique = [...new Set(instanceIds)]
  if (unique.length !== instanceIds.length) {
    throw invalidPackage('Instance selection contains duplicate IDs')
  }
  return unique
}

function assertPackageShape(value: InterfaceExchangePackage): void {
  if (
    !value ||
    value.format !== 'ls101-interface' ||
    value.version !== 2 ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    !value.interface ||
    !isInterfaceId(value.interface.id) ||
    !Array.isArray(value.instances)
  ) {
    throw invalidPackage('Unsupported or malformed Interface package')
  }
}

function assertExchangeInstance(
  instance: InterfaceInstance,
  assets: Record<string, Uint8Array>
): void {
  if (
    !isUuid(instance.instanceId) ||
    typeof instance.name !== 'string' ||
    !instance.name.trim() ||
    Number.isNaN(Date.parse(instance.generatedAt))
  ) {
    throw invalidPackage(`Instance metadata is invalid: ${instance.instanceId}`)
  }
  if (
    !instance.values ||
    typeof instance.values !== 'object' ||
    Object.values(instance.values).some((item) => typeof item !== 'string')
  ) {
    throw invalidPackage(`Instance values are invalid: ${instance.instanceId}`)
  }
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) {
    throw invalidPackage(`Instance assets are invalid: ${instance.instanceId}`)
  }
  for (const [filename, data] of Object.entries(assets)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(filename) || !(data instanceof Uint8Array)) {
      throw invalidPackage(`Invalid instance asset: ${filename}`)
    }
  }
}

async function exportedInstanceMatches(
  repository: InterfaceRepository,
  stored: LocatedInterfaceInstance,
  incoming: InterfaceExchangeInstance
): Promise<boolean> {
  if (canonicalInstance(stored.instance) !== canonicalInstance(incoming.instance)) {
    return false
  }

  const filenames = Object.keys(incoming.assets).sort()
  if (!sameStrings(stored.assetFilenames, filenames)) return false
  for (const filename of filenames) {
    const existing = await repository.readInstanceAsset(
      stored.interfaceId,
      incoming.instance.instanceId,
      filename
    )
    if (!existing || !sameBytes(existing, incoming.assets[filename])) return false
  }
  return true
}

function canonicalInstance(instance: InterfaceInstance): string {
  return JSON.stringify({
    name: instance.name,
    generatedAt: instance.generatedAt,
    values: Object.fromEntries(
      Object.entries(instance.values).sort(([a], [b]) => a.localeCompare(b))
    )
  })
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function invalidPackage(message: string): InterfaceRepositoryError {
  return new InterfaceRepositoryError('INVALID_DATA', message)
}

function identityConflict(message: string): InterfaceRepositoryError {
  return new InterfaceRepositoryError('IDENTITY_CONFLICT', message)
}
