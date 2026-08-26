# CI quality gate

The `CI` workflow runs for pull requests targeting `dev` or `main` and for every push to either
branch. Configure the `Required quality gate` check as required in the branch protection rules for
both branches and do not configure bypass actors. Merge queues run the same check.

The verification runs as three isolated jobs in parallel: the complete packaged Electron
integration suite on Windows, all remaining technical checks on Windows, and the canonical product
documentation suite in the pinned Linux renderer container. No mutable workspace or build output
is shared between runners, and Playwright suites remain serial within each job. A final
`Required quality gate` job succeeds only when all three jobs succeed.

Together, the jobs cover:

- ESLint and TypeScript checks;
- script tests and the complete Vitest suite;
- packaged Windows and canonical Linux application builds;
- packaged Electron integration tests and renderer component tests;
- canonical product journey tests and checked-in documentation freshness.

Failed technical Playwright runs upload `ci-test-diagnostics-*`, including traces, screenshots,
and reports, for 14 days. Failed canonical runs upload the regenerated product documentation for
the same period. Canonical renderer layers use the GitHub Actions cache. Each command shown in the
workflow is directly reproducible with the corresponding `yarn` script in `package.json`.

Release tags must point to a commit contained in `main`. Before packaging or publishing, the
release workflow waits for the exact tagged commit to have a successful `CI` run from a push to
`main`. A pull-request run, a run for another commit, or a run from another branch cannot satisfy
the release gate.
