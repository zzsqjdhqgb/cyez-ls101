export type {
  BuiltinUpdateKind,
  ManualBuiltinUpdateChoice,
  BuiltinUpdatePlan,
  BuiltinUpdateResult,
  InterfaceReferenceMigrator
} from './builtin'
import { applyBuiltinUpdate, planBuiltinUpdate } from './builtin'
import type {
  BuiltinUpdatePlan,
  BuiltinUpdateResult,
  InterfaceReferenceMigrator,
  ManualBuiltinUpdateChoice
} from './builtin'
import type { InterfaceRepository } from './repository'
import type { InterfaceDef } from './types'

export interface BuiltinInterfaceApplication {
  check(builtinKey: string, next: InterfaceDef): Promise<BuiltinUpdatePlan>
  apply(plan: BuiltinUpdatePlan, choice?: ManualBuiltinUpdateChoice): Promise<BuiltinUpdateResult>
}

export function createBuiltinInterfaceApplication(dependencies: {
  repository: InterfaceRepository
  references: InterfaceReferenceMigrator
}): BuiltinInterfaceApplication {
  return {
    check: (builtinKey, next) => planBuiltinUpdate(dependencies.repository, builtinKey, next),
    async apply(plan, choice) {
      const current = await planBuiltinUpdate(dependencies.repository, plan.builtinKey, plan.next)
      if (current.previous?.id !== plan.previous?.id || current.kind !== plan.kind) {
        throw new Error(`Builtin update plan is stale: ${plan.builtinKey}`)
      }
      return applyBuiltinUpdate(dependencies.repository, dependencies.references, plan, choice)
    }
  }
}
