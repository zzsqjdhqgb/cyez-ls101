import { mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import type { LocalDataExport } from './local-service-types'

/** Renderer cannot supply the privileged copy destination or replace the verified export receipt. */
export class LocalRecovery {
  private receipt: LocalDataExport | null = null
  private busy = false
  constructor(
    private readonly chooseDirectory: () => Promise<string | null>,
    private readonly invoke: (operation: string, input: unknown) => Promise<unknown>
  ) {}

  async run(operation: 'export-data' | 'purge', input: unknown): Promise<unknown> {
    if (input !== undefined) throw new Error('INVALID_REQUEST')
    if (this.busy) throw new Error('LOCAL_OPERATION_BUSY')
    this.busy = true
    try {
      if (operation === 'export-data') {
        this.receipt = null
        const parent = await this.chooseDirectory()
        if (!parent) return null
        const directory = await realpath(await mkdtemp(join(parent, 'LS101-recovery-')))
        const { uid, gid } = userInfo()
        const result = (await this.invoke('export-data', {
          directory,
          owner: { uid, gid }
        })) as LocalDataExport
        if (result.directory !== directory || !/^[a-f0-9]{64}$/.test(result.manifestSha256))
          throw new Error('LOCAL_RECOVERY_INVALID')
        this.receipt = result
        return result
      }
      if (!this.receipt) throw new Error('LOCAL_RECOVERY_EXPORT_REQUIRED')
      const result = await this.invoke('purge', this.receipt)
      this.receipt = null
      return result
    } finally {
      this.busy = false
    }
  }
}
