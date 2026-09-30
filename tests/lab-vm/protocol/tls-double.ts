/*
 * A TLS server that stands in for the lab service when the case under test is what the *client* does
 * before it is willing to talk: N1 has to show that a wrong pin produces no HTTP request and no
 * credentials at all, which cannot be observed from the client side of a real service.
 *
 * The key below is a throwaway generated for this fixture. It is not a secret and is never trusted by
 * anything but this driver: the double is served on loopback, and only the fingerprint computed from
 * the certificate at start-up is ever handed to the transport under test.
 */
import { createServer, type Server } from 'node:https'
import { X509Certificate } from 'node:crypto'
import { once } from 'node:events'
import { spkiOf } from './context'

const CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIIBTDCB86ADAgECAgEBMAoGCCqGSM49BAMCMCcxJTAjBgNVBAMTHExTMTAxIHBy
b3RvY29sIGRyaXZlciBkb3VibGUwHhcNMjYwMTAxMDAwMDAwWhcNMzYwMTAxMDAw
MDAwWjAnMSUwIwYDVQQDExxMUzEwMSBwcm90b2NvbCBkcml2ZXIgZG91YmxlMFkw
EwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEhWaRQ8Vj1cOqq4A8wSPyJQ1JXXVsKvc+
GNncZRKYH8Uc5hwh8q88p0NpX+esACzk8Le2FGKNSdkVG2e1z4L/4aMQMA4wDAYD
VR0TAQH/BAIwADAKBggqhkjOPQQDAgNIADBFAiB1/+dDRYjvKF237jH3zGKUEXCD
dHgVGjXPYl2GCSg3DwIhANnjy/Py9u0377p3AzKkZbw9EAwuQ1HoFntW48BN5e/8
-----END CERTIFICATE-----
`

const PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg2GayrpgP7JT/UTBO
us93WFAccIIOKTTL0EineRPwl+uhRANCAASFZpFDxWPVw6qrgDzBI/IlDUlddWwq
9z4Y2dxlEpgfxRzmHCHyrzynQ2lf56wALOTwt7YUYo1J2RUbZ7XPgv/h
-----END PRIVATE KEY-----
`

export interface TlsDouble {
  baseUrl: string
  fingerprint: string
  // Accepted TCP connections. The client rejects a wrong pin as soon as it has read the certificate,
  // which means it destroys the socket immediately after its own handshake flight: whether the server
  // got as far as emitting `secureConnection` before the FIN arrives is a race, so the deterministic
  // evidence is that a connection was accepted at all and that no request was ever written to it.
  connections: number
  // Completed TLS handshakes. Reported for information; do not assert on it.
  handshakes: number
  requests: number
  requestBytes: number
  close(): Promise<void>
}

export async function startTlsDouble(): Promise<TlsDouble> {
  const fingerprint = spkiOf(new X509Certificate(CERTIFICATE))
  const state = { connections: 0, handshakes: 0, requests: 0, requestBytes: 0 }
  const server: Server = createServer(
    { key: PRIVATE_KEY, cert: CERTIFICATE },
    (request, response) => {
      state.requests++
      request.on('data', (chunk: Buffer) => {
        state.requestBytes += chunk.length
      })
      request.on('end', () => {
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            serverId: '00000000-0000-4000-8000-000000000000',
            name: 'Driver double',
            apiVersion: 1,
            releaseVersion: 'double',
            serverTime: new Date().toISOString(),
            readiness: 'ready'
          })
        )
      })
    }
  )
  server.on('connection', () => {
    state.connections++
  })
  server.on('secureConnection', () => {
    state.handshakes++
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('the TLS double did not bind a port')
  return {
    baseUrl: `https://127.0.0.1:${address.port}/`,
    fingerprint,
    get connections() {
      return state.connections
    },
    get handshakes() {
      return state.handshakes
    },
    get requests() {
      return state.requests
    },
    get requestBytes() {
      return state.requestBytes
    },
    close: async () => {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
