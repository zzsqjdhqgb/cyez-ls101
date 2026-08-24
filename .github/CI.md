# CI quality gate

The `CI` workflow runs for pull requests targeting `dev` or `main` and for every push to either
branch. Configure the `Required quality gate` check as required in the branch protection rules for
both branches and do not configure bypass actors. Merge queues run the same check.

The verification runs as two isolated Windows jobs in parallel: the complete packaged Electron
integration suite, and all remaining checks. Each job installs dependencies and builds its own
packaged application so no mutable workspace or build output is shared between runners. Playwright
suites remain serial within each job. A final `Required quality gate` job succeeds only when both
Windows jobs succeed.

Together, the jobs cover:

- ESLint and TypeScript checks;
- script tests and the complete Vitest suite;
- a packaged application build;
- packaged Electron integration tests and renderer component tests;
- product journey tests.

Failed Playwright runs upload `ci-test-diagnostics-*`, including traces, screenshots, and reports,
for 14 days. Each command shown in the workflow is directly reproducible with the corresponding
`yarn` script in `package.json`.

The separate `Canonical Product Documentation` workflow regenerates the checked-in product guide
inside the pinned Linux renderer image and reports stale Markdown, screenshots, or manifests. Its
BuildKit layers use the GitHub Actions cache. This check is advisory while its CI reliability is
being observed: do not add it to branch protection yet. Failed runs upload the generated
documentation for 14 days so differences can be inspected without rerunning the image.

Release tags must point to a commit contained in `main`. Before packaging or publishing, the
release workflow waits for the exact tagged commit to have a successful `CI` run from a push to
`main`. A pull-request run, a run for another commit, or a run from another branch cannot satisfy
the release gate.
