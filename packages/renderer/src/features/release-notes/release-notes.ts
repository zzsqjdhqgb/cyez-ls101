const releaseFiles = import.meta.glob('./releases/*.md', {
  eager: true,
  import: 'default',
  query: '?raw'
}) as Record<string, string>

export const latestReleaseVersion = '0.4.0'

export function normalizeReleaseVersion(version: string): string | null {
  return version.match(/\d+\.\d+\.\d+/)?.[0] ?? null
}

export function getReleaseNote(version: string): string {
  const normalized = normalizeReleaseVersion(version)
  const selected = normalized ? releaseFiles[`./releases/${normalized}.md`] : undefined
  const fallback = releaseFiles[`./releases/${latestReleaseVersion}.md`]

  if (selected) return selected
  if (fallback) return fallback
  throw new Error(`Release note is missing for ${latestReleaseVersion}`)
}
