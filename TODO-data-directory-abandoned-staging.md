# TODO: Abandoned Legacy-Copy Staging Directory Is Never Cleaned Up

Status: open.

## Problem

`abandonPendingMigration` (`src/main/data-directory.ts`) is the recovery path used when the data
directory cannot be initialized: the user selects an existing managed data directory and the pending
migration record is replaced with a `ready` record. Copy migrations convert the abandoned transaction
into a pending cleanup when the staging directory cannot be removed immediately:

```ts
const cleanup = pendingCleanupFromMigration(bootstrap)
const pendingCleanups = (await tryRemovePendingCleanup(cleanup))
  ? existing
  : [...existing, cleanup]
```

The `legacy-copy` branch returns before that bookkeeping:

```ts
if (bootstrap.mode === 'legacy-copy') return { pendingCleanups: existing }
```

`pendingCleanupFromMigration` accepts `LegacyCopyingBootstrap`, and `prepareLegacyStaging` already
persists the staging identity, so the record needed for a later cleanup is available. The staging
directory (`.${basename(target)}.migrating-${migrationId}` next to the target) is therefore left on
disk without any pending-cleanup entry, and later startups only retry the cleanups listed in
`pendingCleanups`.

## Root Cause

- The `legacy-copy` branch short-circuits before the cleanup bookkeeping used by `copy` migrations.
- Nothing in the recovery path re-discovers an abandoned staging directory: `retryPendingCleanups`
  only walks the persisted `pendingCleanups` array.

## Impact

- A staging directory containing copies of the legacy subdirectories stays behind after recovery; it
  is not listed in the settings page (`oldDataDirectory` is separate) and is never removed
  automatically.
- No data is corrupted and no user data is lost: the legacy originals stay in the user data directory
  and are handled by the legacy archive/cleanup flow, so the staging copy is redundant.
- `mode: 'legacy-copy'` is only read back from existing `data-location.json` records; no current code
  schedules a new legacy-copy migration, so this affects legacy compatibility data only.
- Severity: low (recovery path plus legacy mode only).

## Reproduction

1. Prepare a `data-location.json` with `state: "migrating"`, `mode: "legacy-copy"`,
   `legacyDirectories`, `staging`, `parentPath`/`parentIdentity`, and a staging directory containing
   copied legacy subdirectories.
2. Make `initializeDataDirectory` fail for that record (for example, make the target parent
   unavailable so `finishPendingMigration` throws) so `recoverDataDirectory` opens the native dialog.
3. Choose "选择已有数据目录" and select a valid managed data directory.
4. Inspect the resulting `data-location.json`: it is a `ready` record with no `pendingCleanups` entry
   for the abandoned staging path, while the staging directory still exists on disk.

A focused main-process test can drive `recoverDataDirectory` with mocked `dialog` calls (as the
existing `tests/main/data-directory.test.ts` cases do) and inspect the written `data-location.json`.

## Proposed Fix

- In the `legacy-copy` branch, build `pendingCleanupFromMigration(bootstrap)`, try
  `tryRemovePendingCleanup(cleanup)`, and keep the record in `pendingCleanups` when removal fails,
  mirroring the `copy` branch. Reuse `assertSelectionSeparateFromPendingCleanups` for the staging path
  if the selected directory could contain it.
- If the residue must be kept instead, state that intent in the branch and make sure the settings page
  or the legacy archive flow can surface and remove it.

## Acceptance Criteria

- After abandoning a `legacy-copy` migration, its staging directory is either removed immediately or
  listed in `pendingCleanups` and removed by `retryPendingCleanups` on a later start.
- The staging path is guarded by the same selection-separation rules as copy migrations.
- A `tests/main/data-directory.test.ts` case covers the abandoned legacy-copy migration.
- Existing data-directory migration and recovery tests keep passing.
