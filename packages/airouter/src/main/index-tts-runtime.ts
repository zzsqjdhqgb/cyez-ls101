import path from 'node:path'
import type { AIRouterSpeechModelPackageManifest } from '../shared'

/**
 * Application-side allowlist of accepted IndexTTS runtime digests, keyed by
 * `<platform>-<arch>` (for example `win32-x64` or `linux-x64`).
 *
 * Every runtime asset of a package is covered: the helper executable (`runtime-helper`) and each
 * shared library the helper loads from its own directory (`runtime-library`). Digests declared by
 * the package are not a security boundary — a hand-crafted package can declare any hash it likes —
 * so only digests compiled into the application are staged and executed. Each list is filled in
 * when the runtime release for that platform is cut; an empty or missing list rejects every
 * runtime asset of that platform.
 */
export const INDEX_TTS_HELPER_SHA256: Record<string, readonly string[]> = {}

const BACKEND_TOKENS: Record<'cpu' | 'cuda', string> = { cpu: '-cpu', cuda: '-cuda' }
const RUNTIME_HELPER = 'runtime-helper'
const RUNTIME_LIBRARY = 'runtime-library'
const PLATFORM_TOKEN_PATTERN =
  /(^|[/\\._-])((?:win32|linux|darwin|freebsd|openbsd|sunos|android)-(?:x64|arm64|ia32|arm|armhf|ppc64|ppc64le|s390x|riscv64|universal))([/\\._-]|$)/i
const BACKEND_TOKEN_PATTERN = /(^|[/\\._-])(cpu|cuda)([/\\._-]|$)/i

export type IndexTtsRuntimeAssetKind = 'runtime-helper' | 'runtime-library'

/** One package asset that has to be materialised before the helper may be spawned. */
export interface IndexTtsRuntimeAsset {
  assetPath: string
  kind: IndexTtsRuntimeAssetKind
  sha256: string
}

/** Runtime ready to be spawned: the helper that may be executed for the selected backend. */
export interface ResolvedIndexTtsRuntime {
  backend: 'cpu' | 'cuda'
  helperPath: string
}

export function isAllowedHelperDigest(
  key: string,
  sha256: string,
  allowlist: Record<string, readonly string[]> = INDEX_TTS_HELPER_SHA256
): boolean {
  const allowed = allowlist[key]
  if (!allowed?.length) return false
  const digest = sha256.trim().toLowerCase()
  if (!digest) return false
  return allowed.some((candidate) => candidate.trim().toLowerCase() === digest)
}

/**
 * Resolves every runtime asset a model package contributes for one platform and backend.
 *
 * The helper is picked from `models[].artifacts['runtime-helper']` exactly as before: an entry that
 * names both the platform and the backend wins, a single entry naming the backend is the fallback,
 * and anything missing or ambiguous returns `null` so the caller fails closed.
 *
 * The libraries are the assets declared with kind `runtime-library` plus the paths listed under
 * `artifacts['runtime-library']`. An entry that explicitly names another platform, or an explicit
 * backend other than the selected one, is skipped; a library declared next to the selected helper
 * is always kept, because the helper loads it from its own directory (CMake RPATH `$ORIGIN`).
 * Asset paths are compared case-insensitively and `/` and `\` are treated alike.
 *
 * The returned list is deterministic — the helper first, then the libraries sorted by asset path —
 * and every entry carries the digest declared in `assets[]`. A missing declaration for the helper
 * or for any selected library returns `null`.
 */
export function selectRuntimeAssets(
  manifest: AIRouterSpeechModelPackageManifest,
  modelId: string,
  backend: 'cpu' | 'cuda',
  platformKey: string = `${process.platform}-${process.arch}`
): IndexTtsRuntimeAsset[] | null {
  const artifacts = manifest.models.find((model) => model.id === modelId)?.artifacts
  const helperPaths = artifacts?.[RUNTIME_HELPER]
  if (!helperPaths?.length) return null
  const token = BACKEND_TOKENS[backend]
  const platform = normalizeAssetPath(platformKey)
  const backendMatches = helperPaths
    .map((assetPath) => ({ assetPath, normalized: normalizeAssetPath(assetPath) }))
    .filter((candidate) => candidate.normalized.includes(token))
  const platformMatches = platform
    ? backendMatches.filter((candidate) => candidate.normalized.includes(platform))
    : []
  const candidates = platformMatches.length ? platformMatches : backendMatches
  if (candidates.length !== 1) return null
  const [candidate] = candidates
  if (!candidate) return null
  const helperDigest = declaredDigest(manifest, candidate.assetPath)
  if (!helperDigest) return null
  const libraries = selectLibraries(
    manifest,
    artifacts?.[RUNTIME_LIBRARY],
    backend,
    platformKey,
    candidate.normalized
  )
  if (!libraries) return null
  return [
    { assetPath: candidate.assetPath, kind: RUNTIME_HELPER, sha256: helperDigest },
    ...libraries
  ]
}

/**
 * Directory that holds the staged runtime of one package version: the helper and its libraries
 * side by side, so the helper finds them through its `$ORIGIN` RPATH. The result is a pure function
 * of its inputs; path segments are sanitised so a hostile package id or version cannot escape the
 * runtime root.
 */
export function runtimeStagingDirectory(
  runtimeRoot: string,
  platformKey: string,
  packageId: string,
  packageVersion: string
): string {
  return path.join(
    runtimeRoot,
    stagingSegment(platformKey),
    `${stagingSegment(packageId)}-${stagingSegment(packageVersion)}`
  )
}

/** File name a runtime asset is staged under: its real basename, tolerating `\` separators. */
export function runtimeAssetBasename(assetPath: string): string {
  const normalized = assetPath.trim().replaceAll('\\', '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function selectLibraries(
  manifest: AIRouterSpeechModelPackageManifest,
  artifactPaths: readonly string[] | undefined,
  backend: 'cpu' | 'cuda',
  platformKey: string,
  helperNormalizedPath: string
): IndexTtsRuntimeAsset[] | null {
  const declared = new Map<string, string>()
  for (const asset of manifest.assets) {
    if (asset.kind === RUNTIME_LIBRARY) declared.set(normalizeAssetPath(asset.path), asset.path)
  }
  for (const assetPath of artifactPaths ?? []) {
    const normalized = normalizeAssetPath(assetPath)
    if (!declared.has(normalized)) declared.set(normalized, assetPath)
  }
  const helperDirectory = assetDirectory(helperNormalizedPath)
  const selected: IndexTtsRuntimeAsset[] = []
  for (const [normalized, assetPath] of declared) {
    if (!libraryApplies(normalized, backend, platformKey, helperDirectory)) continue
    const sha256 = declaredDigest(manifest, assetPath)
    if (!sha256) return null
    selected.push({ assetPath, kind: RUNTIME_LIBRARY, sha256 })
  }
  return selected.sort((left, right) => comparePaths(left.assetPath, right.assetPath))
}

function libraryApplies(
  normalizedPath: string,
  backend: 'cpu' | 'cuda',
  platformKey: string,
  helperDirectory: string
): boolean {
  // Libraries shipped next to the selected helper are the ones it loads at runtime.
  if (assetDirectory(normalizedPath) === helperDirectory) return true
  const platform = normalizedPath.match(PLATFORM_TOKEN_PATTERN)?.[2]
  if (platform && platform.toLowerCase() !== normalizeAssetPath(platformKey)) return false
  const backendToken = normalizedPath.match(BACKEND_TOKEN_PATTERN)?.[2]
  return !backendToken || backendToken.toLowerCase() === backend
}

function declaredDigest(
  manifest: AIRouterSpeechModelPackageManifest,
  assetPath: string
): string | null {
  const normalized = normalizeAssetPath(assetPath)
  const declared = manifest.assets.find((asset) => normalizeAssetPath(asset.path) === normalized)
  const sha256 = declared?.sha256.trim().toLowerCase()
  return sha256 ? sha256 : null
}

function comparePaths(left: string, right: string): number {
  const normalizedLeft = normalizeAssetPath(left)
  const normalizedRight = normalizeAssetPath(right)
  if (normalizedLeft === normalizedRight) return 0
  return normalizedLeft < normalizedRight ? -1 : 1
}

function assetDirectory(normalizedPath: string): string {
  const separator = normalizedPath.lastIndexOf('/')
  return separator < 0 ? '' : normalizedPath.slice(0, separator)
}

function stagingSegment(value: string): string {
  const segment = value.trim().replace(/[^A-Za-z0-9._-]+/g, '_')
  return !segment || segment === '.' || segment === '..' ? '_' : segment
}

function normalizeAssetPath(value: string): string {
  return value.trim().toLowerCase().replaceAll('\\', '/')
}
