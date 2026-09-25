<!--
status: draft
product-version: 0.4.1
audience: engineer
owner: ci
-->

# TODO: Systematic CI Quality Gates

## Current Foundation

The `.github/workflows/ci.yml` workflow now provides the `Required quality gate` check for `dev`
and `main`; repository branch protection must mark it as required. It covers lint, type checking,
script and Vitest suites, a packaged Windows build, Electron integration tests, renderer component
tests, and product journeys. Release tags are rejected unless the exact tagged `main` commit has
passed that workflow. Branch protection and local reproduction details are documented in
`.github/CI.md`.

The items below remain the broader cross-platform and generated-artifact roadmap.

## Known gaps (verified 2026-01, v0.4.1)

- **The `yarn typecheck` gate is vacuous.** `package.json` runs `tsc --noEmit -p tsconfig.json`, and
  `tsconfig.json` is a solution file containing only `references`; TypeScript therefore checks no
  files and the step passes unconditionally (`.github/workflows/ci.yml` runs it as the type gate).
- **The main-process project currently does not typecheck.** `npx tsc --noEmit -p tsconfig.node.json`
  reports 10 errors, all pre-existing:

  | File                                          | Error                                                                                                                                                                                             |
  | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `src/main/data-directory.ts:1007`             | `TS2304: Cannot find name 'LEGACY_DIRECTORIES'` (x2) — the identifier is referenced once and never defined or imported, so the legacy-copy bootstrap path would throw `ReferenceError` at runtime |
  | `src/main/bootstrap.ts:182`                   | `TS2345` — `MainStartupMilestoneEntry` lacks an index signature for `Record<string, unknown>`                                                                                                     |
  | `src/main/data-directory.ts:420,813,814,1324` | `TS2322` / `TS2345` — `formatVersion` literal widening, possibly-undefined paths, `PendingCleanup` passed where a bootstrap record is expected                                                    |
  | `src/main/legacy-data-worker.ts:18,19`        | `TS18047: 'parentPort' is possibly 'null'`                                                                                                                                                        |

- **A window-control integration test is flaky in the full run.**
  `tests/integration/electron-app.spec.ts › routes window controls through preload to the owning BrowserWindow`
  failed once inside the complete suite with `locator.click: Target page, context or browser has been closed`
  and passed when re-run alone, because it closes the owning window while later assertions still run.
  Either enable retries for the integration project or split the closing step into its own test.

- Fixing the gate means either converting the root `tsconfig.json` into a real solution build
  (`tsc -b`) or listing each referenced project explicitly, then repairing the errors above.
  Adding `LEGACY_DIRECTORIES` (or deleting the dead branch) is a code change and is not part of the
  current documentation work.

## Goal

Design and introduce project-wide CI quality gates as one coherent workflow strategy. Do not add
an isolated product documentation gate before the repository has consistent validation for its
main build, test, packaging, and generated-artifact paths.

## Required Coverage

- Define the supported operating-system and architecture matrix for development, packaging, and
  release validation.
- Run formatting or formatting checks, lint, and TypeScript type checking.
- Run script tests and the complete Vitest suite.
- Build the packaged Electron application and run the appropriate Electron smoke and integration
  suites on supported platforms.
- Run renderer component tests separately from packaged Electron integration tests.
- Build release artifacts far enough to detect packaging and native-dependency failures.
- Add the dedicated product documentation renderer check using `yarn docs:product:check` after the
  general CI foundation is in place.
- Verify generated documentation and other committed generated artifacts do not change after
  regeneration.
- Upload Playwright traces, screenshots, test reports, and relevant build logs when a job fails.
- Keep model downloads and other large external assets cached, isolated, and explicitly scoped to
  jobs that require them.

## Workflow Design

- Establish reusable jobs or reusable workflows instead of duplicating setup across release,
  nightly, and pull-request workflows.
- Separate fast pull-request gates from slower scheduled or release validation.
- Use path filters only where they cannot hide cross-cutting build or packaging regressions.
- Pin action versions and external build images, and define a deliberate dependency/image update
  process.
- Apply least-privilege workflow permissions; validation jobs should not receive write access.
- Add concurrency cancellation for superseded pull-request runs.
- Document required checks, expected runtime, ownership, and the procedure for diagnosing failures.

## Product Documentation Gate

When the general CI gates are established, add a Linux job that:

1. Runs `yarn docs:product:check` through the versioned product documentation Docker image.
2. Fails when canonical regeneration changes `docs/manual` or the generated Playwright inventory.
3. Fails when a canonical visual run changes `tests/visual/baselines` (the `canonical_visual` job already enforces this).
4. Uploads `test-results/product-docs` and `test-results/product-docs-preview` when present.
5. Never publishes or commits regenerated files from CI.

## Acceptance Criteria

- Required checks protect the repository's primary integration branch.
- Pull requests cannot merge with lint, type, unit, Electron smoke, or required integration failures.
- Release and nightly workflows consume the same validated build/test primitives as pull requests.
- Generated-artifact checks include product documentation without granting CI permission to modify
  the repository.
- CI behavior and local reproduction commands are documented and kept in sync.
