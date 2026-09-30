import { isAbsolute } from 'node:path'
import { requestLocalControl } from './control'
import { localManagerFailure, manageLocalService } from './local-manager'

async function main(): Promise<void> {
  const [flag, channel, ...extra] = process.argv.slice(2)
  if (flag === '--prepare-install' && channel === undefined) {
    await manageLocalService('prepare-install', undefined)
    return
  }
  if (flag !== '--channel' || !channel || !isAbsolute(channel) || extra.length)
    throw new Error('Invalid manager channel')
  const request = await requestLocalControl<{ operation: string; input?: unknown }>(
    channel,
    'request'
  )
  let result: unknown
  try {
    result = { ok: true, value: await manageLocalService(request.operation, request.input) }
  } catch (error) {
    result = localManagerFailure(error)
  }
  await requestLocalControl(channel, 'complete', result)
}
void main().catch((error: unknown) => {
  process.stderr.write(`${JSON.stringify(localManagerFailure(error))}\n`)
  process.exitCode = 1
})
