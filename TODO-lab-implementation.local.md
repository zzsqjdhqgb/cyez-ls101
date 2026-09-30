# Lab Implementation Checkpoint

## Remaining implementation authorized on 2026-09-08

Baseline: `60eef2d`; user explicitly requested completion of the remaining implementation. Preserve uncommitted handoff/TODO updates and original submissions. Do not stage or commit.

- [x] Teacher local service host, encrypted elevation exchange, initialize/connect/start/stop/autostart/logs/restore UI.
- [x] Isolated desktop packaging, platform service installation, unattended startup and data-preserving upgrades (target OS acceptance remains separate).
- [x] Teacher unknown-write recovery, connection isolation, revision conflicts, frozen selections and pagination.
- [x] Student shutdown/save coordination, rebind/admission races and IPC capability validation.
- [x] Server stable pagination, durable batch outcomes, task aggregation/expiry, retention and bounded resources.
- [x] Deterministic failure/race coverage, dependency audits, packaged smoke and complete integration verification (full suite had one deadline timeout; unchanged targeted spec passed).
- [x] Target-system acceptance instructions and explicit remaining Windows/Linux/audio/power-loss results in docs/lab-target-acceptance.md.
- [ ] Execute target-system acceptance: native Windows build/SCM/UAC/ACL/directory barriers; Linux systemd/login/reboot; real audio, classroom load and power loss. Container evidence cannot close these items.

Current continuation updated 2026-09-09: implementation details and exact test outcomes are at the top of HANDOFF-lab-implementation.md. Final Linux student and teacher deb packages built and passed ASAR audits. Full regression had one license deadline timeout (80/81); unchanged targeted license spec passed both cases, components passed 9/9. Final smoke passed 12/12, lab integration passed 2/2, host tests passed 10/10 including export and transfer cleanup, and typechecks/lint passed. No build/test session remains running. Older unchecked stage lists below are historical.

## Continuation on 2026-09-08

- [x] Reconcile temporary commit `943b969` with the previous handoff; user authorized continuation.
- [x] Standalone Node service/CLI and packaged runtime test.
- [x] License-aware explicit initialization and encrypted local control/proof issuance.
- [x] Offline backup verification, restore index cleanup, retained original directory and interrupted-switch recovery.
- [x] License/listener configuration snapshot and persistent failed-backup garbage collection.
- [x] Linux installation artifacts, immutable program versions, fixed data account and operational documentation.
- [x] Server tests, contract checks, typechecks, initial runtime artifact verification and packaged smoke.
- [x] Final lab/full regression and static checks: 27 server tests, 5 design-contract tests, packaged Node runtime, 12 smoke tests, lab round trip, 81 Electron tests and 9 component tests passed. Component browser revision 1234 was missing; installed the required Playwright headless shell and reran components successfully. See HANDOFF for the combined-command exit distinction.
- [ ] Teacher local service UI/host wiring; full desktop installers, Windows SCM/ACLs, unattended deployment and upgrade coordination.
- [ ] Remaining state/race/retention/resource audits and real Windows/audio/power-loss acceptance.

The older checkpoint below is historical. Current work is uncommitted and must not be staged or committed by the agent. This TODO is tracked by the user's temporary commit despite its original local-only intent; exclude future TODO/handoff changes from feature commits unless the user directs otherwise.

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

## Milestone M3 (installed-product GUI over CDP) and M4 (upgrade / uninstall / retention)

Added 2026-09-18, after M1 and M2 went green on a real Windows host. Case definitions are `docs/lab-vm-acceptance-design.md` §6 Tier 3 (G1–G8) and Tier 4 (U1–U5); this is the implementation order, not a restatement of them.

### M3 — GUI driver (Tier 3)

- [ ] CDP driver: launch the **installed** teacher/student exe in the guest's interactive session with a remote-debugging port, attach with `chromium.connectOverCDP`, and expose small helpers (wait for window, read text, click by role/name, screenshot). Planned home: `tests/lab-vm/gui-driver.ts` next to the existing drivers, bundled like them.
- [ ] Playwright config for attachments (`playwright.lab-vm.config.ts`) so a VM run can record traces/screenshots into the results directory.
- [ ] The GUI driver must not need the source tree: drive only the installed application, and take every secret from a file (same rule as the other drivers).
- [ ] G1 launch + "invalid startup argument" prompt (this is expected product behaviour, not a defect).
- [ ] G2 connection page shows the real named-pipe status, version, licence, service identity and fingerprint — cross-check against the control channel's own answer rather than trusting the screen.
- [ ] G3 the full local-service path through the UI after driver A performed install/start/initialize.
- [ ] G4 student `--activate` and `<file.lsjoin> --server-fingerprint <fp>`, then assert the device appears in the teacher's device list.
- [ ] G5 second instance: a second launch with a new join file must not create a second window/process; the command is handled by the first instance.
- [ ] G6 full practice through the UI: browse → HTTPS cache download → start grant → short deterministic playback → record → save → upload → receipt on screen.
- [ ] G7 maintenance standby full-screen window and mode sync.
- [ ] G8 student autostart after a real reboot (`vagrant reload`) and service autostart following its setting.
- [ ] Note: G6 overlaps N7 (already proven at the protocol level); the GUI case adds renderer orchestration, real cache download and the recording pipeline. Keep the protocol evidence and the GUI evidence separate in the report.

### M4 — upgrade, uninstall and retention (Tier 4)

- [ ] A second release artifact. The harness currently packages one version; U1/U2/U4 need "same version again" and "a different version". Decide between a version override for the packaging step and a prepared pair, and record which digests were installed.
- [ ] U1 same-version overwrite install: succeeds without an upgrade-ready record; data and the autostart setting are unchanged.
- [ ] U2 remove `upgrade-ready.json`, install the different version: must fail, and the old service must still be running afterwards.
- [ ] U3 NSIS uninstall of the teacher client: service registration and business data are **retained** (`teacher.nsh` has no `customUnInstall`).
- [ ] U4 `manageLocalService('uninstall')` through driver A: registration and autostart disappear, data is retained, the teacher UI reports "not installed"; reinstall and prove the original serverId and receipts still work.
- [ ] U5 uninstall while the service is running must be refused.
- [ ] Ordering: U3/U4 destroy the installation, so they run last, after M1/M2/M3 assertions; U4's reinstall needs the installer still on the guest.
- [ ] Retention assertions must reuse values captured earlier in the same run (serverId, a submission receipt) and compare them after reinstall, not just assert "something exists".

### Both

- [ ] The guest phase currently stops at the first failure; with M3/M4 appended the run gets long (30+ minutes). Consider a documented way to run a subset (for example an env/flag that selects tiers) so a GUI or uninstall failure does not hide everything after it.
- [ ] Update `docs/lab-vm-acceptance-design.md` §12, `docs/lab-target-acceptance.md` items 5–7, and the VM README when these land.
