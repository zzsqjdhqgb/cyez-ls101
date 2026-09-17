/*
 * Request shape for the driver's own HTTPS probes.
 *
 * Every operation in docs/lab-server.openapi.yaml declares X-LS101-Client-Version as a required header,
 * and the service validates that contract before dispatching. A probe that omits it is answered with
 * 400 INVALID_REQUEST — which is exactly what happened: the first real request this harness ever made
 * to the service was rejected, and the hand-written stub in the test agreed with the bug because it
 * answered 200 to anything.
 *
 * Keeping the request shape in one pure module lets the container test validate it against the
 * product's generated contract, so the expectation comes from the product rather than from a guess.
 */

// The base path is fixed in packages/lab-server/src/http.ts; the route comes from the contract entry
// for getInfo and is asserted against it in the tests.
export const PROBE_PATH = '/api/v1/info'
export const PROBE_OPERATION = 'getInfo'

export function buildProbeHeaders(version) {
  if (typeof version !== 'string' || version.length === 0 || version.length > 128) {
    throw new Error(
      `A client version of 1 to 128 characters is required; received ${JSON.stringify(version)}`
    )
  }
  return { 'X-LS101-Client-Version': version }
}
