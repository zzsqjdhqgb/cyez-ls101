import { useState, useSyncExternalStore, type JSX } from 'react'
import { AlertTriangle, Archive, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { Modal, ModalDescription, ModalTitle } from '../../components/ui/Modal'
import { builtinInterfaceMaintenance } from './BuiltinInterfaceRuntime'
import type {
  BuiltinInterfaceMaintenance,
  PendingBuiltinInterfacePlan
} from './BuiltinInterfaceMaintenance'
import styles from './BuiltinInterfaceMaintenanceDialog.module.css'

export function BuiltinInterfaceMaintenanceDialog({
  maintenance = builtinInterfaceMaintenance
}: {
  maintenance?: BuiltinInterfaceMaintenance
}): JSX.Element | null {
  const plans = useSyncExternalStore(
    maintenance.subscribe,
    maintenance.getSnapshot,
    maintenance.getSnapshot
  )
  const plan = plans[0]
  if (!plan) return null
  return <MaintenanceSession key={plan.builtinKey} maintenance={maintenance} plan={plan} />
}

function MaintenanceSession({
  maintenance,
  plan
}: {
  maintenance: BuiltinInterfaceMaintenance
  plan: PendingBuiltinInterfacePlan
}): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const removal = plan.kind === 'removal'
  const invalid = plan.kind === 'invalid-contract'
  const name = removal ? plan.previous.name : plan.next.name

  const resolve = async (choice: 'migrate' | 'backup-old' | 'delete'): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await maintenance.resolve(plan, choice)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '内置题型处理失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onOpenChange={() => undefined} open overlayClassName={styles.backdrop}>
      <section className={styles.dialog}>
        <header className={styles.header}>
          <div className={styles.icon} data-danger={removal || invalid || undefined}>
            {removal ? <Trash2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
          </div>
          <div>
            <ModalDescription asChild>
              <span>{plan.builtinKey}</span>
            </ModalDescription>
            <ModalTitle asChild>
              <h2>
                {removal
                  ? '内置题型已从应用中移除'
                  : invalid
                    ? '内置题型无法自动更新'
                    : '内置题型需要迁移'}
              </h2>
            </ModalTitle>
          </div>
        </header>

        <div className={styles.body}>
          <strong>{name}</strong>
          {removal ? (
            <p>
              本地保存了 {plan.instanceIds.length} 个题组，现有 Template 中有 {plan.referenceCount}{' '}
              处引用。
            </p>
          ) : invalid ? (
            <p>新版本更改了变量名称或类型，当前版本将继续保留。</p>
          ) : (
            <p>新版本调整了字段结构。可以迁移现有题组，或把旧版本保留为用户题型。</p>
          )}
          {error ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className={styles.actions}>
          {invalid ? (
            <Button onClick={() => maintenance.dismiss(plan)}>知道了</Button>
          ) : (
            <>
              <Button icon={Archive} disabled={busy} onClick={() => void resolve('backup-old')}>
                保留旧版
              </Button>
              <Button
                icon={removal ? Trash2 : RefreshCw}
                variant={removal ? 'danger' : 'primary'}
                disabled={busy}
                onClick={() => void resolve(removal ? 'delete' : 'migrate')}
              >
                {removal ? '删除' : '迁移并更新'}
              </Button>
            </>
          )}
        </footer>
      </section>
    </Modal>
  )
}
