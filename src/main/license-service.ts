import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import type { LicenseActivationResult, LicenseStatus } from '@ls101/core-types'

export const LICENSE_RECEIPT_FILENAME = 'license.json'

// Replace this SHA-256 digest when invitation-code distribution changes.
export const INVITATION_CODE_HASH =
  '487c1f4d73f9cef0a13ae59eee14a604f67f93c307c89ecdf69b4f20fca0ff3d'

// The temporary license remains valid through October 1 in China Standard Time.
export const LICENSE_EXPIRES_AT = '2026-10-01T15:59:59.999Z'

interface LicenseReceipt {
  schemaVersion: 1
  invitationCodeHash: string
  activatedAt: string
}

export interface LicenseServiceOptions {
  storagePath: string
  expectedCodeHash?: string
  expiresAt?: string
  now?: () => Date
}

export function normalizeInvitationCode(invitationCode: string): string {
  return invitationCode.trim().toUpperCase()
}

export function hashInvitationCode(invitationCode: string): string {
  return createHash('sha256').update(normalizeInvitationCode(invitationCode), 'utf8').digest('hex')
}

export class LicenseService {
  private readonly expectedCodeHash: string
  private readonly expirationTime: number
  private readonly expiresAt: string
  private readonly now: () => Date

  constructor(private readonly options: LicenseServiceOptions) {
    this.expectedCodeHash = options.expectedCodeHash ?? INVITATION_CODE_HASH
    assertSha256Hash(this.expectedCodeHash)

    const expirationTime = Date.parse(options.expiresAt ?? LICENSE_EXPIRES_AT)
    if (!Number.isFinite(expirationTime)) throw new Error('License expiration is invalid')

    this.expirationTime = expirationTime
    this.expiresAt = new Date(expirationTime).toISOString()
    this.now = options.now ?? (() => new Date())
  }

  async getStatus(): Promise<LicenseStatus> {
    if (this.currentTime() > this.expirationTime) {
      return { state: 'expired', expiresAt: this.expiresAt }
    }

    const receipt = await this.readReceipt()
    if (!receipt || !this.isValidReceipt(receipt)) {
      return { state: 'not-activated', expiresAt: this.expiresAt }
    }

    return {
      state: 'active',
      expiresAt: this.expiresAt,
      activatedAt: receipt.activatedAt
    }
  }

  async activate(invitationCode: unknown): Promise<LicenseActivationResult> {
    const now = this.currentDate()
    if (now.getTime() > this.expirationTime) {
      return {
        activated: false,
        reason: 'expired',
        status: { state: 'expired', expiresAt: this.expiresAt }
      }
    }

    if (
      typeof invitationCode !== 'string' ||
      invitationCode.length > 256 ||
      !this.matchesExpectedCode(invitationCode)
    ) {
      return {
        activated: false,
        reason: 'invalid-code',
        status: { state: 'not-activated', expiresAt: this.expiresAt }
      }
    }

    const activatedAt = now.toISOString()
    await writeReceiptAtomically(this.options.storagePath, {
      schemaVersion: 1,
      invitationCodeHash: this.expectedCodeHash,
      activatedAt
    })

    return {
      activated: true,
      status: { state: 'active', expiresAt: this.expiresAt, activatedAt }
    }
  }

  async deactivate(): Promise<void> {
    await rm(this.options.storagePath, { force: true })
  }

  private currentTime(): number {
    return this.currentDate().getTime()
  }

  private currentDate(): Date {
    const current = this.now()
    const time = current.getTime()
    if (!Number.isFinite(time)) throw new Error('Current time is invalid')
    return current
  }

  private matchesExpectedCode(invitationCode: string): boolean {
    const actual = Buffer.from(hashInvitationCode(invitationCode), 'hex')
    const expected = Buffer.from(this.expectedCodeHash, 'hex')
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  private async readReceipt(): Promise<LicenseReceipt | null> {
    let serialized: string
    try {
      serialized = await readFile(this.options.storagePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }

    try {
      const value: unknown = JSON.parse(serialized)
      return isLicenseReceipt(value) ? value : null
    } catch (error) {
      if (error instanceof SyntaxError) return null
      throw error
    }
  }

  private isValidReceipt(receipt: LicenseReceipt): boolean {
    const activatedAt = Date.parse(receipt.activatedAt)
    return (
      constantTimeHashEqual(receipt.invitationCodeHash, this.expectedCodeHash) &&
      Number.isFinite(activatedAt) &&
      activatedAt <= this.expirationTime
    )
  }
}

function isLicenseReceipt(value: unknown): value is LicenseReceipt {
  if (!value || typeof value !== 'object') return false
  const receipt = value as Partial<LicenseReceipt>
  return (
    receipt.schemaVersion === 1 &&
    typeof receipt.invitationCodeHash === 'string' &&
    typeof receipt.activatedAt === 'string'
  )
}

function assertSha256Hash(value: string): void {
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('Invitation-code hash must be SHA-256 hex')
}

function constantTimeHashEqual(actualHash: string, expectedHash: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(actualHash)) return false
  const actual = Buffer.from(actualHash, 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function writeReceiptAtomically(filename: string, receipt: LicenseReceipt): Promise<void> {
  const directory = path.dirname(filename)
  const temporaryPath = path.join(directory, `.license-${randomUUID()}.tmp`)
  let temporaryFile: Awaited<ReturnType<typeof open>> | null = null
  let renamed = false

  await mkdir(directory, { recursive: true })
  try {
    temporaryFile = await open(temporaryPath, 'wx', 0o600)
    await temporaryFile.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, 'utf8')
    await temporaryFile.sync()
    await temporaryFile.close()
    temporaryFile = null
    await rename(temporaryPath, filename)
    renamed = true
  } finally {
    if (temporaryFile) await temporaryFile.close().catch(() => undefined)
    if (!renamed) await rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
