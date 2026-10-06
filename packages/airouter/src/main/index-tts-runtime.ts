import type { AIRouterSpeechModelPackageManifest } from '../shared'

/**
 * Application-side allowlist of accepted IndexTTS runtime helper digests, keyed by
 * `<platform>-<arch>` (for example `win32-x64` or `linux-x64`).
 *
 * The helper ships inside the model package, so the digest declared by the package is not a
 * security boundary — a hand-crafted package can declare any hash it likes. Only digests
 * compiled into the application may be executed. Each list is filled in when the runtime
 * release for that platform is cut; an empty or missing list rejects every helper.
 */
export const INDEX_TTS_HELPER_SHA256: Record<string, readonly string[]> = {}

const BACKEND_TOKENS: Record<'cpu' | 'cuda', string> = { cpu: '-cpu', cuda: '-cuda' }

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

export interface ResolvedIndexTtsHelper {
  path: string
  sha256: string
  backend: 'cpu' | 'cuda'
}

/**
 * Picks the runtime helper declared by a model package for one platform and backend.
 *
 * An entry that names both the platform and the backend wins; without such an entry a single
 * entry naming the backend is accepted as a fallback. Anything ambiguous or missing returns
 * `null` so the caller can fail closed. The digest comes from the matching `assets[]`
 * declaration, which the model store has already verified at import time.
 */
export function selectHelperAsset(
  manifest: AIRouterSpeechModelPackageManifest,
  modelId: string,
  backend: 'cpu' | 'cuda',
  platformKey: string = `${process.platform}-${process.arch}`
): { assetPath: string; sha256: string } | null {
  const artifacts = manifest.models.find((model) => model.id === modelId)?.artifacts[
    'runtime-helper'
  ]
  if (!artifacts?.length) return null
  const token = BACKEND_TOKENS[backend]
  const platform = normalizeAssetPath(platformKey)
  const backendMatches = artifacts
    .map((assetPath) => ({ assetPath, normalized: normalizeAssetPath(assetPath) }))
    .filter((candidate) => candidate.normalized.includes(token))
  const platformMatches = platform
    ? backendMatches.filter((candidate) => candidate.normalized.includes(platform))
    : []
  const candidates = platformMatches.length ? platformMatches : backendMatches
  if (candidates.length !== 1) return null
  const { assetPath } = candidates[0]
  const declared = manifest.assets.find(
    (asset) => normalizeAssetPath(asset.path) === normalizeAssetPath(assetPath)
  )
  const sha256 = declared?.sha256.trim().toLowerCase()
  return sha256 ? { assetPath, sha256 } : null
}

function normalizeAssetPath(value: string): string {
  return value.trim().toLowerCase().replaceAll('\\', '/')
}
