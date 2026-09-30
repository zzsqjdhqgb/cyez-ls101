/*
 * The registry is the contract between three things that are edited in different places: the phase
 * script in the guest (`infra/windows-vm/guest/lab-acceptance.mjs`) that invokes a command by name, the
 * module that implements it, and the bundler that has to inline it. A missing or renamed export is
 * otherwise discovered by a VM run that fails with "does not export" — ten minutes in.
 *
 * Resolving every entry here also proves the modules import cleanly, which is what the bundler relies on.
 */
import { describe, expect, it } from 'vitest'
import { commands } from './index'

describe('protocol driver registry', () => {
  it('registers a handler for every command the phase run can invoke', () => {
    const names = Object.keys(commands)
    expect(names.length).toBeGreaterThan(0)
    for (const name of names)
      expect(typeof commands[name], `${name} must be a handler`).toBe('function')
  })

  it('does not register commands with characters a shell would have to quote', () => {
    for (const name of Object.keys(commands)) expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
  })
})
