import type { InterfaceRepository } from './repository'
import type { FieldCollection, FieldNode, InterfaceDef } from './types'

export type BuiltinUpdateKind = 'none' | 'automatic' | 'manual' | 'invalid-contract'
export type ManualBuiltinUpdateChoice = 'migrate' | 'backup-old'
export type BuiltinRemovalChoice = 'delete' | 'backup-old'

export interface BuiltinUpdatePlan {
  builtinKey: string
  previous: InterfaceDef | null
  next: InterfaceDef
  kind: BuiltinUpdateKind
}

export interface InterfaceReferenceMigrator {
  replaceInterfaceReferences(fromInterfaceId: string, toInterfaceId: string): Promise<void>
}

export interface InterfaceReferenceManager extends InterfaceReferenceMigrator {
  countInterfaceReferences(interfaceId: string): Promise<number>
}

export interface BuiltinUpdateResult {
  kind: BuiltinUpdateKind
  previousInterfaceId: string | null
  currentInterfaceId: string
  migratedInstanceIds: string[]
  backedUpPrevious: boolean
}

export interface BuiltinRemovalPlan {
  kind: 'removal'
  builtinKey: string
  previous: InterfaceDef
  instanceIds: readonly string[]
  referenceCount: number
}

export interface BuiltinRemovalResult {
  kind: 'removal'
  previousInterfaceId: string
  affectedInstanceIds: readonly string[]
  affectedReferenceCount: number
  backedUpPrevious: boolean
}

export function classifyBuiltinUpdate(
  previous: InterfaceDef,
  next: InterfaceDef
): BuiltinUpdateKind {
  if (previous.id === next.id) return 'none'
  if (variableContract(previous) !== variableContract(next)) return 'invalid-contract'
  return jsonStructure(previous) === jsonStructure(next) ? 'automatic' : 'manual'
}

export async function planBuiltinUpdate(
  repository: InterfaceRepository,
  builtinKey: string,
  next: InterfaceDef
): Promise<BuiltinUpdatePlan> {
  const entry = await repository.getBuiltin(builtinKey)
  if (!entry) return { builtinKey, previous: null, next, kind: 'automatic' }
  const previous = await repository.getInterface(entry.currentInterfaceId)
  if (!previous) throw new Error(`Builtin Interface is missing: ${entry.currentInterfaceId}`)
  return { builtinKey, previous, next, kind: classifyBuiltinUpdate(previous, next) }
}

export async function applyBuiltinUpdate(
  repository: InterfaceRepository,
  references: InterfaceReferenceMigrator,
  plan: BuiltinUpdatePlan,
  choice?: ManualBuiltinUpdateChoice
): Promise<BuiltinUpdateResult> {
  if (plan.kind === 'invalid-contract') {
    throw new Error(`Builtin ${plan.builtinKey} changes its variable contract`)
  }
  if (plan.kind === 'manual' && !choice) {
    throw new Error(`Builtin ${plan.builtinKey} requires an update choice`)
  }

  await repository.saveBuiltinInterface(plan.builtinKey, plan.next)
  if (!plan.previous) {
    await repository.setBuiltinCurrent(plan.builtinKey, plan.next.id)
    return {
      kind: plan.kind,
      previousInterfaceId: null,
      currentInterfaceId: plan.next.id,
      migratedInstanceIds: [],
      backedUpPrevious: false
    }
  }

  if (plan.kind === 'none') {
    return {
      kind: 'none',
      previousInterfaceId: plan.previous.id,
      currentInterfaceId: plan.previous.id,
      migratedInstanceIds: [],
      backedUpPrevious: false
    }
  }

  if (plan.kind === 'manual' && choice === 'backup-old') {
    await repository.setBuiltinCurrent(plan.builtinKey, plan.next.id)
    try {
      await repository.backupBuiltinInterface(plan.builtinKey, plan.previous.id)
    } catch (error) {
      await repository.setBuiltinCurrent(plan.builtinKey, plan.previous.id)
      throw error
    }
    return {
      kind: 'manual',
      previousInterfaceId: plan.previous.id,
      currentInterfaceId: plan.next.id,
      migratedInstanceIds: [],
      backedUpPrevious: true
    }
  }

  const instanceIds = await repository.listInstanceIds(plan.previous.id)
  let referencesMoved = false
  let instancesMoved = false
  let catalogMoved = false
  try {
    await repository.moveInstances(plan.previous.id, plan.next.id, instanceIds)
    instancesMoved = true
    await references.replaceInterfaceReferences(plan.previous.id, plan.next.id)
    referencesMoved = true
    await repository.setBuiltinCurrent(plan.builtinKey, plan.next.id)
    catalogMoved = true
    await repository.deleteInterface(plan.previous.id)
  } catch (error) {
    if (catalogMoved) {
      await repository.setBuiltinCurrent(plan.builtinKey, plan.previous.id)
    }
    if (referencesMoved) {
      await references.replaceInterfaceReferences(plan.next.id, plan.previous.id)
    }
    if (instancesMoved) {
      await repository.moveInstances(plan.next.id, plan.previous.id, instanceIds)
    }
    throw error
  }

  return {
    kind: plan.kind,
    previousInterfaceId: plan.previous.id,
    currentInterfaceId: plan.next.id,
    migratedInstanceIds: instanceIds,
    backedUpPrevious: false
  }
}

export async function planBuiltinRemoval(
  repository: InterfaceRepository,
  references: InterfaceReferenceManager,
  builtinKey: string
): Promise<BuiltinRemovalPlan | null> {
  const entry = await repository.getBuiltin(builtinKey)
  if (!entry) return null
  const previous = await repository.getInterface(entry.currentInterfaceId)
  if (!previous) throw new Error(`Builtin Interface is missing: ${entry.currentInterfaceId}`)
  const [instanceIds, referenceCount] = await Promise.all([
    repository.listInstanceIds(previous.id),
    references.countInterfaceReferences(previous.id)
  ])
  return { kind: 'removal', builtinKey, previous, instanceIds, referenceCount }
}

export async function applyBuiltinRemoval(
  repository: InterfaceRepository,
  plan: BuiltinRemovalPlan,
  choice: BuiltinRemovalChoice
): Promise<BuiltinRemovalResult> {
  if (choice !== 'delete' && choice !== 'backup-old') {
    throw new Error(`Builtin ${plan.builtinKey} requires a removal choice`)
  }
  if (choice === 'backup-old') {
    await repository.backupBuiltinInterface(plan.builtinKey, plan.previous.id)
  }
  await repository.removeBuiltin(plan.builtinKey, plan.previous.id)
  return {
    kind: 'removal',
    previousInterfaceId: plan.previous.id,
    affectedInstanceIds: plan.instanceIds,
    affectedReferenceCount: plan.referenceCount,
    backedUpPrevious: choice === 'backup-old'
  }
}

function variableContract(def: InterfaceDef): string {
  return JSON.stringify(
    collectLeaves(def.fields)
      .map(({ node }) => [node.varName.normalize('NFC'), node.type])
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
  )
}

function jsonStructure(def: InterfaceDef): string {
  return JSON.stringify(structureEntries(def.fields))
}

function structureEntries(fields: FieldCollection): unknown[] {
  return fields.order.map((key) => {
    const node = fields.nodes[key]
    if (node.type === 'group') {
      return [key.normalize('NFC'), 'group', structureEntries(node.children)]
    }
    return [key.normalize('NFC'), node.type, node.varName.normalize('NFC')]
  })
}

function collectLeaves(
  fields: FieldCollection
): Array<{ node: Exclude<FieldNode, { type: 'group' }> }> {
  const leaves: Array<{ node: Exclude<FieldNode, { type: 'group' }> }> = []
  for (const key of fields.order) {
    const node = fields.nodes[key]
    if (node.type === 'group') leaves.push(...collectLeaves(node.children))
    else leaves.push({ node })
  }
  return leaves
}
