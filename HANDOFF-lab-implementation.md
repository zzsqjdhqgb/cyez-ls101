# HANDOFF: lab-deployment implementation

## Milestone M4 target acceptance implemented (2026-09-19, current)

Branch state as before; M4 (Tier 4: upgrade, uninstall, data retention) is now implemented in the same harness and **verified in the container lane only** — no real-Windows run has happened since it was written. Do not report M4 as passed on a target machine until `yarn vm:lab` is green.

What M4 adds to `yarn vm:lab` (seven guest steps, so the guest phase is 33 steps: M1 15 + M2 11 + M4 7):

- **U1 `upgrade-same-version-reinstall`** — **stops the service first**, reinstalls the same package with NSIS `/S`, verifies the service stayed registered and stopped, then starts it and checks identity, certificate, autostart, exam digest and the absence of a preparation record. The stop is not optional: `install-windows.ps1` requires it, and `--prepare-install` against a *running* service demands maintenance mode plus a backup, so the first version of this case (service left running, as the teacher's UI leaves it) made the install fail inside the NSIS hook and hang on its MessageBox until the 900 s timeout. That is how the open risk 2 in the design document was confirmed. The installer's own decision is recomputed first (`runtime-manifest.json` digests must match), so the case proves "no preparation is required" rather than "it happened to pass".
- **U2 `upgrade-without-preparation`** — points `installation.json` at a real copied release whose manifest digest differs, then runs the installer twice: once with no preparation record at all, once with the record that first attempt produced (which names the release already installed). Both must exit non-zero without hanging, and after both the old service must still be running, the record unchanged and the control channel still reporting the same serverId. The step restores the record and removes the preparation in a `finally`.
- **U2 `upgrade-prepared`** — enters maintenance, creates a **real backup** through the protocol driver (`backup` command: `postTeacherBackups` + poll to `ready`; `prepare-upgrade` verifies snapshot age, byte count and digest), then runs the teacher NSIS installer directly — the checklist's own wording, and the only path that exercises `teacher.nsh`'s `customInstall`, through which the installed service is asked to prepare and stop itself. Asserts the new release, the consumed preparation, unchanged serverId/fingerprint, the exam digest, and that a deleted submission still answers with its receipt.
- **U3 `client-uninstall-keeps-service`** — runs the client's own `QuietUninstallString` from the registry (no guessed executable name): client executable gone, service still registered and running, `installation.json` and autostart unchanged, exam still downloadable.
- **U4/U5 `service-uninstall-and-reinstall`** — autostart is turned on first so "unchanged" cannot be confused with "reset"; uninstalling while running must fail with `RESOURCE_BUSY`; after stopping, the real `manageLocalService('uninstall')` removes the registration while the program directory, record and business data stay; reinstalling the same package registers the service again (stopped, `Manual`), and starting it brings back the same serverId, the same exam digest and the surviving receipt. Autostart is left at demand start.

New pieces behind those steps: `tests/lab-vm/protocol/commands/backup.ts` (+ registry entry, + container spec `backup.test.ts`), `manager-driver` now runs the product's second entry point (`manager.cjs --prepare-install`) and reports a refused operation as data with `--raw`, and the `uninstall-entry` probe returns `UninstallString`/`QuietUninstallString`. `S18`'s secret scan was widened to scan **by value in two passes** — management password and the captured invitation code before the protocol cases, plus the archive password and the proof/device-secret files the driver received afterwards — across all three artefacts. Container verification: `yarn vm:test` (65 assertions in `windows-vm.test.js` plus 9 driver ones), `yarn test:scripts`, `yarn lab:typecheck`, and the `lab-vm` vitest lane (45 tests, including the two new backup ones) — all green.

First real-machine attempt (2026-09-19, runId `1789797014897-7e991ee7-fef0-4477-8933-8968b3190c63`) stopped at step 15 `secret-scan` on a **harness** error, not a product one: that snapshot's single scan pass demanded three secrets several steps before the proof and device-secret files exist. The two-pass fix above is what came out of it.

The next three attempts walked the M4 ladder one case at a time and each stopped on a harness defect of its own — a missing `InstallLocation` in the uninstaller discovery, `reinstallTargets` comparing the package against itself, the installer being run against a live service — all of which are fixed and pinned by `windows-vm.test.js`. As of run `1789857465686-29cd71d2-776b-4356-8e77-c1258981d962` the first three M4 steps pass on a real machine (`upgrade-packages`, `upgrade-initial-state`, `upgrade-same-version-reinstall`); `upgrade-without-preparation` reached its first refusal and hung there for the full 900 s on the NSIS failure dialog.

**That hang was the open risk 2, and it is now fixed in the product**: `teacher.nsh` skips the `MessageBox` in silent installs, prints the exit code and the captured installer output, sets exit level 2 and still aborts. Everything from `upgrade-without-preparation` onwards (the two refusals, the prepared upgrade, the client uninstall, the service uninstall/reinstall and the final leak pass) has still never run to completion on a real machine. Do not report M4 as passed.

Boundaries worth repeating: M4 does **not** cover the Linux deb upgrade path; the "other version" in U2 is a copied release with a different manifest digest, so it proves the version-change admission rule rather than cross-version migration; and the student installer is only checked for presence in the guest, not installed.

## Milestone M1/M2 target acceptance on Windows (2026-09-18)

Branch `feat/lab-deployment`. The Windows service and the client/server protocol are no longer "unexecuted on Windows": both milestones now run end to end on a real Windows host and are green. Design, matrix and findings: `docs/lab-vm-acceptance-design.md` (§5 test lanes, §6 Tier 0–2, §12 status, §13 findings). Commands live in `infra/windows-vm/README.md`.

What runs where:

- **`yarn vm:lab`** (about 20 minutes on the host) builds both installers on Windows with the pinned Node 24.20.0, boots a disposable Windows Server 2022 VM, installs the teacher package and the WinSW-hosted service, then runs 26 guest steps — M1 15 + M2 11 — followed by a host-side check that reaches the guest over the real VM network. Failures preserve the VM and collect a diagnostic; success halts and destroys it. Evidence lands in `infra/windows-vm/.local/results/`; `yarn vm:destroy` is required before a rerun after any failure.
- **`yarn lab:typecheck`** and **`yarn test:vitest`** (project `lab-vm`) run the same protocol commands against the real `LabService` over real TLS in this container, with an injectable clock, so protocol semantics are checked in seconds instead of a VM cycle.
- **`yarn vm:test`**, `scripts/__tests__/*` cover the host orchestration, the bundling and the guest script's structure.

Green runs (each 26 guest steps plus host verification, `success: true`):

- M1 first full green: runId `1789661969192-a443907b-4923-4a0e-8d9f-62c5c250ada8` (2026-09-17).
- M2 first full green: runId `1789700556225-8611e188-d83c-41fc-9907-4e3fe01aea6b` (2026-09-18).
- M2 green with the N7 fix and a strict re-upload assertion: runId `1789702105294-f6c6c5fc-a198-432f-ba04-4dc938b9cdf1`, teacher `66d47933dc053e5102fb75ad08067a280a4236b9ce8b2569673d99b769c4c0a1`, student `0fb58ed897f1489aa6248b0d880788952ab015edab4cbf128f6ef31256788d0d`.

What the two milestones now prove on a real machine (not from container results): installer and service registration with the virtual service account and hardened ACLs; the 0.0.0.0 listener and SPKI pinning verified by an independent process; activation and licence window; graceful stop/restart through the SCM; standard-user isolation; the firewall gate measured from the host (unreachable before the deployment rule, reachable after); no secret in any artefact; pin-before-any-request; the loopback-only session exemption and its refusal to a forged `X-Forwarded-For`; enrollment batch issuance, two-process registration and replay idempotency plus six negative shapes; heartbeat liveness with the 20-second offline threshold and retained last-known values; a 32-connection, 1280-heartbeat load run with no transport errors; exam publication, independent-digest download, practice grant, 3 MiB submission upload, receipt, idempotent re-upload, teacher download and receipt survival after deletion; maintenance admission and practice continuation; a task lease keeping maintenance blocked until its 30-second expiry; the 8-upload and 64-handler ceilings with their distinct codes.

Product defects found and fixed by this work, all of which container tests could not see:

1. Windows packaging always failed: `@electron/asar` returns backslash paths on Windows (`scripts/lab/package-audit.mjs` now normalises them).
2. The service installed into `Program Files (x86)`: the 32-bit NSIS installer launched 32-bit PowerShell, whose WOW64 redirection rewrote every `C:\Program Files` path (`install-server-windows.ps1` re-runs itself through `Sysnative`).
3. The service could never stop: WinSW appends `<arguments>` to `<stoparguments>`, so the stop command line carried the `serve` arguments too, the CLI rejected it as `INVALID_ARGUMENTS`, and the SCM waited in `Stop Pending` forever because `<stoptimeout>` only applies when WinSW kills the process itself (`LS101Lab.xml` now uses `<startarguments>`, with a contract test).
4. A replayed submission could lose its receipt: the server answered from the digest header without reading the archive, so the client was still writing when the socket closed and received `EPIPE` instead of the receipt — the same shape affected `429`, `413`, an early credential refusal and the capacity `503` (`http.ts` now drains an unread body before answering, with a deterministic regression test in the server package).

Still manual, and not implied by the above: UAC-cancel-then-retry interaction, logoff and reboot autostart, power-loss and directory `FlushFileBuffers`, real audio devices, classroom-scale load, Linux systemd installation, and the milestone M3 (installed-product GUI over CDP) and M4 (upgrade, uninstall, data retention) suites, which are not implemented. Do not report whole-product target acceptance as complete.

## Remaining implementation delivered (2026-09-09)

Baseline: `60eef2d`, branch `feat/lab-deployment`. The user authorized completing all remaining implementation and repeatedly instructed continuation. All changes remain unstaged and uncommitted under AGENTS.md. Preserve the two original Chinese-named `.lssubmission` files. The sections below are historical and do not describe the current remaining implementation.

Implemented in this continuation:

- Teacher local service host and UI: fixed elevated manager through pkexec/UAC, authenticated encrypted exchange, explicit status/install/initialize/connect/start/stop/autostart/logs/configure/restore/recover/upgrade. The one-time local proof is consumed in main and never returned to renderer. Service shutdown waits active work and concurrent close callers share one promise.
- Independent student/teacher packaging (`yarn lab:package:student` and `yarn lab:package:teacher`, optionally `--dir`), Linux deb hooks, Windows NSIS hooks and WinSW SCM installer with virtual service account/ACL setup. Student excludes service/AI/editor UI; pure archive-validation Schema exports are isolated and allowlisted. Vite module and actual ASAR dependency audits run during builds. Electron production fuses disable RunAsNode, NODE_OPTIONS and Node inspection.
- Upgrade requires maintenance/no blockers, no last-known active student phase, a verified ready backup under 24 hours old and a target-version preparation marker. Installer preserves old program/data/autostart, retries an identical verified release and rejects partial/tampered releases. Linux program/unit/link publication has fsync barriers. Authenticated upgrade digest verification has a 30-minute control deadline. Backup age/digest do not prove coverage of the very latest business write; make the backup after business work ends.
- Teacher workflows: stale connection/query/mutation isolation, revision-conflict comparison preserving drafts, pagination, frozen delete selections and service-scoped durable unknown-write recovery using the original idempotency key. Secrets are re-entered and archives reselected by digest. Only successful replay resolves unknown entries; completed operation history is bounded while unresolved entries are retained.
- Student/host: save/close coordination, license-expiry save completion, rebind/admission generation checks, queued concurrent startup commands, trusted binding-scoped pending credentials, strict role/capability/target validation, bounded caches/connections/requests/archive handles and cleanup of owned temporary transfers. Formal source archives are retained. Export copies to a temporary file and fsyncs before publication, avoiding whole-backup memory allocation.
- Server: stable bounded ID-snapshot pagination, deterministic sort order, persisted task expiry/revisions and aggregate cleanup status, terminal/test retention, bounded HTTP/control/login work. Existing transactional batch-delete/idempotency semantics were retained.
- New focused tests cover controller races, encrypted helper cancellation/retry, local manager input rejection, upgrade/stop gates, retention/pagination and operation recovery. Electron local-service integration proves main-only proof exchange, student-capability rejection, and service survival after teacher exit.

Final verification: server 31, student 19, teacher 4, host 10, exam-package 21 and schema-editor 13 unit tests passed; 61 generated contracts and 5 design-contract tests passed; both renderer and server/host/player typechecks passed; scoped ESLint and diff whitespace checks passed. Both Linux deb installers were rebuilt from the final code, actual ASAR audits passed (13 entries each, service present only in teacher), generated postinstall scripts were inspected, and the bundled Node service test plus Linux installer `--verify` passed. Final lab Electron integration passed 2 tests in 46.9 seconds, including save-window-close; desktop screenshots of the local dialog and connected page were inspected without overlap. The export test initially exceeded its deadline due to deep comparison of two 2 MiB Buffers; native Buffer.equals preserves the same byte comparison and the complete host suite passed in 1.5 seconds.

Full Electron regression: 80 passed and one license-activation test hit the 30-second overall deadline while other builds/model tests ran. The unchanged license spec then passed both cases in 13.4 seconds. All 9 browser component tests passed separately. Do not describe the original combined command as exit-zero. Final required smoke passed all 12 in 1.1 minutes. No build/test session remains running; the staging area is empty.

Final Linux artifacts (0.4.1, x64):

- `dist/lab-student/ls101-lab-student-0.4.1-linux-amd64.deb`, approximately 88 MiB, SHA-256 `725e2ea97c8baf37b232b33cd90f349426d8fa1289013e0496c7f93c907e44bb`.
- `dist/lab-teacher/ls101-lab-teacher-0.4.1-linux-amd64.deb`, approximately 120 MiB, SHA-256 `fddebec8311bb42ff13b5d1dd48edd5579eee23108799db6378f72b201b83d32`.

Remaining acceptance: actual Linux systemd installation/login/reboot; Windows native packaging, UAC, SCM, virtual-account ACLs and directory FlushFileBuffers; real microphones and sound cards; power-loss durability and classroom-scale load. Windows code exists but has not been executed on Windows and is not certified by container tests. **Superseded for the service and protocol milestones**: see the 2026-09-18 section at the top — Windows packaging, SCM, ACLs and the client/server protocol have since been executed on a real Windows host, while UAC interaction, reboot autostart, power-loss durability, audio and scale remain manual. Follow `docs/lab-target-acceptance.md`; deployment and upgrade steps are in `docs/lab-service-runtime.md`. Do not report whole-product target acceptance as complete.

## Continuation checkpoint (2026-09-08, supersedes the historical snapshot below)

- User confirmed `943b969 temp` contains exactly the prior handoff work and authorized continuation. Branch remains `feat/lab-deployment`. No `git add` or `git commit` has been run in this continuation.
- The old staged-file description below is historical: deployment execution, this handoff and the local TODO are already tracked in `943b969`.
- Stage 6 has progressed through standalone Node runtime, authenticated/encrypted local control, backup configuration/license snapshots, persistent failed-backup GC, offline restore and Linux installation artifacts. The full seven-stage product is still incomplete.
- New runtime entry: `packages/lab-server/src/cli.ts`; supporting modules: `runtime.ts`, `runtime-config.ts`, `control.ts`, `directory-lock.ts`, `restore.ts`. `yarn lab:build:server` emits `out/lab-server` with fixed Node 24.20.0, native 7-Zip, file digests, CLI, and Linux installer/unit. `yarn lab:test:server` builds and boots the packaged service outside the repository.
- The local control key is private to the service account. Requests/responses use AES-256-GCM with direction binding and per-connection challenges; bounded frames, socket limits and deadlines apply. Local proofs remain single-use and are exchanged only over the protected channel. Runtime enforces the existing license and explicit initialization, and drains requests/backups on shutdown.
- Offline restore extracts only allowlisted manifest entries via engine stdout, verifies release/schema/size/digests and configuration, clears teacher sessions, backup indexes/create-idempotency mappings and old-directory GC paths, and preserves formal receipts and other business idempotency. A fixed sibling SQLite lock and durable switch record protect directory replacement. The old directory is retained; `recover-restore` handles recorded interruptions.
- Backup password contract now rejects CR/LF/NUL before task creation, matching the private stdin adapter. OpenAPI and generated validators are synchronized. Other teacher passwords keep their existing contract.
- Backup failure/ready transitions durably enqueue cleanup; deletion failures remain queued, startup and runtime retry GC. Backup snapshots now include optional `license.json` and `service-runtime.json`.
- Linux installer verifies checksums and native runtime, requires the service stopped, uses a restricted system account and immutable version directories, preserves existing program/data and does not start or change autostart. Actual systemd installation is not tested: this container has no systemd tools. Windows SCM installer, ACL enforcement and native durability remain unimplemented/unverified.
- Operational instructions: `docs/lab-service-runtime.md`.
- Final verification: all 27 server tests passed in 6 files, including encrypted proxy transport and restore/GC interruptions; 5 design-contract tests passed; contract generation check passed; server/host/player and both renderer typechecks passed; scoped ESLint and `git diff --check` passed. `yarn lab:test:server` passed the packaged Node process test, and the final Linux installer `--verify` passed. Required smoke passed 12 tests; `xvfb-run -a yarn lab:test:integration` passed its real Electron round trip in 46.6 seconds.
- Final full-regression attempt: all 81 Electron tests passed in 5.3 minutes, including the corrected startup timeout. The combined command then failed before executing component assertions because Playwright Chromium Headless Shell revision 1234 was absent. Installed the required browser with `yarn exec playwright install chromium --only-shell` (also installed Playwright FFmpeg 1011), then `xvfb-run -a yarn test:playwright:components` passed all 9 tests. Both suites are verified; the combined command itself did not exit zero. No build/test command remains running.
- First rebuilt full regression in this continuation ended at 80 passed / 1 failed: startup animation's release-note assertion timed out after 5 seconds while the startup screen was still shown. The unchanged targeted spec passed both cases. Its assertion now uses existing `APPLICATION_STARTUP_TIMEOUT` (20 seconds on Linux) while retaining the >=2400ms assertion and milestone ordering checks. The old design-contract tests also needed the existing `ajv-formats` registration for current Ajv.
- Preserve the two original `.lssubmission` files. A transient untracked `temp.html` appeared during regression and later disappeared during the test lifecycle; the agent did not modify or remove it. Final observed untracked non-feature files are only the original submissions.
- Remaining work: teacher UI/main integration of local control and OS service management, student/teacher installers and autostart, Windows SCM/runtime packaging/ACL acceptance, upgrade workflow admission and recovery beyond immutable Linux program installation, remaining server/client semantic/race/resource audits, retention, and target Windows/audio/power-loss acceptance. Do not report stage 6 or the whole product as complete.

## Historical handoff from the previous session

handoff_generated_at: 2026-09-08
workspace: /workspace
branch: feat/lab-deployment
head_commit: 3fc8834 feat(lab): implement desktop workflows and history cleanup
previous_head_before_current_stage: a824cdf0
comparison_baseline: origin/dev (4ca0972a)
active_goal: none; no Codex goal was created
current_instruction: do not perform more work in this session; write complete handoff only
authorization: user approved the seven-stage plan on 2026-09-07, authorized continuation after the first-stage commit, and now explicitly stops this session

## Current state

Last observed `git status --short` before creating this file:

`A  TODO-lab-implementation.local.md`

`M  apps/lab-student/renderer/__tests__/maintenance-queue.test.ts`

`M  apps/lab-student/renderer/controller.ts`

`A  apps/lab-student/renderer/deployment-player.tsx`

`A  apps/lab-student/renderer/deployment-tests.ts`

`M  apps/lab-student/renderer/main.tsx`

`M  apps/lab-student/renderer/maintenance-queue.ts`

`M  apps/lab-student/tsconfig.json`

`M  apps/lab-teacher/renderer/maintenance.tsx`

`A  apps/lab-teacher/renderer/test-results.ts`

`M  packages/exam-player/src/ExamPlayer.tsx`

`M  packages/exam-player/src/__tests__/ExamPlayer.test.tsx`

`M  packages/lab-desktop-host/src/desktop.ts`

`M  packages/lab-desktop-host/src/preload.ts`

`M  packages/lab-desktop-host/src/shared.ts`

`M  packages/lab-desktop-host/src/task-journals.ts`

`M  packages/lab-server/src/__tests__/service.test.ts`

`A  packages/lab-server/src/__tests__/test-suite.test.ts`

`M  packages/lab-server/src/tasks.ts`

`M  packages/lab-server/src/test-suite.ts`

`A  tests/lab/student-entry.mjs`

`M  tests/lab/student.spec.ts`

Untracked: `TODO-lab-implementation.local.md`, this handoff file, and the two pre-existing Chinese-named `.lssubmission` files.

All deployment-stage code changes were already staged in the Git index by the interrupted prior session. There is no deployment-stage commit yet. `TODO-lab-implementation.local.md` is staged as an added file even though the user explicitly said TODO must not be committed. The two original `.lssubmission` files must remain untouched. This handoff is tracked: it was committed in `9e7a207` despite the original instruction to leave it untracked, and the user authorized committing it on 2026-09-18.

The first-stage commit originally failed because `/workspace/.git/index.lock` could not be created (`Read-only file system`), including after escalation. The user requested commands only and then committed externally; HEAD confirms `3fc8834`. The current handoff-only turn did not run `git add` or `git commit`.

No process was running in the last process check. Full-regression exec session `82619` is not alive after the user interruption. Do not resume that session identifier.

## Repository constraints

`/workspace/AGENTS.md` applies. Renderer/preload/main changes use `xvfb-run -a yarn test:smoke`; targeted Electron tests are required outside smoke; broad changes use full integration; `yarn dev:docker` is only for unasserted visual/development/OS-window cases; unreleased schemas need no backward migration unless requested; do not run `git add` or `git commit`, provide commands instead; if `node_modules`, `dist`, `out`, or a required native tool is read-only/unavailable, stop and request environment repair without workarounds.

Environment: Node `v24.20.0`; `node_modules`, `dist`, and `out` passed write-access checks; no Windows-only-tool blocker occurred. Preserve both original `.lssubmission` files.

## Design sources

Authoritative documents read: `docs/lab-deployment-design.md`, `docs/lab-server-api-design.md`, `docs/lab-server.openapi.yaml`, `docs/lab-server-storage-design.md`, `docs/lab-student-state-design.md`, `docs/lab-desktop-design.md`, `docs/lab-teacher-workflow-design.md`, `docs/lab-implementation-design.md`, and `/workspace/AGENTS.md`.

The branch initially added seven Markdown design docs, one OpenAPI file and one contract test relative to `origin/dev`; OpenAPI defines 51 paths and 61 operations.

## Plan and stopping boundary

Approved stages: (1) requirement/checklist and contract reconciliation; (2) independent student/teacher entries plus contracts/client/host/server packages and generated validators; (3) SQLite/storage/identity/auth/enrollment/devices/version/heartbeat; (4) exams/cache/grants/player/saves/uploads/receipts/teacher submissions/maintenance/reconnect/restart/rebind; (5) teacher/student maintenance UI, leases/cancellation/reporting, real deployment tests, isolated test data, confirmed history cleanup; (6) backup barriers/snapshots/encrypted publishing/idempotency/crash recovery/offline restore/install/autostart/upgrades; (7) deterministic race/crash tests, static checks, smoke/integration/dependency audits and Windows acceptance.

The original pause boundary, committed as `3fc8834`, was teacher basic workflows plus student history cleanup. The resumed work implemented the deployment-test part of stage 5. Stage 6 is pending and is not authorized by this handoff-only turn.

## Invariants

- Renderer owns business orchestration; main/preload expose narrow validated capabilities.
- Server is Electron-independent; student artifacts exclude server/SQLite, AI/models, editors, Playwright and test activation bypasses.
- Trusted SPKI is checked before credentials; trust is never silently replaced.
- Existing licensing rules are reused; exact release version is required for student business access.
- Durable local archive precedes upload/completion UI; successful receipt requires durable server archive and committed receipt/index.
- Submission ID, `submittedAt`, and archive are stable across save retries.
- Maintenance blocks formal uploads/formal receipt queries; ordinary failures remain manual; recovery checks receipts before resend.
- Successful receipts are permanent after server deletion/restore.
- Rebinding preserves records and makes old incomplete submissions receipt-only.
- Cleanup requires a fixed confirmed snapshot and successful local receipts.
- Cancellation/expiry stops new effects; late reports cannot revive tasks.
- Backup pending/running and snapshot barriers block conflicting operations; restore clears only backup indexes/create-idempotency mappings and preserves formal receipts/unrelated idempotency.

## Existing implementation before resumed stage

`packages/lab-contracts` contains generated API types, operation metadata and static Ajv validators for all 61 operations. Static generation replaced runtime Ajv compilation because renderer CSP caused a blank Electron window. `packages/lab-client` provides validated contract transport and `RemoteError`.

`packages/lab-server` provides Node 24 SQLite, directory locking/write gate, identity/authentication/enrollment, devices/heartbeats, exams/grants/submissions/receipts, tasks/leases, cleanup plans and encrypted backups. All 61 handlers exist; this does not prove all documented semantics. Certificates include basic constraints, key usage and server-auth extensions because empty extensions failed Electron/BoringSSL. Credential-reset enrollment probes old credentials and rotates secrets; same-service idempotency preserves context only for the same secret.

`packages/lab-desktop-host` provides pinned TLS, bindings/runtime generations, bounded archive IPC, verified cache, records/CAS/recovery, task journals, cleanup deletion journals and sanitized teacher operation journals. Save intent stores expected digest/size before chunks; complete archives recover and incomplete parts do not queue. Rebind suspends and settles queues.

`apps/lab-student` provides admission/heartbeat, formal exam list/player, durable saves, submission queue, history/export and maintenance display. `apps/lab-teacher` provides trusted remote login, exams/submissions/devices, maintenance/settings, enrollment, tests, cleanup and backup baseline pages. `packages/exam-player` supports pre-start authorization, phase events, stable submission identity/time/archive reuse and unmount cancellation. `packages/license` extracts reusable licensing. Independent student/teacher Electron builds exist.

## Resumed deployment-test implementation

### Installed suite/resources

`packages/lab-server/src/test-suite.ts` defines suite `ls101-lab-deployment` version `1` with cases `identity`, `storage`, `download`, `playback`, `audio`, `submission`, `duplicate`, `recovery`; `playback` and `audio` require manual confirmation. The built-in exam includes a deterministic 96x64 24-bit BMP (`resources/display.bmp`), deterministic 16kHz mono 440Hz PCM WAV (`resources/tone.wav`), title/image/choice content, play/countdown steps, a short recording page, choice A/B metadata and answer-capture mappings. ZIP bytes/digest are deterministic and package-validated. `packages/lab-server/src/__tests__/test-suite.test.ts` checks headers, dimensions, timelines and capture mappings.

### Server behavior

`packages/lab-server/src/tasks.ts` seeds `test_confirmations` from selected manual case IDs with revision 1, pending status, empty notes and null update time. Confirmation validates uniqueness, selected-task membership, manual-confirmation membership and expected revision. Existing test exam, isolated `test_submissions`, lease, upload, receipt, cancellation, late report and `retryOf` support are reused.

### Host isolation/security

`packages/lab-desktop-host/src/desktop.ts` and `preload.ts` add student-only `tests.storage`, `tests.prepare`, `tests.release`, `tests.begin`, `tests.chunk`, `tests.finish`, `tests.list`, `tests.cas`, `tests.uploadHandle`. Test cache is under `<student userData>/test-data/exam-cache`; test records are under `<student userData>/test-data/<taskId>`, separate from formal `submissions`. Non-release capabilities require current matching task lease, binding context, maintenance admission, exact release version, testing foreground, non-cancelled state and unexpired monotonic deadline. Successful task result reporting removes the local lease. Storage writes a durable probe; prepare verifies digest and decodes package; test save/upload uses `StudentRecords` in the isolated directory. IPC chunk-size exception allows `records.chunk` and `tests.chunk`. TaskJournal persists/validates partial `testCases`.

### Student executor

`apps/lab-student/renderer/maintenance-queue.ts` handles deployment-test tasks in addition to history cleanup. It persists intent before claim, partial cases after each callback, and final result before report. Lease timeout uses `AbortSignal.reason` `TimeoutError`; explicit stop reports cancelled; timeout reports expired. Restart with an old lease and partial cases reports interruption without resuming playback/recording.

`apps/lab-student/renderer/deployment-tests.ts` accepts only installed suite/version and runs identity, durable storage, digest/cache/download, image/choice playback, real player audio recording, isolated save/upload, duplicate receipt verification, and one scoped upload-failure recovery. Recovery asserts archive/manual state retention, no automatic retry, then invokes manual retry. Playback/audio automatic status is `manual-required`; other success is `passed`. Recording output is briefly replayed through an object URL.

`apps/lab-student/renderer/deployment-player.tsx` reuses `ExamPlayer` with injected candidate/authorization, manifest rewriting and actual image/choice/audio/recording path. `ExamPlayer` gained optional `startSession`; when loaded and in candidate phase it starts authorization once without candidate UI. `controller.ts` wires the executor/test player; `main.tsx` displays test state. `tests/lab/student-entry.mjs` adds fake-media switches only to the test Electron entry; production startup parsing remains strict.

### Teacher UI

`apps/lab-teacher/renderer/maintenance.tsx` translates case/status labels, displays task-level and case-level errors separately, provides accessible manual confirmation controls, and creates a new same-device run containing only failed cases with `retryOf` set to the original. `test-results.ts` centralizes labels and failed-case selection. Automatic results are not overwritten by manual decisions.

### Tests changed

- `apps/lab-student/renderer/__tests__/maintenance-queue.test.ts`: partial progress on renewal failure, restart expiration without replay, failed deployment result status.
- `packages/exam-player/src/__tests__/ExamPlayer.test.tsx`: host-provided session still requires authorization and denial does not finish.
- `packages/lab-server/src/__tests__/service.test.ts`: confirmation seeding, invalid/manual case rejection, revision conflict and late cancelled report.
- `packages/lab-server/src/__tests__/test-suite.test.ts`: deterministic media/archive checks.
- `tests/lab/student.spec.ts`: real Electron enrollment, formal practice/receipt, all eight deployment cases, image/choice/audio paths, isolated durable test data, scoped failure/manual retry, duplicate receipt, teacher confirmation, retry batch, cancellation during live recording, ended tracks, stale lease rejection and prior history cleanup.

## Verification completed

- `yarn lab:build:student`: passed.
- `yarn lab:build:teacher`: passed.
- `yarn exec tsc -b packages/lab-server packages/lab-desktop-host packages/exam-player`: passed.
- `yarn exec tsc --noEmit -p apps/lab-student/tsconfig.json`: passed.
- `yarn exec tsc --noEmit -p apps/lab-teacher/tsconfig.json`: passed.
- Related Vitest: 67 tests passed in 12 files; prior baseline was 62 tests in 12 files; player suite after hook tests was 12 passed.
- Scoped ESLint with `--no-warn-ignored` exited 0 after formatting fixes. Earlier output contained only Prettier warnings/ignored-test notices; no final scoped error.
- `git diff --check`: exit 0; only the existing `assets/.gitkeep` CRLF conversion warning appeared.
- `xvfb-run -a yarn lab:test:integration`: passed one real Electron test in about 44.6s after builds. It covered all eight deployment cases, manual confirmation, retry batch, cancellation during live recording, ended media tracks, stale lease rejection and the prior formal cleanup round trip.
- `xvfb-run -a yarn test:smoke`: passed 12 application tests in about 1.1 minutes after deployment renderer/preload/main changes.
- Pre-resumed baseline `xvfb-run -a yarn test:playwright` passed 81 Electron tests plus 9 component tests; that predates deployment changes and cannot certify the resumed stage.

## Interrupted current full regression

Command was `xvfb-run -a yarn test:playwright:run`. Session `82619` started `Running 81 tests using 2 workers`. Output showed successful tests through at least test number 71, including application, data-directory, AI-router, interface-editor, microphone and window-control coverage, with no observed failure. The user interrupted on 2026-09-08; a later process check showed no process. There is no final exit code, no authoritative result for remaining tests, and no component-suite result. Classify this run as incomplete/unknown. Do not claim current full regression passed without rerunning it in a future authorized turn.

## Screenshots

- `test-results/lab/student-deployment.png`: deployment player visibly rendered title, deterministic colored bitmap, choice UI with A selected and active playback.
- `test-results/lab/teacher-deployment.png`: teacher details visibly rendered translated cases, automatic/manual columns and retry action.
- Prior-stage `test-results/lab/student-history.png` and `test-results/lab/teacher-devices.png` also exist.

## Remaining work

- Deployment test-data retention/GC, bounded long-term test cache policy and target-machine real audio acceptance.
- Stage 6: standalone service entry, authenticated local IPC, OS service hosting, installers/autostart/upgrades, pinned runtime packaging, offline restore, backup licensing/config snapshot and data-preserving upgrades.
- Server audit: persistent GC after failed backup/cleanup, stable pagination, durable bulk deletion results, expiry/revision aggregation, retention, resource reservations, redacted logs.
- Backup password stdin adapter rejects newline/NUL although contract accepts them; backup engine version/packaging unresolved.
- Audit IPC validation/role boundaries, admission/reconnect races, current/old connection policy, bounded resources, shutdown/save coordination, missing binding/generation corruption, rebind/poll races, pending-secret scope and immutable archive recovery.
- Audit student old-binding receipt queries, admission states, task reporting and archive-handle ownership.
- Teacher UI still needs revision-conflict reload, persisted unknown-write recovery UI, destructive-selection freezing, full maintenance pagination/device pickers and local/remote service controls. Confirmation seeding and failed-case retry are done.
- Lab installer/package configs, dependency/ABI audits, target startup, Windows permissions/SCM, audio and power-loss acceptance.
- Manual-required test aggregation/status policy needs future semantic audit.

## Future commands (do not run in this turn)

After explicit authorization to continue, use: `cd /workspace`; `git status --short`; `git diff --cached --stat`; `yarn lab:contracts:check`; `yarn lab:build:student`; `yarn lab:build:teacher`; `yarn exec tsc -b packages/lab-server packages/lab-desktop-host packages/exam-player`; renderer typechecks; `xvfb-run -a yarn test:smoke`; `xvfb-run -a yarn lab:test:integration`; `xvfb-run -a yarn test:playwright:run`.

If the user asks to commit the deployment stage, first unstage the accidentally staged local TODO with `git restore --staged -- TODO-lab-implementation.local.md`, inspect `git diff --cached --name-only`, include only deployment code/tests, and exclude `TODO-lab-implementation.local.md`, `HANDOFF-lab-implementation.md`, and both `.lssubmission` files. Suggested commit message: `feat(lab): add isolated deployment test execution and retry workflows`.

## Next-session rules

Do not assume the full documented product is complete. Preserve staged code, TODO, this handoff and both original submission files. Treat deployment-test implementation as complete for the resumed stage, current full regression as incomplete because of interruption, and stage 6 as pending explicit user instruction. Do not claim Windows service/audio/power-loss acceptance from container results. Do not rely on stale TODO wording that says session `82619` is still running; this handoff is authoritative.
