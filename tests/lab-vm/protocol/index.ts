/*
 * Command registry for the lab protocol driver (docs/lab-vm-acceptance-design.md, milestone M2).
 *
 * Each entry maps a command name to the module that implements it, grouped by the acceptance case it
 * serves. `guest/lab-acceptance.mjs` invokes these commands as separate processes and judges the JSON
 * they print; nothing in here decides whether a case passed.
 *
 * The imports are static on purpose. Lazy `await import()` looks tidier — one command runs per process,
 * so nothing else is needed — but the driver is bundled into a single file with `inlineDynamicImports`,
 * and the injected namespace object then lands after the entry point's top-level `await`. Running a
 * command then throws "Cannot access '<command>$1' before initialization", which is a *bundled-artifact*
 * failure: it does not reproduce when the sources are imported directly. Static imports are evaluated
 * before the entry body, and inlining makes the difference invisible in the output anyway.
 * `scripts/__tests__/windows-vm.test.js` keeps the registry, the modules and the guest steps aligned.
 */
import type { CommandHandler } from './context'
import { backup } from './commands/backup'
import { concurrency } from './commands/concurrency'
import { enrollIssue, enrollRegister, enrollReject } from './commands/enroll'
import { examFetch, examList, examPublish } from './commands/exam'
import { fileEdit } from './commands/file-edit'
import { deviceList, heartbeat, heartbeatLoad } from './commands/heartbeat'
import { ipv6 } from './commands/ipv6'
import { login } from './commands/login'
import { maintenanceExit, mode, testRun } from './commands/mode'
import { pin } from './commands/pin'
import { practice } from './commands/practice'
import {
  submissionDelete,
  submissionDownload,
  submissionReceipt,
  submissionUpload,
  taskClaim,
  taskLease
} from './commands/submission'

export const commands: Record<string, CommandHandler> = {
  // N1: the pin is checked before any HTTP request or credential exists.
  pin,
  // N2: authentication from a non-loopback address, including a forged X-Forwarded-For.
  login,
  // N12: the service refuses a host it cannot bind, and a bracketed IPv6 literal is reported readably.
  ipv6,

  // N3/N4/N5: enrollment batch issuance, per-process registration, replay and whole-file semantics.
  'enroll-issue': enrollIssue,
  'enroll-register': enrollRegister,
  'enroll-reject': enrollReject,

  // N6/N11: heartbeat timing, the device list the teacher sees, and the many-process load case.
  heartbeat,
  'device-list': deviceList,
  'heartbeat-load': heartbeatLoad,

  // N7: exam publication and the archive round trip, in both directions and across processes.
  'exam-publish': examPublish,
  'exam-list': examList,
  'exam-fetch': examFetch,

  // N7: the submission lifecycle: claim, upload, receipt, idempotent re-upload, download and delete.
  'task-claim': taskClaim,
  'task-lease': taskLease,
  'submission-upload': submissionUpload,
  'submission-receipt': submissionReceipt,
  'submission-download': submissionDownload,
  'submission-delete': submissionDelete,

  // N8/N10: maintenance admission rules, practice continuation and lease-bounded maintenance exit.
  mode,
  practice,
  'maintenance-exit': maintenanceExit,
  // N10: the deployment test run whose claimed lease is what keeps the exit blocked.
  'test-run': testRun,

  // N9: the two concurrency ceilings, which have separate error codes.
  concurrency,

  // M4/U2: the real backup whose existence and freshness `prepare-upgrade` requires before it will
  // write an upgrade preparation record.
  backup,

  // N5: copy a file, or change exactly one byte of it, reporting which byte.
  'file-edit': fileEdit
}
