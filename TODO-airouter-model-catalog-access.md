# TODO: AIRouter Model Catalog Access

## Goal

Make AIRouter model metadata available without requiring users to access `models.dev` through a
proxy or other network workaround.

AIRouter currently fetches `https://models.dev/api.json` at runtime from
`packages/airouter/src/main/service.ts`. In networks where that service is unreachable, model
discovery still works through the configured Provider, but model names, context/output limits,
reasoning capabilities, and structured-output metadata are unavailable.

## Candidate Approaches

Evaluate and implement one of the following approaches, or a documented combination of them:

- Use a reliable catalog source that is directly reachable from the application's supported
  networks.
- Host and maintain a mirror of the required `models.dev` catalog data.
- Fetch and validate a catalog snapshot during the build or release process, commit or package the
  generated snapshot with the application, and use it as the runtime baseline.

Prefer an approach that does not add a mandatory runtime network dependency. If runtime refresh is
retained, it should be optional and fall back to the packaged catalog without delaying the model
settings workflow.

## Required Behavior

- Users can view catalog-backed model metadata when `models.dev` is unreachable.
- AIRouter does not require a proxy, VPN, or other special network configuration for normal model
  configuration.
- Catalog failures do not prevent Provider model discovery or use of custom models.
- The catalog source, snapshot version or generation time, validation rules, and update procedure
  are documented.
- Build or mirror updates validate the expected schema and fail clearly instead of packaging
  malformed or empty catalog data.
- Runtime refreshes, if supported, use a bounded timeout and preserve the last known usable local
  catalog on failure.
- Licensing, attribution, integrity, and redistribution requirements for catalog data are recorded
  before a snapshot or mirror is shipped.

## Acceptance Criteria

- With access to `models.dev` blocked, AIRouter still supplies model names, context/output limits,
  reasoning capabilities, and structured-output metadata from a bundled or directly reachable
  source.
- Model listing remains responsive while all catalog network requests fail or time out.
- Automated tests cover the offline path, catalog update validation, and fallback from a failed
  refresh to the packaged or last known usable catalog.
- Packaged Electron smoke or targeted integration coverage verifies that catalog metadata is
  available without contacting `models.dev` at runtime.
