import { useState, type JSX } from 'react'
import type { Schema } from '@ls101/lab-contracts'
import { useServiceList } from '../../session/workspace'
import { ListFooter, QueryNotice } from '../../components/WorkspaceUI'
import styles from '../Workspace.module.css'

export function DevicePicker({
  selected,
  change
}: {
  selected: ReadonlySet<string>
  change(ids: Set<string>): void
}): JSX.Element {
  const [room, setRoom] = useState('')
  const list = useServiceList<Schema<'DeviceDetails'>>('getTeacherDevices', {
    room: room || undefined
  })
  const available = list.data?.items.filter((device) => device.enabled) ?? []
  const toggle = (ids: string[], checked: boolean): void => {
    const next = new Set(selected)
    for (const id of ids) {
      if (checked) next.add(id)
      else next.delete(id)
    }
    change(next)
  }
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <label>
          按机房筛选
          <input value={room} onChange={(event) => setRoom(event.target.value)} />
        </label>
        <span className={styles.hint}>已选 {selected.size} 台设备</span>
      </div>
      <QueryNotice query={list} />
      <div className={styles.tableFrame}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="选择本页设备"
                  checked={
                    available.length > 0 && available.every((device) => selected.has(device.id))
                  }
                  onChange={(event) =>
                    toggle(
                      available.map((device) => device.id),
                      event.target.checked
                    )
                  }
                />
              </th>
              <th>设备</th>
              <th>机房 / 座位</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.items.map((device) => (
              <tr key={device.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`选择设备 ${device.number}`}
                    disabled={!device.enabled}
                    checked={selected.has(device.id)}
                    onChange={(event) => toggle([device.id], event.target.checked)}
                  />
                </td>
                <td>
                  {device.number} · {device.computerName}
                </td>
                <td>
                  {device.room ?? '未分配'} / {device.seat ?? '未分配'}
                </td>
                <td>{!device.enabled ? '已禁用' : device.online ? '在线' : '离线'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data ? <ListFooter list={list} /> : null}
    </div>
  )
}
