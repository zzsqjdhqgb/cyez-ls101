# TODO: Responsive Startup Progress

Status: completed on 2026-08-26.

Implemented behavior:

- The logo keeps its 1.5-second animation. The progress indicator begins to fade in one second
  later only if the startup placeholder is still present.
- Successful initialization waits for that same one-second settle period before replacing the
  startup placeholder, so the main interface never interrupts the intended animation timing.
- The reveal is driven by the initial document CSS, so loading or executing the application bundle
  cannot prevent it from being scheduled. The moving bar uses a transform animation suitable for
  compositor execution.
- The startup placeholder deliberately does not apply the application's reduce-motion preference:
  that preference is stored in the config module and is unavailable until after startup completes.
- Renderer initialization is split into named yielding phases. Structured logs record each phase's
  start, completion or failure, and duration without recording user data.
- A packaged Electron integration test covers delayed startup. Unit tests cover phase timing,
  yielding, failure propagation, and unconditional logo motion.

## Problem

The startup placeholder contains an indeterminate progress bar, but it is only revealed after the
1.5-second logo animation and an additional one-second delay. Application initialization starts
before those waits complete. If initialization performs enough synchronous renderer work to block
the event loop, neither the reveal timer nor a paint can run, leaving users with a static logo for
the entire delay.

A Windows CI product-documentation run captured this state after 20 seconds: the page remained on
`曹二听说101 正在启动`, and its accessibility tree contained the startup image but no progress bar.
Increasing the Windows test startup budget prevents a false test failure, but does not address the
unresponsive startup experience.

## Investigation

- Measure each phase of `openActiveApplication()`: legacy-data migration, installation marker,
  Schema initialization, bundled Interface reconciliation, template/function-library
  initialization, and release-note claiming.
- Identify synchronous parsing, validation, hashing, or repository work that blocks renderer
  paints for material periods.
- Record phase durations in structured startup logs without exposing user data or file contents.

## Implementation

- Ensure the progress indicator becomes visible before potentially expensive initialization work.
- Yield to a browser paint after revealing the indicator and before starting blocking work.
- Move expensive work off the renderer thread, split it into yielding chunks, or perform it in the
  main process/worker where appropriate.
- Preserve the startup logo animation for normal fast launches without delaying feedback on slow
  launches.
- Keep initialization failures visible immediately with the existing retry action.

## Acceptance Criteria

- A deliberately delayed or CPU-heavy initialization displays an accessible progress indicator
  within 2.5 seconds and keeps it visibly animating.
- The renderer remains responsive enough to paint while bundled content is initialized.
- Startup phase timings identify which operation caused a slow launch.
- Normal startup, reduced-motion startup, initialization failure, and packaged Windows startup
  are covered by focused tests.
- Product-documentation tests continue to assert application readiness rather than treating the
  progress indicator as readiness.
