import type {
  BuiltinInterfaceApplication,
  BuiltinReconciliationResult,
  BuiltinRemovalChoice,
  BuiltinRemovalPlan,
  BuiltinUpdatePlan,
  ManualBuiltinUpdateChoice
} from '@ls101/interface-editor/builtin'
import type { BundledInterfaceSource } from '@ls101/interface-editor/builtin'

export type PendingBuiltinInterfacePlan = BuiltinUpdatePlan | BuiltinRemovalPlan

export interface BuiltinInterfaceMaintenance {
  initialize(): Promise<BuiltinReconciliationResult>
  resolve(
    plan: PendingBuiltinInterfacePlan,
    choice: ManualBuiltinUpdateChoice | BuiltinRemovalChoice
  ): Promise<void>
  dismiss(plan: PendingBuiltinInterfacePlan): void
  subscribe(listener: () => void): () => void
  getSnapshot(): readonly PendingBuiltinInterfacePlan[]
}

export class BuiltinInterfaceMaintenanceCoordinator implements BuiltinInterfaceMaintenance {
  private snapshot: readonly PendingBuiltinInterfacePlan[] = []
  private readonly listeners = new Set<() => void>()
  private initialization: Promise<BuiltinReconciliationResult> | null = null

  constructor(
    private readonly application: BuiltinInterfaceApplication,
    private readonly source: BundledInterfaceSource
  ) {}

  initialize(): Promise<BuiltinReconciliationResult> {
    if (!this.initialization) {
      this.initialization = this.application.reconcile(this.source).then((result) => {
        this.setSnapshot(result.pending)
        return result
      })
    }
    return this.initialization
  }

  async resolve(
    plan: PendingBuiltinInterfacePlan,
    choice: ManualBuiltinUpdateChoice | BuiltinRemovalChoice
  ): Promise<void> {
    if (plan.kind === 'removal') {
      if (choice !== 'delete' && choice !== 'backup-old') {
        throw new Error(`Invalid removal choice for ${plan.builtinKey}`)
      }
      await this.application.applyRemoval(plan, choice)
    } else {
      if (choice !== 'migrate' && choice !== 'backup-old') {
        throw new Error(`Invalid update choice for ${plan.builtinKey}`)
      }
      await this.application.apply(plan, choice)
    }
    this.remove(plan)
    window.dispatchEvent(new Event('interface-builtins-changed'))
  }

  dismiss(plan: PendingBuiltinInterfacePlan): void {
    this.remove(plan)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): readonly PendingBuiltinInterfacePlan[] => this.snapshot

  private remove(plan: PendingBuiltinInterfacePlan): void {
    this.setSnapshot(this.snapshot.filter((item) => item.builtinKey !== plan.builtinKey))
  }

  private setSnapshot(snapshot: readonly PendingBuiltinInterfacePlan[]): void {
    this.snapshot = [...snapshot]
    for (const listener of this.listeners) listener()
  }
}
