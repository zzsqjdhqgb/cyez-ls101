# TODO: Product Documentation Screenshot Docker

## Goal

Create a dedicated, reproducible Docker environment that is the only environment allowed to
publish product documentation screenshots to `docs/product`.

Windows, macOS, ordinary Linux environments, and the general development container must still be
able to run the product documentation tests, but their screenshots must remain under
`test-results/product-docs-preview` and must never update committed documentation assets.

## Required Behavior

- `yarn test:product-docs` runs the complete product documentation suite without modifying
  `docs/product`.
- A separate publishing command runs only inside the dedicated screenshot container.
- The publishing command refuses to run when the expected container identity and version are not
  present.
- Only the dedicated container may set `PRODUCT_DOCS_CANONICAL=1`.
- Preview runs retain screenshots and generated Markdown under `test-results` for diagnosis.
- Canonical screenshots use CSS pixel scaling and a fixed `1280x800` content area.
- Canonical image preservation requires identical dimensions and zero detected pixel differences.

## Dedicated Image

- Add a separate Dockerfile, for example `docker/product-docs/Dockerfile`.
- Pin the base image by digest rather than relying only on a mutable tag.
- Pin Node, Yarn, Electron, Playwright, Chromium dependencies, fonts, and locale data through the
  repository lockfile and explicit system package versions where practical.
- Install the exact fonts used by the application, including the required Latin and CJK families.
- Fix `LANG`, `LC_ALL`, `TZ`, Xvfb resolution, color depth, DPI, and rendering-related environment
  variables.
- Use software rendering and disable dependence on the host GPU.
- Include a versioned, image-owned marker such as
  `/etc/ls101-product-docs-renderer-version`; do not rely only on a user-settable environment
  variable.
- Keep this image separate from the interactive development image in `docker/Dockerfile`.

## Command Separation

- Change the default product documentation command to preview/test-only behavior.
- Add a clearly named canonical command, for example `yarn docs:product:publish`.
- Make the canonical runner verify all of the following before starting Playwright:
  - platform is Linux;
  - the renderer marker file exists;
  - its version matches the version expected by the repository;
  - required locale, fonts, display settings, and software-rendering configuration are active.
- Fail before launching Electron if any requirement is missing.
- Keep filtered or `--grep` runs preview-only.

## Container Workflow

- Build the image with a documented command.
- Mount the repository so canonical files can be updated, but keep dependency and build-output
  mounts isolated from Windows artifacts.
- Run dependency installation and application packaging inside the container.
- Run Playwright under the container-owned Xvfb configuration.
- Publish canonical documentation only after the complete suite passes.
- Provide a check command that fails when a canonical run changes files unexpectedly.

## CI

- Add a Linux CI job that builds or pulls the versioned screenshot image.
- Run the canonical documentation check in that image.
- Fail when `docs/product` differs after regeneration.
- Optionally upload preview screenshots and Playwright traces when the job fails.
- Do not allow Windows release or nightly jobs to regenerate canonical screenshots.

## Migration

1. Introduce the dedicated image and its version marker.
2. Split preview and canonical runner commands.
3. Guard canonical publication in `scripts/run-product-docs.mjs` or its replacement.
4. Update package scripts and `tests/product-docs/README.md`.
5. Generate a fresh canonical baseline inside the dedicated image.
6. Confirm two clean container runs produce byte-identical PNG files.
7. Add the CI check and remove any remaining ordinary-host publication path.

## Acceptance Criteria

- Running product documentation tests on Windows changes no files under `docs/product`.
- Running product documentation tests outside the dedicated container changes no files under
  `docs/product`.
- Attempting canonical publication outside the dedicated container exits with a clear error before
  launching Electron.
- Two consecutive canonical runs from the same source commit produce byte-identical screenshots.
- The dedicated container produces exactly `1280x800` PNG files for full-window evidence.
- A deliberate one-pixel detectable UI change causes the relevant canonical screenshot to change.
- A failed or partial test run never publishes canonical documentation.
