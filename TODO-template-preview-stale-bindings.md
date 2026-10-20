# TODO: Template Preview Compiles With Stale Instance Bindings

Status: open.

## Problem

`useTemplatePreview` reloads Interface instance candidates whenever the document changes, but after a
completed load the compile effect for that render still sees `instancesReady === true` while the
preview is active: the loading effect defers `setInstancesReady(false)` to a microtask. It therefore
calls `application.templates.preview(document, bindings)` before the new instance query resolves,
provided every current alias still has a previous selection (otherwise `missingInstances` already
blocks the compile). Each binding's `interfaceId` already comes from the new document, but its
`instanceId` is still the previous instance selection, so the premature compile can pair an
interface with an instance that belongs to another interface or no longer exists.

The premature compile is invalidated when the re-render caused by `setInstancesReady(false)` commits
and the compile effect cleanup runs. It still performs a full preview compilation. If its handlers
complete before that cleanup, its result or error is published. The invalidation does not clear
either, and a published result remains set until a later compilation starts (or indefinitely if no
later compilation runs). If the cleanup runs first, the handlers are discarded, but `compiling`
stays true until a later compilation finishes; a failed reload, or a reload after which no
compilation runs, therefore leaves the preview refresh button disabled.

## Root Cause

- File: `packages/renderer/src/features/templates/useTemplatePreview.ts`.
- The instance-loading effect schedules `setInstancesLoading(true)` and `setInstancesReady(false)`
  inside `Promise.resolve().then(...)`.
- The compile effect's closure was created by the render in which `instancesReady` is still `true`.
  Both effects run in the same effect flush, but declaration order is incidental: the loading effect
  only schedules the readiness reset in a microtask, so the compile effect reads `true` either way.
- The loading effect cleanup only flips the local `current` flag; it does not invalidate readiness
  synchronously.
- `instancesReady` also stays `true` while the preview view is inactive, so returning to the preview
  view after an edit is a reliable reproduction.

## Impact

Preview-only: no persisted data, grading, exam state, or configuration is affected. Each occurrence
costs an unnecessary preview compilation: either when the document changes while the preview is
active or when the preview view is re-entered while `instancesReady` is still `true`, provided the
previous selections still cover every alias. It can also publish a binding-error result, or, when the
invalidation wins, leave `compiling` true through the reload and until a later compilation finishes;
a failed reload, or a reload after which no compilation runs, keeps `compiling` true and the refresh
button disabled. Severity is low to moderate depending on how expensive the template preview
compilation is.

## Reproduction

1. Open a template with at least one Interface requirement and preview it until `instancesReady`
   becomes `true`.
2. Switch to another center view, edit the document, then reopen the Preview view; or change the
   document while Preview is active.
3. Make `application.browser.listInterfaceInstances` return a deferred promise.
4. `application.templates.preview` is called with the new document and the old selection before the
   deferred list resolves.
5. The call is invalidated once the re-render that sets `instancesReady = false` commits, but the
   extra compilation has already started.

A focused hook test can render `useTemplatePreview`, resolve the first instance load, rerender with
a new document, and assert that `preview` is not called again until the second instance promise
resolves. The current behavior fails that assertion.

## Proposed Fix

- Replace the `instancesReady` state with a ref that is cleared synchronously at the start of the
  instance-loading effect and in its cleanup.
- Add a monotonically increasing readiness version state that increments after every successful
  instance load. Include it in the compile effect dependencies so a completed reload reliably
  retriggers compilation even if the new bindings happen to compare equal.
- Reset `compiling` when the invalidated compilation is discarded or when a finished reload does
  not start a new compilation (for example, because the reload failed or an alias has no
  instances), so the refresh button cannot remain disabled.
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
- A finished instance reload never leaves `compiling` true when no compilation is running.
- Switching documents or returning to the Preview view never uses an `instanceId` that is not
  currently valid for the current document's `interfaceId`.
- A hook-level regression test covers both a document switch and preview-view re-entry with deferred
  instance promises.
- Existing preview unit/integration tests, type checking, lint, and the Electron smoke suite keep
  passing.
