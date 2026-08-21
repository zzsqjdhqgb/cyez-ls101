# TODO: Systematic CI Quality Gates

## Goal

Design and introduce project-wide CI quality gates as one coherent workflow strategy. Do not add
an isolated product documentation gate before the repository has consistent validation for its
main build, test, packaging, and generated-artifact paths.

## Required Coverage

- Define the supported operating-system and architecture matrix for development, packaging, and
  release validation.
- Run formatting or formatting checks, lint, and TypeScript type checking.
- Run script tests and the complete Vitest suite.
- Build the packaged Electron application and run the appropriate Electron smoke and integration
  suites on supported platforms.
- Run renderer component tests separately from packaged Electron integration tests.
- Build release artifacts far enough to detect packaging and native-dependency failures.
- Add the dedicated product documentation renderer check using `yarn docs:product:check` after the
  general CI foundation is in place.
- Verify generated documentation and other committed generated artifacts do not change after
  regeneration.
- Upload Playwright traces, screenshots, test reports, and relevant build logs when a job fails.
- Keep model downloads and other large external assets cached, isolated, and explicitly scoped to
  jobs that require them.

## Workflow Design

- Establish reusable jobs or reusable workflows instead of duplicating setup across release,
  nightly, and pull-request workflows.
- Separate fast pull-request gates from slower scheduled or release validation.
- Use path filters only where they cannot hide cross-cutting build or packaging regressions.
- Pin action versions and external build images, and define a deliberate dependency/image update
  process.
- Apply least-privilege workflow permissions; validation jobs should not receive write access.
- Add concurrency cancellation for superseded pull-request runs.
- Document required checks, expected runtime, ownership, and the procedure for diagnosing failures.

## Product Documentation Gate

When the general CI gates are established, add a Linux job that:

1. Runs `yarn docs:product:check` through the versioned product documentation Docker image.
2. Fails when canonical regeneration changes `docs/product` or the generated Playwright inventory.
3. Uploads `test-results/product-docs` and `test-results/product-docs-preview` when present.
4. Never publishes or commits regenerated files from CI.

## Acceptance Criteria

- Required checks protect the repository's primary integration branch.
- Pull requests cannot merge with lint, type, unit, Electron smoke, or required integration failures.
- Release and nightly workflows consume the same validated build/test primitives as pull requests.
- Generated-artifact checks include product documentation without granting CI permission to modify
  the repository.
- CI behavior and local reproduction commands are documented and kept in sync.
