import { LabError } from './errors'

// The gate precedes resource locks and SQLite transactions. Draining never holds a transaction.
export class WriteGate {
  private active = 0
  private owner: string | null = null
  private drained: (() => void) | null = null
  private readonly permits = new Set<() => void>()

  get closed(): boolean {
    return this.owner !== null
  }
  get backupId(): string | null {
    return this.owner
  }

  enter(): () => void {
    if (this.owner)
      throw new LabError(
        'SERVICE_NOT_READY',
        {
          blockers: [{ kind: 'backup-write-barrier', resourceId: this.owner }]
        },
        1
      )
    this.active++
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.permits.delete(release)
      this.active--
      if (this.active === 0) {
        this.drained?.()
        this.drained = null
      }
    }
    this.permits.add(release)
    return release
  }

  hasPermit(permit: () => void): boolean {
    return this.permits.has(permit)
  }

  async close(owner: string): Promise<void> {
    if (this.owner) throw new LabError('RESOURCE_BUSY')
    this.owner = owner
    if (this.active > 0)
      await new Promise<void>((resolve) => {
        this.drained = resolve
      })
  }

  release(owner: string): void {
    if (this.owner !== owner || this.active !== 0) throw new Error('Invalid backup gate ownership')
    this.owner = null
  }
}
