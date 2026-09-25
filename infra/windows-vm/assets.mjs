/* eslint-disable @typescript-eslint/explicit-function-return-type */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

// Fixed official assets, not mutable "latest" URLs. See SOURCES.md for provenance.
export const defaultIsoUrls = {
  WindowsIso:
    'https://software-static.download.prss.microsoft.com/sg/download/888969d5-f34g-4e03-ac9d-1f9786c66749/SERVER_EVAL_x64FRE_en-us.iso',
  VMwareToolsIso:
    'https://packages.vmware.com/tools/releases/13.1.5/windows/VMware-tools-windows-13.1.5-25544008.iso'
}
const isoKeys = Object.keys(defaultIsoUrls)
const hashPattern = /^[a-f\d]{64}$/i

export async function exists(file) {
  try {
    await access(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

export async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

export async function verifyHash(file, expected) {
  if (!hashPattern.test(expected)) throw new Error(`Invalid SHA-256 for ${file}`)
  if ((await sha256(file)) !== expected.toLowerCase()) {
    throw new Error(`SHA-256 mismatch: ${file}; existing files were not replaced`)
  }
}

function downloadUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Download URLs must use HTTPS without embedded credentials')
  }
  return url
}

export function validateIsoConfig(config) {
  for (const key of isoKeys) {
    const url = config[`${key}Url`]
    const hash = config[`${key}Sha256`]
    if (url) downloadUrl(url)
    if (hash === 'auto') {
      if (url !== defaultIsoUrls[key]) {
        throw new Error(
          `${key}Sha256=auto requires the fixed official ${key}Url from config.example.json; custom/local ISOs require a reviewed SHA-256`
        )
      }
    } else if (typeof hash !== 'string' || !hashPattern.test(hash)) {
      throw new Error(`Fill in ${key}Sha256, or use "auto" with the fixed official URL`)
    }
  }
}

async function fetchDownload(url, fetcher, signal, officialHost) {
  let current = downloadUrl(url)
  for (let redirect = 0; redirect <= 5; redirect++) {
    if (officialHost && current.hostname !== officialHost) {
      throw new Error(
        'Official ISO download redirected to a different host; update the source and provide a reviewed SHA-256'
      )
    }
    const response = await fetcher(current.href, { redirect: 'manual', signal })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      if (!location) throw new Error('Download redirect has no Location header')
      current = downloadUrl(new URL(location, current).href)
      continue
    }
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel()
      throw new Error(
        `Download failed: HTTP ${response.status} from ${current.origin}${current.pathname}`
      )
    }
    return { response, finalUrl: current.href }
  }
  throw new Error('Too many download redirects')
}

async function assertIso(file) {
  const handle = await open(file, 'r')
  try {
    const signature = Buffer.alloc(5)
    const { bytesRead } = await handle.read(signature, 0, signature.length, 16 * 2048 + 1)
    if (bytesRead !== 5 || signature.toString('ascii') !== 'CD001') {
      throw new Error(
        'Downloaded file is not an ISO-9660 image (possibly an HTML login/error page)'
      )
    }
  } finally {
    await handle.close()
  }
}

// expected=null is only used for the first download of an explicitly allowlisted official ISO.
export async function downloadAsset(
  url,
  file,
  expected,
  { fetcher = fetch, iso = false, officialHost, progress = console.log } = {}
) {
  if (expected !== null && !hashPattern.test(expected))
    throw new Error(`Invalid SHA-256 for ${file}`)
  if (await exists(file)) {
    if (expected === null)
      throw new Error(
        `Existing ISO has no recorded SHA-256: ${file}. Set a reviewed hash or move the file aside before downloading.`
      )
    await verifyHash(file, expected)
    return { sha256: expected.toLowerCase(), reused: true }
  }
  if (!url) throw new Error(`Missing ${file}. Set its ISO URL or provide the file locally.`)
  const source = downloadUrl(url)
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.part`
  const hash = createHash('sha256')
  let bytes = 0
  let lastProgress = 0
  try {
    progress(`Downloading ${source.origin}${source.pathname}`)
    const { response, finalUrl } = await fetchDownload(
      url,
      fetcher,
      AbortSignal.timeout(4 * 60 * 60 * 1000),
      officialHost
    )
    const lengthHeader = response.headers.get('content-length')
    const total = lengthHeader === null ? null : Number(lengthHeader)
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        hash.update(chunk)
        bytes += chunk.length
        if (Date.now() - lastProgress > 10000) {
          lastProgress = Date.now()
          const size = `${Math.round(bytes / 1024 / 1024)} MiB`
          progress(
            total > 0
              ? `${size} / ${Math.round(total / 1024 / 1024)} MiB (${Math.floor((bytes / total) * 100)}%)`
              : size
          )
        }
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body),
      meter,
      createWriteStream(temporary, { flags: 'wx' })
    )
    if (total !== null && (!Number.isSafeInteger(total) || total !== bytes))
      throw new Error('Incomplete download: Content-Length mismatch')
    const actual = hash.digest('hex')
    if (expected !== null && actual !== expected.toLowerCase())
      throw new Error(`SHA-256 mismatch: ${file}`)
    if (iso) await assertIso(temporary)
    await rename(temporary, file)
    progress(
      `Saved ${path.basename(file)} (${Math.round(bytes / 1024 / 1024)} MiB), SHA-256 ${actual}`
    )
    return { sha256: actual, bytes, finalUrl, reused: false }
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}

async function readIsoLock(root) {
  const file = path.join(root, '.local', 'generated', 'iso-lock.json')
  if (!(await exists(file))) return { version: 1, assets: {} }
  const lock = JSON.parse(await readFile(file, 'utf8'))
  if (lock.version !== 1 || !lock.assets || typeof lock.assets !== 'object')
    throw new Error('Invalid iso-lock.json')
  return lock
}

function lockedHash(config, key, lock) {
  const configured = config[`${key}Sha256`]
  if (configured !== 'auto') return configured
  const entry = lock.assets[key]
  if (!entry) return null
  if (entry.url !== config[`${key}Url`] || !hashPattern.test(entry.sha256)) {
    throw new Error(
      `${key} does not match iso-lock.json; provide a reviewed SHA-256 for a different source`
    )
  }
  return entry.sha256
}

export async function prepareIsos(root, config, options = {}) {
  validateIsoConfig(config)
  const lock = await readIsoLock(root)
  const inventory = []
  for (const key of isoKeys) {
    const url = config[`${key}Url`]
    const file = path.resolve(root, config[key])
    const expected = lockedHash(config, key, lock)
    const auto = config[`${key}Sha256`] === 'auto'
    const result = await downloadAsset(url, file, expected, {
      ...options,
      iso: true,
      officialHost: auto ? new URL(defaultIsoUrls[key]).hostname : undefined
    })
    if (auto && !lock.assets[key]) {
      lock.assets[key] = {
        url,
        finalUrl: result.finalUrl,
        sha256: result.sha256,
        bytes: result.bytes,
        recordedAt: new Date().toISOString(),
        verification: 'first-download-from-official-https'
      }
      // Save each completed asset before starting the next download, so retries can reuse it.
      const destination = path.join(root, '.local', 'generated', 'iso-lock.json')
      await mkdir(path.dirname(destination), { recursive: true })
      const temporary = `${destination}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(lock, null, 2) + '\n', { flag: 'wx' })
        await rename(temporary, destination)
      } finally {
        await unlink(temporary).catch((error) => {
          if (error.code !== 'ENOENT') throw error
        })
      }
    }
    inventory.push({
      file,
      url,
      hash: result.sha256,
      verification: auto ? 'first-download-from-official-https' : 'configured-sha256'
    })
  }
  return inventory
}

// Building never downloads or learns a new hash. It consumes configured or previously locked values.
export async function resolveIsoHashes(root, config) {
  validateIsoConfig(config)
  const lock = await readIsoLock(root)
  const resolved = { ...config }
  for (const key of isoKeys) {
    const hash = lockedHash(config, key, lock)
    if (hash === null)
      throw new Error(`Run yarn vm:prepare to download and record ${key} before building`)
    resolved[`${key}Sha256`] = hash
  }
  return resolved
}
