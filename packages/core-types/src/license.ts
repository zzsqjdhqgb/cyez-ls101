export const LICENSE_CHANNELS = {
  getStatus: 'license:get-status',
  activate: 'license:activate',
  deactivate: 'license:deactivate',
  openActivationGuide: 'license:open-activation-guide'
} as const

export type LicenseState = 'active' | 'not-activated' | 'expired'

export interface LicenseStatus {
  state: LicenseState
  expiresAt: string
  activatedAt?: string
}

export type LicenseActivationFailureReason = 'invalid-code' | 'expired'

export interface LicenseActivationResult {
  activated: boolean
  status: LicenseStatus
  reason?: LicenseActivationFailureReason
}

export interface LicenseBridge {
  getStatus(): Promise<LicenseStatus>
  activate(invitationCode: string): Promise<LicenseActivationResult>
  deactivate(): Promise<void>
  openActivationGuide(): Promise<void>
}
