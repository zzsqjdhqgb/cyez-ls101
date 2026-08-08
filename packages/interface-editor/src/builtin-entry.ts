export type {
  BuiltinUpdateKind,
  ManualBuiltinUpdateChoice,
  BuiltinUpdatePlan,
  BuiltinUpdateResult,
  InterfaceReferenceMigrator,
  InterfaceReferenceManager,
  BuiltinRemovalChoice,
  BuiltinRemovalPlan,
  BuiltinRemovalResult
} from './builtin'
export { BundledInterfaceRepositoryError, FileBundledInterfaceRepository } from './bundled'
export type {
  BundledInterfaceEntry,
  BundledInterfaceSource,
  ReadonlyInterfaceStore
} from './bundled'
import type { BundledInterfaceSource } from './bundled'
import {
  applyBuiltinRemoval,
  applyBuiltinUpdate,
  planBuiltinRemoval,
  planBuiltinUpdate
} from './builtin'
import type {
  BuiltinRemovalChoice,
  BuiltinRemovalPlan,
  BuiltinRemovalResult,
  BuiltinUpdatePlan,
  BuiltinUpdateResult,
  InterfaceReferenceManager,
  ManualBuiltinUpdateChoice
} from './builtin'
import type { InterfaceRepository } from './repository'
import type { InterfaceDef } from './types'

export interface BuiltinInterfaceApplication {
  check(builtinKey: string, next: InterfaceDef): Promise<BuiltinUpdatePlan>
  apply(plan: BuiltinUpdatePlan, choice?: ManualBuiltinUpdateChoice): Promise<BuiltinUpdateResult>
  checkRemoval(builtinKey: string): Promise<BuiltinRemovalPlan | null>
  applyRemoval(
    plan: BuiltinRemovalPlan,
    choice: BuiltinRemovalChoice
  ): Promise<BuiltinRemovalResult>
  reconcile(source: BundledInterfaceSource): Promise<BuiltinReconciliationResult>
}

export interface BuiltinReconciliationResult {
  applied: readonly BuiltinUpdateResult[]
  pending: readonly (BuiltinUpdatePlan | BuiltinRemovalPlan)[]
}

export function createBuiltinInterfaceApplication(dependencies: {
  repository: InterfaceRepository
  references: InterfaceReferenceManager
}): BuiltinInterfaceApplication {
  const application: BuiltinInterfaceApplication = {
    check: (builtinKey, next) => planBuiltinUpdate(dependencies.repository, builtinKey, next),
    async apply(plan, choice) {
      const current = await planBuiltinUpdate(dependencies.repository, plan.builtinKey, plan.next)
      if (current.previous?.id !== plan.previous?.id || current.kind !== plan.kind) {
        throw new Error(`Builtin update plan is stale: ${plan.builtinKey}`)
      }
      return applyBuiltinUpdate(dependencies.repository, dependencies.references, plan, choice)
    },
    checkRemoval: (builtinKey) =>
      planBuiltinRemoval(dependencies.repository, dependencies.references, builtinKey),
    async applyRemoval(plan, choice) {
      const current = await planBuiltinRemoval(
        dependencies.repository,
        dependencies.references,
        plan.builtinKey
      )
      if (
        !current ||
        current.previous.id !== plan.previous.id ||
        current.referenceCount !== plan.referenceCount ||
        !sameStrings(current.instanceIds, plan.instanceIds)
      ) {
        throw new Error(`Builtin removal plan is stale: ${plan.builtinKey}`)
      }
      return applyBuiltinRemoval(dependencies.repository, plan, choice)
    },
    async reconcile(source) {
      const bundled = await source.loadAll()
      const bundledKeys = new Set(bundled.map(({ builtinKey }) => builtinKey))
      const applied: BuiltinUpdateResult[] = []
      const pending: Array<BuiltinUpdatePlan | BuiltinRemovalPlan> = []

      for (const entry of bundled) {
        const plan = await application.check(entry.builtinKey, entry.currentInterface)
        if (plan.kind === 'none' || plan.kind === 'automatic') {
          applied.push(await application.apply(plan))
        } else {
          pending.push(plan)
        }
      }

      for (const builtinKey of await dependencies.repository.listBuiltinKeys()) {
        if (bundledKeys.has(builtinKey)) continue
        const plan = await application.checkRemoval(builtinKey)
        if (plan) pending.push(plan)
      }

      return { applied, pending }
    }
  }
  return application
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
