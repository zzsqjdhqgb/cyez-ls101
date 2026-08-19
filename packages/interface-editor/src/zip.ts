import { strToU8, unzip, zip } from 'fflate'
import type { InterfaceInstance } from '@ls101/core-types'
import { inspectInterfacePackage } from './exchange'
import { isInterfaceId } from './id'
import { InterfaceRepositoryError } from './repository'
import type { InterfaceExchangePackage } from './exchange'
import type { InterfaceDef } from './types'

const MANIFEST_PATH = 'manifest.json'
const INTERFACE_PATH = 'interface.json'
const MAX_FILES = 10_000
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const INSTANCE_PATH_PATTERN = /^instances\/([0-9a-f-]+)\/instance\.json$/i
const ASSET_PATH_PATTERN = /^instances\/([0-9a-f-]+)\/assets\/([a-zA-Z0-9][a-zA-Z0-9_.-]*)$/i
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface ZipManifest {
  format: 'ls101-interface-zip'
  version: 2
  exportedAt: string
  interfaceId: string
  builtin?: { builtinKey: string; interfaceId: string }
  instances: Array<{
    instanceId: string
    assets: string[]
  }>
}

export async function encodeInterfaceZip(value: InterfaceExchangePackage): Promise<Uint8Array> {
  await inspectInterfacePackage(value)
  const files: Record<string, Uint8Array> = {}
  const manifest: ZipManifest = {
    format: 'ls101-interface-zip',
    version: 2,
    exportedAt: value.exportedAt,
    interfaceId: value.interface.id,
    ...(value.builtin ? { builtin: value.builtin } : {}),
    instances: value.instances.map(({ instance, assets }) => ({
      instanceId: instance.instanceId,
      assets: Object.keys(assets).sort()
    }))
  }

  files[MANIFEST_PATH] = jsonBytes(manifest)
  files[INTERFACE_PATH] = jsonBytes(value.interface)
  for (const { instance, assets } of value.instances) {
    const base = `instances/${instance.instanceId}`
    files[`${base}/instance.json`] = jsonBytes(instance)
    for (const [filename, data] of Object.entries(assets)) {
      files[`${base}/assets/${filename}`] = data
    }
  }

  return zipAsync(files)
}

export async function decodeInterfaceZip(data: Uint8Array): Promise<InterfaceExchangePackage> {
  if (!(data instanceof Uint8Array)) throw invalidZip('Interface file must contain binary data')

  const files = await unzipAsync(data)
  validatePaths(files)
  const manifest = readJson<ZipManifest>(files, MANIFEST_PATH)
  assertManifest(manifest)
  const def = readJson<InterfaceDef>(files, INTERFACE_PATH)
  if (def.id !== manifest.interfaceId) {
    throw invalidZip('ZIP manifest Interface ID does not match interface.json')
  }

  const expectedPaths = new Set([MANIFEST_PATH, INTERFACE_PATH])
  const instances = manifest.instances.map(({ instanceId, assets }) => {
    const instancePath = `instances/${instanceId}/instance.json`
    expectedPaths.add(instancePath)
    const instance = readJson<InterfaceInstance>(files, instancePath)
    if (instance.instanceId !== instanceId) {
      throw invalidZip(`Instance ID does not match its ZIP path: ${instanceId}`)
    }

    const assetData: Record<string, Uint8Array> = {}
    for (const filename of assets) {
      const assetPath = `instances/${instanceId}/assets/${filename}`
      expectedPaths.add(assetPath)
      const asset = files[assetPath]
      if (!asset) throw invalidZip(`Missing instance asset: ${assetPath}`)
      assetData[filename] = asset
    }
    return { instance, assets: assetData }
  })

  for (const path of Object.keys(files)) {
    if (!expectedPaths.has(path)) throw invalidZip(`Unexpected file in Interface ZIP: ${path}`)
  }

  return {
    format: 'ls101-interface',
    version: 2,
    exportedAt: manifest.exportedAt,
    interface: def,
    ...(manifest.builtin ? { builtin: manifest.builtin } : {}),
    instances
  }
}

function assertManifest(value: ZipManifest): void {
  if (
    !isRecord(value) ||
    value.format !== 'ls101-interface-zip' ||
    value.version !== 2 ||
    typeof value.exportedAt !== 'string' ||
    Number.isNaN(Date.parse(value.exportedAt)) ||
    typeof value.interfaceId !== 'string' ||
    !isInterfaceId(value.interfaceId) ||
    (value.builtin !== undefined &&
      (!isRecord(value.builtin) ||
        typeof value.builtin.builtinKey !== 'string' ||
        typeof value.builtin.interfaceId !== 'string' ||
        value.builtin.interfaceId !== value.interfaceId)) ||
    !Array.isArray(value.instances)
  ) {
    throw invalidZip('Invalid Interface ZIP manifest')
  }

  const ids = new Set<string>()
  for (const entry of value.instances) {
    if (
      !isRecord(entry) ||
      typeof entry.instanceId !== 'string' ||
      !UUID_V4_PATTERN.test(entry.instanceId) ||
      !Array.isArray(entry.assets) ||
      entry.assets.some(
        (filename) => typeof filename !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(filename)
      ) ||
      new Set(entry.assets).size !== entry.assets.length ||
      ids.has(entry.instanceId)
    ) {
      throw invalidZip('Invalid Interface ZIP instance manifest')
    }
    ids.add(entry.instanceId)
  }
}

function validatePaths(files: Record<string, Uint8Array>): void {
  const paths = Object.keys(files)
  if (paths.length > MAX_FILES) throw invalidZip('Interface ZIP contains too many files')

  let totalBytes = 0
  for (const path of paths) {
    totalBytes += files[path].byteLength
    if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
      throw invalidZip('Interface ZIP is too large after decompression')
    }
    if (
      path.includes('\\') ||
      path.startsWith('/') ||
      path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      throw invalidZip(`Unsafe path in Interface ZIP: ${path}`)
    }
    if (
      path !== MANIFEST_PATH &&
      path !== INTERFACE_PATH &&
      !INSTANCE_PATH_PATTERN.test(path) &&
      !ASSET_PATH_PATTERN.test(path)
    ) {
      throw invalidZip(`Unsupported path in Interface ZIP: ${path}`)
    }
  }
}

function readJson<T>(files: Record<string, Uint8Array>, path: string): T {
  const data = files[path]
  if (!data) throw invalidZip(`Missing required file: ${path}`)
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data)) as T
  } catch {
    throw invalidZip(`Invalid UTF-8 JSON file: ${path}`)
  }
}

function jsonBytes(value: unknown): Uint8Array {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`)
}

function zipAsync(files: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, data) => (error ? reject(error) : resolve(data)))
  })
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  let fileCount = 0
  let totalBytes = 0
  return new Promise((resolve, reject) => {
    unzip(
      data,
      {
        filter(file) {
          fileCount += 1
          totalBytes += file.originalSize
          if (fileCount > MAX_FILES || totalBytes > MAX_UNCOMPRESSED_BYTES) return false
          return true
        }
      },
      (error, files) => {
        if (error) return reject(invalidZip(`Cannot read Interface ZIP: ${error.message}`))
        if (fileCount > MAX_FILES)
          return reject(invalidZip('Interface ZIP contains too many files'))
        if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
          return reject(invalidZip('Interface ZIP is too large after decompression'))
        }
        if (fileCount !== Object.keys(files).length) {
          return reject(invalidZip('Interface ZIP contains duplicate file paths'))
        }
        resolve(files)
      }
    )
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalidZip(message: string): InterfaceRepositoryError {
  return new InterfaceRepositoryError('INVALID_DATA', message)
}
