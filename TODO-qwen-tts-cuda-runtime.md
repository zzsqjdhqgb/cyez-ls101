# TODO: Qwen TTS CUDA Runtime Distribution

## Goal

Reduce Qwen TTS CUDA download and release-build overhead without requiring users to install the
complete CUDA Toolkit or weakening the model package's data-only security boundary.

## Current Temporary State

- Application setup and packaging include only the CPU helper. Published CUDA helpers and runtime
  libraries remain available in the runtime release, but the application does not download or
  bundle them.
- The Qwen Provider settings UI keeps CUDA selection and probing unavailable and saves Qwen
  Providers with the CPU backend.
- Re-enable CUDA consumption only after the optional, on-demand runtime bundle described below is
  implemented. Restoring it requires asset selection and integrity checks, install/update/removal
  handling, removal of the main-package CUDA exclusions, UI installation/probe/selection states,
  and packaged-application tests for both an installed bundle and CPU-only operation.

## CUDA Runtime Bundle

- Publish the required platform CUDA dynamic libraries as a separately versioned, on-demand runtime
  bundle instead of placing them in the model package or main application installer.
- Determine the exact Windows and Linux dependency sets from the built helpers and NVIDIA's
  redistributable manifest.
- Verify every downloaded file against the release manifest's pinned size and SHA-256 digest.
- On Windows, additionally validate the Authenticode chain and expected NVIDIA publisher. A valid
  NVIDIA signature does not replace the pinned digest or version check.
- Load libraries only from a dedicated runtime directory through an explicit DLL/shared-library
  search path; do not add an untrusted directory to the global `PATH`.
- Document redistribution licenses, supported CUDA/driver versions, update procedure, rollback, and
  removal behavior.
- Keep CPU operation available when the bundle is absent, and report missing or incompatible CUDA
  libraries through the explicit CUDA probe.

## Smaller CI Toolkit Installation

- Split Windows and Linux CUDA setup steps so each platform can request only the components needed
  to compile and link the helper.
- Evaluate and pin the CUDA action's platform-specific subpackage names for NVCC, CUDA runtime
  headers/libraries, and cuBLAS headers/libraries.
- Exclude samples, documentation, profilers, IDE integration, and other unused Toolkit components.
- Record setup duration and download size before and after the change; retain the existing native
  build and helper smoke checks.
- Preserve the pinned CUDA Toolkit version and fail clearly when an expected component is missing.

## Acceptance Criteria

- A user with a compatible NVIDIA driver can enable CUDA after downloading the managed runtime
  bundle, without installing the full CUDA Toolkit.
- Model packages remain free of executables and dynamic libraries.
- Tampered, incorrectly signed, unexpected-version, and incomplete runtime bundles are rejected.
- Windows and Linux CUDA helpers build successfully using the reduced Toolkit installation.
- CUDA Toolkit setup time and downloaded bytes are measurably lower in the release workflow.
