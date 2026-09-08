# Lab Implementation Checkpoint

Temporary working record. Update during implementation and before handoff.
This file does not replace the design documents or grant implementation approval.

## Current Status

- Updated: 2026-09-07.
- Workspace: /workspace.
- Branch: feat/lab-deployment.
- Inspected HEAD: 3fc8834.
- Comparison baseline: origin/dev (4ca0972a).
- User requested complete implementation, with plan confirmation before coding.
- User explicitly approved the seven-stage plan on 2026-09-07 and instructed implementation to begin.
- User suggested a goal or temporary TODO to preserve progress across compaction.
- Deployment-test stage is implemented; final regression is in progress.
- No goal created yet.
- Preserve the two pre-existing untracked .lssubmission files.

## Sources of Truth

- docs/lab-deployment-design.md: product scope and precedence.
- docs/lab-server-api-design.md and docs/lab-server.openapi.yaml: HTTP contracts.
- docs/lab-server-storage-design.md: transactions, recovery, backup barriers.
- docs/lab-student-state-design.md: admission, submissions, retries, tasks.
- docs/lab-desktop-design.md: desktop boundaries, builds, installation.
- docs/lab-teacher-workflow-design.md: teacher workflows.
- docs/lab-implementation-design.md: implementation and acceptance sequence.
- AGENTS.md: repository working and verification rules.

The branch adds seven Markdown documents, one OpenAPI file, and one contract
test file relative to origin/dev. There is no lab application implementation.
OpenAPI describes 51 paths and 61 operations.

## Approved Plan

- [ ] 1. Establish a requirement-to-implementation/test checklist. Confirm the
     current contracts, especially API section 12.2, storage section 6, and student
     state section 8. Resolve contradictions in the contracts before coding them.
- [ ] 2. Add independent student/teacher entries and lab-contracts, lab-client,
     lab-desktop-host, lab-server packages. Generate types and runtime validators.
     Reuse licensing and archive/player logic. Verify standalone Node, SQLite,
     service hosting, native ABI packaging, and secure 7z password delivery early.
- [ ] 3. Implement SQLite models, directory ownership, transaction coordination,
     initialization/recovery, HTTPS trust, teacher/local authentication, enrollment,
     device configuration, version admission, service modes, and heartbeat ordering.
- [ ] 4. Complete exam management, verified local cache, practice grants,
     playback, reliable local saves, upload queue, receipts, and teacher submission
     management. Add stable player identity/time/archive and generic host hooks.
     Cover maintenance, reconnect, restart, manual retry, rebind, and stale responses.
- [ ] 5. Complete teacher pages and student maintenance UI, task leases,
     cancellation/reporting, real deployment tests with isolated data, and confirmed
     snapshot-based history cleanup. Include local/remote connection isolation.
- [ ] 6. Complete backup admission barriers, SQLite snapshots, encrypted archive
     publishing, idempotency, crash recovery, offline restore, installation,
     unattended startup/enrollment, service autostart, and data-preserving upgrades.
- [ ] 7. Complete deterministic race/crash tests, static checks, Electron smoke,
     targeted and full integration suites, package dependency audits, and target
     Windows acceptance instructions/results.

Stages organize dependencies; the final scope is the complete documented product.

## Non-Negotiable Behavior

- Desktop business orchestration stays in renderer controllers; main/preload
  expose narrow validated OS, network, credential, and persistence capabilities.
- Standalone server must not depend on Electron. Student artifacts must exclude
  server/SQLite, AI/models, editors, Playwright, and test activation bypasses.
- Verify trusted SPKI before sending credentials; no automatic trust replacement.
- Reuse existing licensing rules; no new licensing system.
- Students require exact release version agreement; diagnostic compatibility
  does not grant business access.
- Complete local archive persistence precedes upload and local completion UI.
- Successful receipt requires durable archive plus committed index/receipt.
- Stable submission ID, submittedAt, and archive survive save retries.
- Maintenance blocks formal uploads and receipt queries. Ordinary failures stay
  manual; maintenance recovery checks receipts before any permitted resend.
- Persisted successful receipts end network scheduling permanently, including
  after server deletion or backup restore.
- Rebinding preserves all records; old incomplete submissions become receipt-only.
- Cleanup requires a confirmed fixed snapshot and successful local receipts.
- Task cancellation/expiry stops new effects; late reports cannot revive tasks.
- Backup pending/running blocks mode exit, task claims, and another backup.
  Snapshot barriers additionally block conflicting writes; encryption after
  snapshot release permits ordinary writes but retains the other blockers.
- Restore clears backup indexes and backup-create idempotency mappings only;
  preserve formal receipts and unrelated business idempotency records.

## Findings and Technical Checks

- Existing ExamPlayer generates submission ID/time inside finishSubmission and
  rebuilds its archive on save retry; this requires the documented adjustment.
- exam-package imports pure schema functions through schema-editor. Inspect and
  isolate the required pure dependency without bringing editor functionality
  into the lab artifacts.
- LicenseService in src/main/license-service.ts is Node-based reusable logic;
  integration-test overrides must not enter production lab activation paths.
- Container Node observed: v24.20.0. Packaged runtime versions remain to be pinned.
- node_modules, dist, and out passed fs.access(W_OK). Mount listing contains an
  underlying read-only host mount and an overlaid writable node_modules volume.
  This is a preliminary check, not proof that all future build outputs work.
- Secure 7z engine integration and target service hosting are not yet verified.

## Verification Completed

- Command: node --test scripts/**tests**/lab-design-contract.test.js
- Result: 5 passed, 0 failed.
- This checks document/contract structure only, not runtime business behavior.
- No application smoke/build/integration tests run during initial planning.

## Working Rules and Acceptance

- After renderer/preload/main edits, default runtime smoke command:
  xvfb-run -a yarn test:smoke
- Add targeted Electron specs for new behavior; run the complete integration
  suite for the final cross-cutting implementation.
- Use yarn dev:docker only for the manual runtime cases specified in AGENTS.md.
- Stop immediately and ask for environment repair if node_modules is read-only,
  a required build output cannot be written, or a required native tool exists
  only as a Windows .exe. Do not work around those conditions.
- Do not run git add or git commit. Provide exact commands to the user instead.
- No backward-compatible migrations for unreleased schemas are required unless
  requested; preserve a schema-version entry point and fail without data reset.
- Backend acceptance requires the user's verification; prepare reproducible
  requests, results, and concurrency tests for review.
- Windows SCM/account permissions, power-loss persistence, and real audio need
  target-system acceptance. Do not claim container tests cover them.

## Pause Checkpoint (2026-09-07)

The user requested: continue, then pause after the current development stage.
The agreed stopping point is the teacher basic workflows and student history
cleanup round trip plus verification. Do not start another stage without a new
user instruction. This checkpoint is NOT completion of the full seven-stage plan.
The current stage and its verification are complete; work is paused here.

## Resumed Stage (2026-09-07)

- User committed the prior stage as 3fc8834 and instructed work to continue.
- Implemented deployment-test round trip, isolated local storage, real media
  and player execution, durable reporting, teacher confirmation and failed-case retry.
- Verify this stage and pause before service hosting/installation work.
- Baseline student build passed before implementation.
- Added deterministic bitmap, PCM audio, choice and short-recording test package.
- Student executor runs installed cases only, reuses ExamPlayer, StudentRecords
  under test-data, and SubmissionQueue. Recovery exercises a scoped failed upload,
  retained archive/manual retry state, manual retry, and durable receipt. Duplicate
  upload discards its response and verifies receipt identity through a query.
- Test leases gate local test storage/archive capabilities; result acceptance
  invalidates the local lease. Partial case results persist before final reporting;
  restart reports interruption without resuming playback or recording.
- Playback/audio automatic results remain manual-required. Teacher confirmations
  are initialized from selected manual cases, revision checked and separate from
  automatic results. Failed-case retry creates a new per-device batch with retryOf.
- Chromium fake media is enabled in tests/lab/student-entry.mjs only; production
  startup argument validation and licensing remain in force.
- Related Vitest: 67 passed in 12 files. Student/teacher renderer typechecks,
  lab/server/player project builds, scoped ESLint and diff checks pass.
- Required packaged smoke: 12 passed. Latest lab Electron integration passed,
  including eight cases, manual confirmation, failed-case retry, cancellation
  during live recording, ended media tracks, preserved formal history, stale
  lease rejection and the previous history-cleanup round trip.
- Inspected student-deployment.png and teacher-deployment.png screenshots under
  test-results/lab; bitmap, choices and separate automatic/manual results render.
- Full existing regression: xvfb-run -a yarn test:playwright:run is running in
  session 82619, using the exact package built by the successful smoke command.
  Poll completion and update this entry before pausing.

- Added generated API types, operation metadata, static Ajv validators, and lab-client.
  Static validators replace runtime compilation to satisfy renderer CSP.
- Added Node 24 SQLite server, durable archives/receipts, identity/pinned TLS,
  authentication, enrollment, devices, grants, task leases and encrypted backup.
  All 61 handlers exist; this is not evidence that every behavior is complete.
- Extracted license service into packages/license; existing app re-exports it.
- Server certificates now include valid X.509 extensions. Empty extensions were
  accepted by Node but rejected by Electron/BoringSSL; real Electron test covers it.
- Added student main/preload, host binding/cache/records/network capabilities,
  student admission/controller/submission queue, renderer and independent build.
- Added player pre-start/phase hooks, stable submission ID/time, archive reuse.
- Added teacher main/preload/renderer and independent build, trusted remote
  connection, exams/submissions/devices, maintenance and settings screens.
- Teacher writes persist a sanitized operation journal before transmission.
  Renderer preserves unknown idempotency keys in memory for identical retries.
- Student history tasks persist intent before claim, validate conservative lease
  deadlines, stop on failed renewal, and persist immutable results before report.
- Cleanup uses confirmed canonical snapshots, verifies successful receipts and
  lease immediately before delete, journals individual deletes and recovers
  missing files without repeating effects. Successful receipts remain permanently.
- Rebind commands suspend and settle renderer background queues before applying.
- Credential-reset enrollment probes the old credential and rotates the secret;
  same-service idempotent enrollment keeps the original context only for same secret.
- Local archive save intent now contains fixed expected digest and size before
  bounded chunks arrive. Published archives recover; incomplete parts do not queue.
- Fixed cross-package source import in pin test and removed its 12 accidental
  generated JS/declaration files from packages/lab-server/src.
- Added tests/lab/student.spec.ts and playwright.lab.config.ts. Real Electron test
  passes enrollment, maintenance, practice, durable upload/receipt, teacher login,
  leading-zero device edit, and preview/confirm/delete with preserved receipt.
- Screenshots: test-results/lab/student-history.png and teacher-devices.png.

### Verification At This Checkpoint

- Independent student and teacher electron-vite builds pass.
- Lab contract generation check passes; 61 generated operation validators.
- Related Vitest run: 62 tests passed in 12 files (before adding 3 hook tests).
- Player suite after adding authorization/retry/late-response tests: 12 passed.
- Maintenance tests cover backup claim 409/503, renewal stop, immutable result
  retry, restart without old lease execution. Record tests cover recovery,
  corruption, ownership/order, confirmed deletion and no double counting.
- Student/teacher renderer typechecks and lab/server/player project builds pass,
  including the latest player test typecheck correction (session 99527 exited 0).
- Scoped ESLint and git diff --check passed.
- Required packaged smoke: 12 passed.
- Full Playwright suite passed: 81 Electron integration tests and 9 component
  tests (xvfb-run -a yarn test:playwright; session 55838 exited 0).
- No git add or git commit has been run. Original .lssubmission files preserved.

### Reproduction

- yarn lab:build:student
- yarn lab:build:teacher
- xvfb-run -a yarn lab:test:integration
- xvfb-run -a yarn test:smoke
- xvfb-run -a yarn test:playwright

### Outstanding Work (Do Not Report Product Complete)

- Deployment-test runtime and reporting are implemented in the resumed stage.
  Test-data retention/garbage collection, bounded long-term cache resources and
  target-machine real audio acceptance remain in the later audits.
- Complete IPC input validation/role audit, admission/reconnect/controller races,
  current and old connection policy, bounded resource use and shutdown/save
  coordination. Closing during local save is not yet a completed workflow.
- Review rebind/poll races, pending-secret scoping, missing binding/generation
  corruption, and immutable original archive publication after failed final writes.
- Student request policy has been added; audit old-binding receipt queries,
  admission states, task result reporting and archive handle ownership further.
- Teacher UI remains a baseline, not full acceptance: revision-conflict reload,
  persistent unknown-write recovery UI, destructive-selection freezing, full
  maintenance pagination/device pickers and local/remote service controls still
  need completion and tests. Confirmation seeding and failed-case retry are done.
- Standalone service entry, authenticated local IPC, installers/autostart/upgrades,
  offline restore and backup configuration/licensing snapshot are missing.
- Server semantics audit remains: persistent GC on failed backup/cleanup, stable
  pagination, durable bulk-item results, expiry/revision aggregation, retention,
  resource reservations and log redaction.
- Backup password stdin adapter currently rejects newline/NUL although the
  contract accepts them; backup engine version/packaging requires resolution.
- Lab installer/package configs, pinned standalone runtime, dependency/ABI audits,
  target-system startup, audio, permissions and power-loss checks remain.
- Prepare reproducible backend acceptance and Windows service/audio/power-loss
  acceptance. User must perform target-system checks; container cannot prove them.
