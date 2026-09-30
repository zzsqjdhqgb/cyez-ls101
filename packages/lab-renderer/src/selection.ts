import { useState } from 'react'

export interface LabSelection {
  selected: ReadonlySet<string>
  size: number
  has(id: string): boolean
  toggle(id: string, next?: boolean): void
  set(ids: Iterable<string>): void
  clear(): void
}

export function useSelection(initial?: Iterable<string>): LabSelection {
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initial))

  return {
    selected,
    size: selected.size,
    has: (id) => selected.has(id),
    toggle: (id, next) =>
      setSelected((current) => {
        const value = next ?? !current.has(id)
        if (value === current.has(id)) return current
        const copy = new Set(current)
        if (value) copy.add(id)
        else copy.delete(id)
        return copy
      }),
    set: (ids) => setSelected(new Set(ids)),
    clear: () => setSelected((current) => (current.size === 0 ? current : new Set()))
  }
}
