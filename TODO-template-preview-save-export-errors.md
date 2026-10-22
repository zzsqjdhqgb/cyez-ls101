# TODO: Template Preview Hides Save and Export Failures

Status: open.

## Problem

`TemplateDocumentPage` renders editor-session and export errors only in the non-preview properties
aside. The notice is the `session.error || exportError` alert inside that aside, next to the global
properties fields; the aside only exists in the non-preview branch (`visibleCenterView !== 'preview'`).

The toolbar is outside that branch, so Save and Export remain available while the Preview view is
active. In Preview, the right-hand side is `TemplatePreviewInspector`, which receives
`previewSession` from `useTemplatePreview`; its error channel only covers instance loading and preview
compilation. It never receives the editor session or `exportError`.

As a result, a failed save or export in the Preview view produces no visible feedback. A save failure
still sets `session.error` through `useTemplateEditorSession.save()` and leaves the document dirty, so
the changes are not lost, but the user is not told that the save failed. An export failure or a
read-only "create copy" failure sets `exportError`, yet the export/copy operation simply stops. The
error only appears after the user switches back to the Structure or Page view; the new comment in
`TemplateDocumentPage` currently documents this gap instead of fixing it.

## Root Cause

- The page has one error surface for editor/export failures, and that surface is coupled to the
  non-preview inspector.
- The Preview view replaces the properties aside with a preview-specific inspector whose error
  channel is intentionally separate from editor errors.
- The toolbar is view-independent and does not disable or redirect save/export when preview is
  active.
- The next save attempt clears the error before sending the request, but there is no feedback at the
  moment of failure, and there is no toast fallback for save/export.

## Impact

Preview-only UX issue: no persisted data, grading, exam state, or configuration is corrupted. A
failed save leaves the document dirty, and a failed export does not produce a completed export file.
The main risk is that the user believes the action succeeded, leaves the editor, or repeatedly
triggers the same operation without understanding why nothing happens. Severity is low to moderate
depending on how often saves and exports fail in normal use.

## Reproduction

1. Open a local template, make an edit, and switch to the Preview view.
2. Make `application.templates.save` reject, then click Save.
3. The button returns from "正在保存" to "保存" and the toolbar still shows the unsaved state, but no
   alert or toast appears.
4. Repeat with `exportTemplateDocumentFile` rejecting (and, for a built-in template, with
   `builtinTemplates.createCopy` rejecting). The export/copy stops silently.
5. Switch back to Structure or Page. The error is now visible in the properties aside.

## Proposed Fix

- Give save/export failures a view-independent surface, such as a page-level notice near the toolbar
  or a toast that remains readable long enough to act on. Do not overload the preview session error.
- Alternatively, render the editor/export notice in both the properties aside and the preview
  inspector, but keep the two error channels distinct so preview compilation errors are not confused
  with save failures.
- Keep the current dirty-state behavior: a failed save must not mark the document clean.
- Clear the relevant error on a successful save/export and on the next attempt, as the current code
  does, and avoid showing duplicate alerts when the user returns to a non-preview view.
- Remove or update the comment in `TemplateDocumentPage` that documents the current gap once the
  feedback is implemented.
- Add tests that fail save and export while Preview is active and assert visible feedback, without
  breaking the existing template tests.

## Acceptance Criteria

- A failed save in Preview shows a visible error and leaves the document dirty.
- A failed export or read-only copy in Preview shows a visible error.
- Preview compilation errors still use the preview inspector and are not mixed with save/export
  errors.
- A successful save/export clears the relevant error, and returning to a non-preview view does not
  duplicate the alert.
- Focused renderer tests cover save and export failures in Preview, and existing template tests keep
  passing.
