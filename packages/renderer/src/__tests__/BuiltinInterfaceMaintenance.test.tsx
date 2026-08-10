// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InterfaceDef } from '@ls101/interface-editor'
import type {
  BuiltinInterfaceApplication,
  BuiltinRemovalPlan,
  BuiltinReconciliationResult,
  BuiltinUpdatePlan,
  BundledInterfaceSource
} from '@ls101/interface-editor/builtin'
import { BuiltinInterfaceMaintenanceDialog } from '../features/interfaces/BuiltinInterfaceMaintenanceDialog'
import {
  BuiltinInterfaceMaintenanceCoordinator,
  type BuiltinInterfaceMaintenance
} from '../features/interfaces/BuiltinInterfaceMaintenance'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const previous: InterfaceDef = {
  id: `sha256:${'a'.repeat(64)}`,
  name: '旧版听说题型',
  description: '旧版说明',
  promptTemplate: '生成旧版题型',
  fields: {
    order: ['title'],
    nodes: {
      title: {
        type: 'text',
        varName: 'titleText',
        description: '标题',
        example: '校园生活'
      }
    }
  }
}

const next: InterfaceDef = {
  ...previous,
  id: `sha256:${'b'.repeat(64)}`,
  name: '新版听说题型',
  description: '新版说明'
}

const updatePlan: BuiltinUpdatePlan = {
  builtinKey: 'speaking',
  previous,
  next,
  kind: 'manual'
}

const invalidPlan: BuiltinUpdatePlan = {
  ...updatePlan,
  kind: 'invalid-contract'
}

const removalPlan: BuiltinRemovalPlan = {
  kind: 'removal',
  builtinKey: 'removed',
  previous,
  instanceIds: ['10000000-0000-4000-8000-000000000001'],
  referenceCount: 2
}

describe('BuiltinInterfaceMaintenanceCoordinator', () => {
  it('initializes once, publishes pending plans, resolves them, and dispatches refresh events', async () => {
    const result: BuiltinReconciliationResult = {
      applied: [],
      pending: [updatePlan, removalPlan]
    }
    const reconcile = vi.fn().mockResolvedValue(result)
    const apply = vi.fn().mockResolvedValue(undefined)
    const applyRemoval = vi.fn().mockResolvedValue(undefined)
    const application = {
      reconcile,
      apply,
      applyRemoval
    } as unknown as BuiltinInterfaceApplication
    const source = { loadAll: vi.fn().mockResolvedValue([]) } as BundledInterfaceSource
    const coordinator = new BuiltinInterfaceMaintenanceCoordinator(application, source)
    const listener = vi.fn()
    const unsubscribe = coordinator.subscribe(listener)
    const dispatch = vi.spyOn(window, 'dispatchEvent')

    const first = coordinator.initialize()
    expect(await first).toEqual(result)
    expect(await coordinator.initialize()).toBe(result)
    expect(reconcile).toHaveBeenCalledOnce()
    expect(coordinator.getSnapshot()).toEqual([updatePlan, removalPlan])
    expect(listener).toHaveBeenCalledOnce()

    await coordinator.resolve(updatePlan, 'migrate')
    expect(apply).toHaveBeenCalledWith(updatePlan, 'migrate')
    expect(coordinator.getSnapshot()).toEqual([removalPlan])
    expect(dispatch).toHaveBeenCalledWith(expect.any(Event))

    await coordinator.resolve(removalPlan, 'backup-old')
    expect(applyRemoval).toHaveBeenCalledWith(removalPlan, 'backup-old')
    expect(coordinator.getSnapshot()).toEqual([])
    expect(dispatch).toHaveBeenCalledTimes(2)

    unsubscribe()
    coordinator.dismiss(updatePlan)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('rejects choices that do not match the pending plan kind', async () => {
    const application = {
      reconcile: vi.fn(),
      apply: vi.fn(),
      applyRemoval: vi.fn()
    } as unknown as BuiltinInterfaceApplication
    const source = { loadAll: vi.fn() } as unknown as BundledInterfaceSource
    const coordinator = new BuiltinInterfaceMaintenanceCoordinator(application, source)

    await expect(coordinator.resolve(updatePlan, 'delete' as never)).rejects.toThrow(
      'Invalid update choice'
    )
    await expect(coordinator.resolve(removalPlan, 'migrate' as never)).rejects.toThrow(
      'Invalid removal choice'
    )
    expect(application.apply).not.toHaveBeenCalled()
    expect(application.applyRemoval).not.toHaveBeenCalled()
  })

  it('keeps a plan pending when applying it fails', async () => {
    const application = {
      reconcile: vi.fn().mockResolvedValue({ applied: [], pending: [updatePlan] }),
      apply: vi.fn().mockRejectedValue(new Error('迁移失败')),
      applyRemoval: vi.fn()
    } as unknown as BuiltinInterfaceApplication
    const source = { loadAll: vi.fn() } as unknown as BundledInterfaceSource
    const coordinator = new BuiltinInterfaceMaintenanceCoordinator(application, source)
    const listener = vi.fn()
    coordinator.subscribe(listener)

    const result = await coordinator.initialize()
    expect(result.pending).toEqual([updatePlan])

    await expect(coordinator.resolve(updatePlan, 'migrate')).rejects.toThrow('迁移失败')
    expect(coordinator.getSnapshot()).toEqual([updatePlan])
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('BuiltinInterfaceMaintenanceDialog', () => {
  it('offers migration and backup choices for a structural update', async () => {
    const resolve = vi.fn().mockResolvedValue(undefined)
    const maintenance = maintenanceFor(updatePlan, resolve)

    render(<BuiltinInterfaceMaintenanceDialog maintenance={maintenance} />)

    expect(screen.getByRole('heading', { name: '内置题型需要迁移' })).toBeInTheDocument()
    expect(screen.getByText('新版听说题型')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '迁移并更新' }))
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(updatePlan, 'migrate'))

    fireEvent.click(screen.getByRole('button', { name: '保留旧版' }))
    await waitFor(() => expect(resolve).toHaveBeenCalledWith(updatePlan, 'backup-old'))
  })

  it('dismisses an invalid-contract update without offering migration', async () => {
    const dismiss = vi.fn()
    const maintenance = maintenanceFor(invalidPlan, vi.fn(), dismiss)

    render(<BuiltinInterfaceMaintenanceDialog maintenance={maintenance} />)

    expect(screen.getByRole('heading', { name: '内置题型无法自动更新' })).toBeInTheDocument()
    expect(screen.getByText('新版本更改了变量名称或类型，当前版本将继续保留。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '迁移并更新' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '知道了' }))
    expect(dismiss).toHaveBeenCalledWith(invalidPlan)
  })

  it('shows an apply error and allows retrying the same choice', async () => {
    const resolve = vi
      .fn()
      .mockRejectedValueOnce(new Error('内置题型处理失败'))
      .mockResolvedValueOnce(undefined)
    const maintenance = maintenanceFor(removalPlan, resolve)

    render(<BuiltinInterfaceMaintenanceDialog maintenance={maintenance} />)

    fireEvent.click(screen.getByRole('button', { name: '保留旧版' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('内置题型处理失败')
    fireEvent.click(screen.getByRole('button', { name: '保留旧版' }))
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2))
  })
})

function maintenanceFor(
  plan: BuiltinUpdatePlan | BuiltinRemovalPlan,
  resolve: ReturnType<typeof vi.fn>,
  dismiss = vi.fn()
): BuiltinInterfaceMaintenance {
  const snapshot = [plan]
  return {
    initialize: vi.fn(),
    resolve,
    dismiss,
    subscribe: () => () => undefined,
    getSnapshot: () => snapshot
  }
}
