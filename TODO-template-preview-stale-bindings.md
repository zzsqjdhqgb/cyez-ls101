# TODO: Template Preview Compiles With Stale Instance Bindings

Status: open.

## Problem

`useTemplatePreview` reloads Interface instance candidates whenever the document changes, but the
compile effect can still run once with the previous render's `instancesReady === true` during the
same React commit. It therefore calls `application.templates.preview(document, bindings)` before the
new instance query resolves, combining the new document with `interfaceId`/`instanceId` selections
taken from the old document.

The premature compile is invalidated shortly afterwards when the loading microtask commits
`instancesReady = false`. However, it still performs a full preview compilation, and it can briefly
publish a stale result or a transient compile error if it settles before the invalidation.

## Root Cause

- File: `packages/renderer/src/features/templates/useTemplatePreview.ts`.
- The instance-loading effect schedules `setInstancesLoading(true)` and `setInstancesReady(false)`
  inside `Promise.resolve().then(...)`.
- The compile effect is declared after the loading effect. React runs both effects in declaration
  order during the same commit, but the compile effect's closure still reads `instancesReady` from
  the previous render (`true`).
- The loading effect cleanup only flips the local `current` flag; it does not invalidate readiness
  synchronously.
- `instancesReady` also stays `true` while the preview view is inactive, so returning to the preview
  view after an edit is the most reliable reproduction.

## Impact

Preview-only: no persisted data, grading, exam state, or configuration is affected. The costs are
an unnecessary preview compilation on each preview re-entry and a possible transiently stale or
incorrect preview. Severity is low to moderate depending on how expensive the template preview
compilation is.

## Reproduction

1. Open a template with at least one Interface requirement and preview it until `instancesReady`
   becomes `true`.
2. Switch to another center view, edit the document, then reopen the Preview view; or change the
   document while Preview is active.
3. Make `application.browser.listInterfaceInstances` return a deferred promise.
4. `application.templates.preview` is called with the new document and the old selection before the
   deferred list resolves.
5. The call is invalidated after the loading state commits, but the extra compilation has already
   started.

A focused hook test can render `useTemplatePreview`, resolve the first instance load, rerender with
a new document, and assert that `preview` is not called again until the second instance promise
resolves. The current behavior fails that assertion.

## Proposed Fix

- Replace the `instancesReady` state with a ref that is cleared synchronously at the start of the
  instance-loading effect and in its cleanup.
- Add a monotonically increasing readiness version state that increments after every successful
  instance load. Include it in the compile effect dependencies so a completed reload reliably
  retriggers compilation even if the new bindings happen to compare equal.
- Keep the existing `current` cleanup guard for superseded requests.
- Decide how to treat the previous preview result while instances reload. Prefer exposing
  `instancesLoading` in `PreviewStatus` instead of clearing `result`, which would flash the empty
  preview state.
- Update the two inline comments in `useTemplatePreview.ts` that reference this TODO once the race
  is fixed.

## Acceptance Criteria

- No `application.templates.preview` call starts while the current document's instance list is still
  loading.
- After the instance list resolves, the preview compiles once with the new bindings.
- Switching documents or returning to the Preview view never uses stale `interfaceId`/`instanceId`
  pairs.
- A hook-level regression test covers both a document switch and preview-view re-entry with deferred
  instance promises.
- Existing preview unit/integration tests, type checking, lint, and the Electron smoke suite keep
  passing.
