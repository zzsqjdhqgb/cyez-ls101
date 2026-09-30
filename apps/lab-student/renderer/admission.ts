import type { Schema } from '@ls101/lab-contracts'
import type { BindingSummary } from '@ls101/lab-desktop-host'

export interface AdmissionFacts {
  active: boolean
  initialized: boolean
  serverConfigured?: boolean
  binding: BindingSummary | null
  connected: boolean
  state: Schema<'StudentState'> | null
}

export function admission(facts: AdmissionFacts): string {
  if (!facts.active) return 'activation-required'
  if (!facts.initialized) return 'local-unavailable'
  if (!facts.binding) return facts.serverConfigured ? 'offline' : 'unbound'
  if (facts.binding.versionMismatch || facts.state?.availability === 'version-mismatch')
    return 'version-mismatch'
  if (!facts.connected) return 'offline'
  if (!facts.state || facts.state.availability === 'service-unavailable')
    return 'service-unavailable'
  if (facts.state.availability === 'license-inactive') return 'service-unavailable'
  if (!facts.state.device.enabled) return 'disabled'
  if (facts.binding.maintenanceLocked || facts.state.mode === 'maintenance') return 'maintenance'
  return 'ready'
}

export function canViewRecords(facts: AdmissionFacts): boolean {
  const state = admission(facts)
  return (
    state === 'ready' ||
    (state === 'offline' &&
      !!facts.binding &&
      !facts.binding.maintenanceLocked &&
      !facts.binding.versionMismatch)
  )
}
