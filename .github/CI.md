<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: ci
-->

# CI quality gate

The `CI` workflow runs for pull requests targeting `dev` or `main` and for every push to either
branch. Configure the `Required quality gate` check as required in the branch protection rules for
both branches and do not configure bypass actors. Merge queues run the same check.

The verification has five job ids: `test_suites` (a Windows matrix with two entries),
`canonical_docs`, `canonical_visual`, `linux_electron_smoke`, and a final `Required quality gate`. The `test_suites`
matrix runs `other-checks` (lint, type checking, script tests, the complete Vitest suite, renderer
component tests, and product journeys) and `electron-integration` (the complete packaged Electron
integration suite on Windows). `canonical_docs` runs the canonical product documentation suite in
the pinned Linux renderer container; `canonical_visual` re-renders the per-screen visual baselines
in the same container and fails when `tests/visual/baselines` changes (it is skipped with a warning
while no baselines are committed); and `linux_electron_smoke` runs the Linux packaged-Electron
startup tests. No mutable workspace or build output is shared between runners, and Playwright
suites remain serial within each job. The final `Required quality gate` job succeeds only when all
four preceding jobs succeed.

Together, the jobs cover:

- ESLint and TypeScript checks;
- script tests and the complete Vitest suite;
- packaged Windows and canonical Linux application builds;
- packaged Electron integration tests and renderer component tests;
- Linux packaged-Electron startup tests;
- canonical product journey tests, canonical visual baselines, and checked-in documentation freshness.

Failed technical Playwright runs upload diagnostics for 14 days: the `test_suites` matrix uploads
`ci-${{ matrix.suite }}-diagnostics-*` (that is, `ci-other-checks-diagnostics-*` and
`ci-electron-integration-diagnostics-*`), and `linux_electron_smoke` uploads
`ci-linux-electron-smoke-diagnostics-*`; each includes traces, screenshots, and reports. Failed
canonical runs upload the regenerated product documentation as `canonical-product-docs-*` and the
regenerated visual baselines as `canonical-visual-baselines-*` for the
same period. Canonical renderer layers use the GitHub Actions cache. Each command shown in the
workflow is directly reproducible with the corresponding `yarn` script in `package.json`.

Release tags must point to a commit contained in `main`. Before packaging or publishing, the
release workflow waits for the exact tagged commit to have a successful `CI` run from a push to
`main`. A pull-request run, a run for another commit, or a run from another branch cannot satisfy
the release gate.
