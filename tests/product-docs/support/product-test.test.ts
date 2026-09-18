import { describe, expect, it } from 'vitest'
import { installDeterministicRandomUuid } from './product-test'

describe('installDeterministicRandomUuid', () => {
  it('generates a repeatable sequence of valid UUID v4 values', () => {
    const cryptoObject = { randomUUID: () => 'unseeded' }
    installDeterministicRandomUuid(cryptoObject)

    expect(cryptoObject.randomUUID()).toBe('00000000-0000-4000-8000-000000000001')
    expect(cryptoObject.randomUUID()).toBe('00000000-0000-4000-8000-000000000002')
    expect(cryptoObject.randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    )
  })
})
