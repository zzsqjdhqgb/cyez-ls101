/*
 * Test fixture: stands in for the packaged `manager.cjs` in the lab driver test.
 *
 * It speaks the real control-channel protocol (imported from the product, not reimplemented) and
 * echoes back what the parent sent, so the test can prove that the driver answers exactly one
 * `request`, forwards the operation and input, and reports the helper's result. Setting FAKE_FAIL
 * makes it answer with a failure envelope instead, which is how the redaction path is tested.
 */
import { requestLocalControl } from '../../packages/lab-server/src/control'

const index = process.argv.indexOf('--channel')
const channel = index === -1 ? undefined : process.argv[index + 1]
if (!channel) throw new Error('missing --channel')

const request = await requestLocalControl<{
  operation: string
  input: Record<string, unknown>
}>(channel, 'request')
const input = request.input ?? {}

if (process.env.FAKE_FAIL) {
  await requestLocalControl(channel, 'complete', {
    ok: false,
    error: 'LICENSE_INACTIVE',
    detail: 'installer detail that must not reach an initialize failure'
  })
} else {
  await requestLocalControl(channel, 'complete', {
    ok: true,
    value: {
      operation: request.operation,
      // Whether the key existed at all: the control channel distinguishes "no input" from `{}` and the
      // runtime requires `undefined` for the parameterless operations.
      hasInput: Object.hasOwn(request, 'input'),
      inputKeys: Object.keys(input).sort(),
      hasActivation: typeof input.activationCode === 'string' && input.activationCode.length > 0,
      hasPassword: typeof input.password === 'string' && input.password.length > 0,
      port: input.port,
      baseUrl: input.baseUrl
    }
  })
}
