// Test-only entry. It is bundled separately and never referenced by the shipping CLI.
import { LabService } from '../../service'
import { createLabHttpServer, closeLabHttpServer } from '../../http'
import { restoreOffline } from '../../restore'

async function main(): Promise<void> {
  const [root, initialize] = process.argv.slice(2)
  process.on('disconnect', () => process.exit(0))
  if (initialize === 'restore') {
    process.on(
      'message',
      async (message: {
        id: number
        operation: string
        point: string
        input: { archive: string; password: string }
      }) => {
        try {
          if (message.operation !== 'restore') throw new Error('Unknown test restore operation')
          await restoreOffline({
            root,
            releaseVersion: 'integration-test',
            ...message.input,
            fault: async (point) => {
              if (point !== message.point) return
              process.send!({ event: 'paused', point })
              await new Promise<void>(() => {}) // Parent kills this process without unwinding finally.
            }
          })
          process.send!({ id: message.id })
        } catch (error) {
          process.send!({ id: message.id, error: String(error) })
        }
      }
    )
    process.send!({ event: 'ready' })
    return
  }
  const options = { root, releaseVersion: 'integration-test', isLicenseActive: () => true }
  const service =
    initialize === 'initialize'
      ? await LabService.initialize(options, {
          name: 'Crash lab',
          baseUrl: 'https://127.0.0.1:8443/',
          password: 'integration-teacher-password'
        })
      : await LabService.open(options)
  const server = createLabHttpServer(service)
  let pausedAt: string | undefined
  let release: (() => void) | undefined
  service.options.fault = async (point) => {
    if (point !== pausedAt) return
    pausedAt = undefined
    await new Promise<void>((resolve) => {
      release = resolve
      process.send!({ event: 'paused', point })
    })
  }
  process.on('message', async (message: { id: number; operation: string; point?: string }) => {
    try {
      switch (message.operation) {
        case 'pause':
          pausedAt = message.point
          break
        case 'release':
          release?.()
          break
        case 'stop':
          release?.()
          await closeLabHttpServer(server)
          await service.backups.wait()
          service.db.close()
          process.send!({ id: message.id })
          process.disconnect()
          return
        default:
          throw new Error('Unknown test control operation')
      }
      process.send!({ id: message.id })
    } catch (error) {
      process.send!({ id: message.id, error: String(error) })
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  process.send!({
    event: 'ready',
    port: (server.address() as { port: number }).port,
    certificate: service.identity.certificate
  })
}
void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
