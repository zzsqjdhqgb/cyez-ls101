# TODO: Workbench Statistics Ignore the unavailable State

Status: open.

## Problem

When any of the six parallel Workbench reads fails, `Promise.all` skips the success callback and
leaves `snapshot` as `EMPTY_SNAPSHOT`; the catch sets `unavailable = true`, and the finally ends
loading. The comments on `WorkbenchSnapshot` and `EMPTY_SNAPSHOT` state the intended contract:

- the numbers are not meaningful without `loading` and `unavailable`;
- the empty snapshot is indistinguishable from a genuine all-zero result and must be used together
  with those flags.

The implementation only uses `loading` for the numbers. `unavailable` is used at exactly one place,
the "最近工作" heading detail. After a failed load:

- `StatusItem` renders `loading ? '–' : value`, so the five status numbers show `0`;
- quick action details render `loading ? '正在汇总' : action.detail`, so the exam and submission
  counts show `0`;
- the pending panel uses `loading` for its counts, completion rate, total, completed count and draft
  count, so it shows `0` / `0%`;
- the progress bar uses the derived `completion` value and renders an empty bar;
- the recent panel only checks `loading` and `snapshot.recent.length`, so it renders
  "还没有最近工作".

Only the recent heading says "部分状态暂不可用". Users can therefore read the empty snapshot as
real zero statistics.

## Root Cause

- The numeric display components and expressions gate on `loading` only; `unavailable` never reaches
  `StatusItem`, the quick action details, or the pending panel.
- `EMPTY_SNAPSHOT` is deliberately indistinguishable from real zeros in the data model, so every
  display that uses it must also consult the failure flag.
- The recent panel's empty state is selected by `recent.length === 0` without excluding the failed
  load.
- `unavailable` was added for the summary failure but is currently only wired to one heading label.

## Impact

The workbench is the application's home page, so a transient file/IPC failure can make every library
look empty. No data is modified and no persisted state is affected, but users may believe their
exams, submissions, templates or schemas are missing. Severity is moderate for a misleading home
page; reloading the workbench resolves it once the underlying read works.

## Reproduction

1. Make one of the six reads reject, for example `exams.listRecords()`, while the other five
   resolve with empty collections.
2. Render the workbench and wait for loading to finish.
3. Observe `0` in the status band, `0 份...` in the quick action details, `0` / `0%` in the pending
   panel, and "还没有最近工作" in the recent panel.
4. Compare with the same page when all six reads resolve with empty collections; the numbers are
   visually identical, even though one state is a failed summary.

## Proposed Fix

- Treat `loading || unavailable` as the placeholder condition for every numeric statistic.
- Pass the failure state into `StatusItem` (or a shared `placeholder` prop) and render `–` when the
  summary is unavailable.
- Render "部分状态暂不可用" instead of embedded counts in quick action details, while keeping
  "正在汇总" for loading.
- Apply the same placeholder to the pending panel's count, completion rate, total, completed count
  and draft count; keep the progress bar at zero or hide it when unavailable.
- On failure, replace the recent empty state with "最近工作暂不可用" and avoid selecting the
  "还没有最近工作" state.
- Keep the successful-empty behavior unchanged: real zeros and the empty recent state must still
  appear when all reads succeed.
- Add a focused test that forces one read to reject and asserts placeholders/unavailable copy, plus a
  successful empty-summary test that asserts zeros remain.

## Acceptance Criteria

- A failed summary never displays `0` as a statistic or "还没有最近工作".
- The status band, quick actions, pending panel and recent panel all show an unavailable/placeholder
  state after a failure.
- The successful empty-summary case still shows real zeros, `0%`, and "还没有最近工作".
- The workbench test covers both the failed and successful-empty paths.
- Type checking, lint and the Electron smoke suite keep passing.
