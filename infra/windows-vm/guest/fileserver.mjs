/* eslint-disable @typescript-eslint/explicit-function-return-type */
/*
 * File server for host <-> guest transfers inside the disposable lab VM.
 *
 * The host reaches it through the Vagrant forwarded port (guest 8765 -> host 127.0.0.1:18765),
 * so bulk transfers are plain HTTP instead of WinRM base64 chunks: uploads use PUT, downloads use
 * GET. Only the guest needs a firewall rule, which lab.mjs adds over WinRM before this server
 * starts, so the host machine needs no rule and stays untouched.
 *
 * Endpoints (file names are flat; directories are never accepted):
 *   GET  /health          liveness probe
 *   PUT  /files/<name>    write <uploads>/<name>, used for the source snapshot and guest scripts
 *   GET  /files/<name>    read  <uploads>/<name>
 *   GET  /results/<name>  read  <results>/<name>, used for logs and acceptance artifacts
 *
 * Standalone usage inside the guest:
 *   node fileserver.mjs --port 8765 --uploads C:\ls101-lab\transfers \
 *     --results C:\ls101-lab\results --log C:\ls101-lab\results\fileserver.log
 */

import { createReadStream, createWriteStream } from 'node:fs'
import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

// Guards against a runaway writer; the source snapshot is tens of megabytes.
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024

// Rejects anything that could escape the served directory: separators, parent references and NUL
// bytes. Windows also treats a trailing dot or space specially, so those are refused too.
export function safeFileName(value) {
  if (typeof value !== 'string') return null
  if (value.length === 0 || value.length > 255) return null
  if (value === '.' || value === '..') return null
  if (/[\\/\0]/.test(value)) return null
  if (/[. ]$/.test(value)) return null
  return value
}

function send(response, statusCode, body = '') {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(body)
}

// Streams a file and returns the number of bytes sent, or 0 when the file does not exist.
async function sendFile(response, filePath) {
  let info
  try {
    info = await stat(filePath)
  } catch {
    send(response, 404, 'not found')
    return 0
  }
  if (!info.isFile()) {
    send(response, 404, 'not a file')
    return 0
  }
  // The host compares content-length with the bytes it received: that is the transfer integrity
  // check, and it replaces the byte counting the chunked WinRM reader had to do itself.
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': info.size
  })
  await pipeline(createReadStream(filePath), response)
  return info.size
}

export function createFileServer({ uploads, results, log } = {}) {
  const writeLog = async (line) => {
    if (!log) return
    await appendFile(log, `${new Date().toISOString()} ${line}\n`, 'utf8').catch(() => undefined)
  }

  // The handler never rejects. An async request listener whose promise rejects becomes an unhandled
  // rejection, and Node then ends the process: a single aborted download (the host closing a socket
  // mid-transfer, a probe that gives up) was enough to kill the whole file server, after which every
  // later request failed with "socket hang up". The failure is logged and answered instead.
  const handle = async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://guest')
    const [, kind, rawName] = url.pathname.split('/')

    if (kind === 'health') {
      send(response, 200, 'ok')
      return
    }
    if (kind !== 'files' && kind !== 'results') {
      send(response, 404, 'unknown endpoint')
      return
    }

    const name = safeFileName(decodeURIComponent(rawName ?? ''))
    if (!name) {
      await writeLog(`400 ${request.method} ${url.pathname}`)
      send(response, 400, 'invalid file name')
      return
    }
    const root = kind === 'files' ? uploads : results
    const target = path.join(root, name)

    if (request.method === 'GET') {
      const bytes = await sendFile(response, target)
      await writeLog(`${bytes ? 200 : 404} GET ${kind}/${name} ${bytes} bytes`)
      return
    }
    if (kind === 'files' && request.method === 'PUT') {
      const length = Number(request.headers['content-length'] ?? 0)
      if (Number.isFinite(length) && length > MAX_UPLOAD_BYTES) {
        send(response, 413, 'upload too large')
        return
      }
      await mkdir(root, { recursive: true })
      // Write next to the target and rename, so a failed upload never replaces a good file.
      const temporary = `${target}.part-${process.pid}`
      try {
        await pipeline(request, createWriteStream(temporary))
        await rename(temporary, target)
      } catch (error) {
        await unlink(temporary).catch(() => undefined)
        await writeLog(`500 PUT ${kind}/${name} ${error.message}`)
        send(response, 500, 'upload failed')
        return
      }
      const info = await stat(target)
      await writeLog(`201 PUT ${kind}/${name} ${info.size} bytes`)
      send(response, 201, `${info.size}`)
      return
    }
    await writeLog(`405 ${request.method} ${url.pathname}`)
    send(response, 405, 'method not allowed')
  }

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(async (error) => {
      await writeLog(`500 ${request.method} ${request.url} ${error.message}`)
      // A response whose headers are already on the wire cannot be replaced: drop the socket so the
      // client sees a failed transfer instead of a truncated one.
      if (response.headersSent) response.destroy()
      else send(response, 500, 'request failed')
    })
  })

  server.on('clientError', (_error, socket) => socket.destroy())
  return server
}

export function parseArguments(argv) {
  const options = {
    port: 8765,
    uploads: path.join('C:', 'ls101-lab', 'transfers'),
    results: path.join('C:', 'ls101-lab', 'results'),
    log: null
  }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (flag === '--port') options.port = Number(value)
    else if (flag === '--uploads') options.uploads = value
    else if (flag === '--results') options.results = value
    else if (flag === '--log') options.log = value
    else throw new Error(`unknown argument: ${flag}`)
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    throw new Error('--port must be a valid TCP port')
  }
  return options
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const server = createFileServer(options)
  server.listen(options.port, '0.0.0.0', () => {
    console.log(`file server listening on 0.0.0.0:${options.port}`)
    console.log(`uploads: ${options.uploads}`)
    console.log(`results: ${options.results}`)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
