/* eslint-disable @typescript-eslint/explicit-function-return-type */

/*
 * ASAR entry allowlist for the lab desktop packages.
 *
 * `@electron/asar`'s `listPackage` builds entry paths with `path.join`, so the same archive lists
 * `/main/index.js` on Linux and `\main\index.js` on Windows. Comparing those raw entries against a
 * forward-slash pattern made every Windows package fail with "Unexpected packaged dependencies"; the
 * normalisation lives here so both the check and the recorded audit file stay platform-independent.
 */

const ALLOWED = /^\/(main|preload|renderer)(\/|$)/
const ROOT_PACKAGE = '/package.json'

export function normalizeAsarEntries(entries) {
  return entries.map((entry) => entry.replaceAll('\\', '/'))
}

// Returns the entries the lab packages must never contain: anything outside the three built
// directories and the root package.json, which is what keeps dependencies, test fixtures and the
// source tree out of a shipped client.
export function unexpectedAsarEntries(entries) {
  return normalizeAsarEntries(entries).filter(
    (entry) => !ALLOWED.test(entry) && entry !== ROOT_PACKAGE
  )
}
