import { isAbsolute } from 'node:path'
import { requestLocalControl } from './control'
import { manageLocalService } from './local-manager'

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
    const code = (error as { code?: string }).code
    result = {
      ok: false,
      error: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'LOCAL_OPERATION_FAILED'
    }
  }
  await requestLocalControl(channel, 'complete', result)
}
void main().catch((error: unknown) => {
  const code = (error as { code?: string }).code
  process.stderr.write(
    `${JSON.stringify({ error: typeof code === 'string' && /^[A-Z_]+$/.test(code) ? code : 'LOCAL_OPERATION_FAILED' })}\n`
  )
  process.exitCode = 1
})
