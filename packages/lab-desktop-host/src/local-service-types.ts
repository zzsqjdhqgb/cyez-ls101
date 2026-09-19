import type { Schema } from '@ls101/lab-contracts'
import type { LicenseStatus } from '@ls101/core-types'

export interface LocalServiceStatus {
  state: 'not-installed' | 'stopped' | 'uninitialized' | 'running' | 'unavailable'
  autostart: boolean
  releaseVersion: string | null
  license: LicenseStatus | null
  info: Schema<'Info'> | null
  port: number | null
  error: string | null
  fingerprint?: string | null
  settings?: {
    name: string
    baseUrl: string
    revision: number
    securityRevision: number
  } | null
}

export interface LocalServiceInitialization {
  name: string
  baseUrl: string
  password: string
  activationCode: string
  port: number
}

export interface LocalServiceConnection {
  baseUrl: string
  serverId: string
  fingerprint: string
  localProof: string
}
