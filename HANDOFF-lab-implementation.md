# HANDOFF: lab-deployment implementation

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

All deployment-stage code changes were already staged in the Git index by the interrupted prior session. There is no deployment-stage commit yet. `TODO-lab-implementation.local.md` is staged as an added file even though the user explicitly said TODO must not be committed. The two original `.lssubmission` files must remain untouched. This handoff is new and untracked; do not commit it unless the user explicitly changes that instruction.

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
