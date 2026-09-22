# TODO: Systematic CI Quality Gates

## Current Foundation

The `.github/workflows/ci.yml` workflow now provides the `Required quality gate` check for `dev`
and `main`; repository branch protection must mark it as required. It covers lint, type checking,
script and Vitest suites, a packaged Windows build, Electron integration tests, renderer component
tests, and product journeys. Release tags are rejected unless the exact tagged `main` commit has
passed that workflow. Branch protection and local reproduction details are documented in
`.github/CI.md`.

The items below remain the broader cross-platform and generated-artifact roadmap.

## Next Lab Server Test Coverage

These are the next test additions identified after the current server, protocol,
artifact, Electron, and CI entry-point coverage. Keep them in the lab-server
integration worktree and preserve the existing split between source-level fault
injection and target-system acceptance.

### P1: Real I/O and transfer failure boundaries

- [ ] Inject `ENOSPC` after the upload capacity pre-check, plus failures from
  `write`, `fsync`, and `rename`; assert no successful receipt, no temporary
  file or upload reservation leak, truthful restart state, and a successful
  retry after recovery.
- [ ] Add an integration case for the receiver's own upload timeout when the
  client stops sending bytes; assert the request terminates and all transfer
  state is released.
- [ ] Disconnect clients during archive download and ZIP export; assert file
  references and transfer slots are released, pending garbage collection can
  run, and later requests still succeed.
- [ ] Exercise graceful shutdown with an in-flight upload/download and verify
  durable receipts and resource cleanup after the next start.

### P1: Failure-aware test diagnostics

- [ ] Make polling helpers fail immediately when a backup reaches `failed` or a
  request has already terminated, including the stage and safe error code.
- [ ] Make process-worker waits report the first child error and logs instead
  of waiting for the full IPC timeout after a terminal failure.
- [ ] Keep diagnostics free of passwords, tokens, archive contents, and full
  database dumps.

### P2: Backup engine and shipped-artifact coverage

- [ ] Simulate a non-zero archive-engine exit, a stuck engine timeout, and a
  partially written encrypted output; assert cleanup, barrier release, correct
  terminal status, and a retryable backup.
- [ ] Add a formal-build workflow test that creates a backup with the shipped
  Node and archive engine, restores it through the shipped offline entry point,
  and verifies identity, receipts, archive bytes, and session revocation.

### P2: Sustained mixed load

- [ ] Extend the soak workload beyond the initial uploads: continue new
  submissions, retries, downloads, exports, and background heartbeats across
  restarts.
- [ ] Include representative audio archive sizes and record response-time and
  resource trends (transfers, file references, temporary files, open handles,
  heap, and RSS) without turning the current 12-device run into an unsupported
  classroom-scale SLA claim.

### P3: Requirements boundary audit

- [ ] Review renewal/expiry ordering, retention/GC timing, and shutdown races
  against the design documents and add only the missing semantic boundary
  cases.
- [ ] Keep true full-disk, ACL, NTFS durability, power-loss, and other
  platform-specific checks in the target-system acceptance suite rather than
  treating injected Linux failures as equivalent evidence.

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
2. Fails when canonical regeneration changes `docs/product` or the generated Playwright inventory.
3. Uploads `test-results/product-docs` and `test-results/product-docs-preview` when present.
4. Never publishes or commits regenerated files from CI.

## Acceptance Criteria

- Required checks protect the repository's primary integration branch.
- Pull requests cannot merge with lint, type, unit, Electron smoke, or required integration failures.
- Release and nightly workflows consume the same validated build/test primitives as pull requests.
- Generated-artifact checks include product documentation without granting CI permission to modify
  the repository.
- CI behavior and local reproduction commands are documented and kept in sync.
