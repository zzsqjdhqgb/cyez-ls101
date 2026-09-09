import { useCallback, useEffect, useState, type JSX } from 'react'
import { RefreshCw } from 'lucide-react'
import type { TeacherOperation } from '@ls101/lab-desktop-host'
import type { TeacherController } from './controller'
import { Dialog, Notice } from './ui'
import { time, useAction } from './hooks'

export function Operations({ controller }: { controller: TeacherController }): JSX.Element {
  const [entries, setEntries] = useState<TeacherOperation[]>([])
  const [selected, setSelected] = useState<TeacherOperation | null>(null)
  const [secret, setSecret] = useState('')
  const [result, setResult] = useState<unknown>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const entries = await controller.host.invoke<TeacherOperation[]>('operations.list')
      setEntries(entries)
      setReadError(null)
    } catch (error) {
      setReadError(error instanceof Error ? error.message : String(error))
    }
  }, [controller])
  const action = useAction(() => {
    void refresh()
  })
  useEffect(() => {
    let active = true
    void controller.host.invoke<TeacherOperation[]>('operations.list').then(
      (entries) => {
        if (active) setEntries(entries)
      },
      (error) => {
        if (active) setReadError(error instanceof Error ? error.message : String(error))
      }
    )
    return () => {
      active = false
    }
  }, [controller])
  const serverId = controller.getSnapshot().connection?.info.serverId
  return (
    <section className="settings-band">
      <div className="section-header">
        <h2>未确认操作</h2>
        <button
          title="刷新操作记录"
          aria-label="刷新操作记录"
          disabled={action.busy}
          onClick={() => action.run(refresh)}
        >
          <RefreshCw />
        </button>
      </div>
      <Notice error={action.error ?? readError} />
      <table>
        <thead>
          <tr>
            <th>时间</th>
            <th>操作</th>
            <th>状态</th>
            <th>核对</th>
          </tr>
        </thead>
        <tbody>
          {entries
            .filter(
              (entry) =>
                entry.serverId === serverId && ['sending', 'unknown'].includes(entry.status)
            )
            .map((entry) => (
              <tr key={entry.id}>
                <td>{time(entry.at)}</td>
                <td>{entry.operationId}</td>
                <td>结果未确认</td>
                <td>
                  <button
                    disabled={action.busy}
                    onClick={() => {
                      setSelected(entry)
                      setSecret('')
                      setResult(null)
                    }}
                  >
                    核对操作
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      {selected && (
        <Dialog
          title="核对未确认操作"
          close={() => {
            if (!action.busy) setSelected(null)
          }}
        >
          <p>
            {selected.operationId} / {time(selected.at)}
          </p>
          <pre className="local-logs">{JSON.stringify(selected.input, null, 2)}</pre>
          {selected.secretFields.map((key) => (
            <label key={key}>
              原请求密码
              <input
                type="password"
                autoComplete="off"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
              />
            </label>
          ))}
          {selected.idempotencyKey ? (
            <button
              disabled={action.busy || (selected.secretFields.length > 0 && !secret)}
              onClick={() => {
                const pending = selected
                const password = secret
                setSecret('')
                action.run(async () => {
                  const connection = controller.getSnapshot().connection
                  if (connection?.info.serverId !== pending.serverId)
                    throw new Error('服务连接已切换')
                  const input = structuredClone(pending.input)
                  if (pending.secretFields.length) {
                    input.body = {
                      ...(input.body as object),
                      ...Object.fromEntries(pending.secretFields.map((key) => [key, password]))
                    }
                  }
                  if (input.archive) {
                    const archive = await controller.host.invoke<typeof input.archive | null>(
                      'transfer.import',
                      { connectionId: connection.connectionId }
                    )
                    if (!archive) return
                    if (
                      archive.sha256 !== input.archive.sha256 ||
                      archive.bytes !== input.archive.bytes
                    )
                      throw new Error('必须选择与原请求相同的归档文件')
                    input.archive = archive
                  }
                  if (connection !== controller.getSnapshot().connection)
                    throw new Error('服务连接已切换')
                  const response = await controller.mutate(pending.operationId, {
                    ...input,
                    idempotencyKey: pending.idempotencyKey!
                  })
                  setResult(response ?? { status: 'confirmed' })
                })
              }}
            >
              使用原幂等键核对
            </button>
          ) : (
            <p>此操作使用版本号校验，请查看对应资源的最新状态后决定是否再次修改。</p>
          )}
          {result !== null && <pre className="local-logs">{JSON.stringify(result, null, 2)}</pre>}
          <Notice error={action.error} />
        </Dialog>
      )}
    </section>
  )
}
