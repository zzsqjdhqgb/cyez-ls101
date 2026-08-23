# CI quality gate

The `CI` workflow runs for pull requests targeting `dev` or `main` and for every push to either
branch. Configure the `Required quality gate` check as required in the branch protection rules for
both branches and do not configure bypass actors. Merge queues run the same check.

The gate runs on Windows, the release platform, and covers:

- ESLint and TypeScript checks;
- script tests and the complete Vitest suite;
- a packaged application build;
- packaged Electron integration tests and renderer component tests;
- product journey tests.

Failed Playwright runs upload `ci-test-diagnostics-*`, including traces, screenshots, and reports,
for 14 days. Each command shown in the workflow is directly reproducible with the corresponding
`yarn` script in `package.json`.

Release tags must point to a commit contained in `main`. Before packaging or publishing, the
release workflow waits for the exact tagged commit to have a successful `CI` run from a push to
`main`. A pull-request run, a run for another commit, or a run from another branch cannot satisfy
the release gate.
