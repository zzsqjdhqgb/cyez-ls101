# TODO: Qwen TTS CPU Threading

## Problem

The Qwen TTS model package currently declares `synthesis.threads: 4`, and Airouter passes that
value to the native helper as `--threads`. The helper copies it into `tts_params.n_threads`, but
the pinned `qwen3-tts.cpp` runtime never applies that value to a GGML CPU backend. All CPU inference
therefore continues to use GGML's default of four threads regardless of the configured value.

## Implementation

- Apply the helper thread count with `ggml_backend_cpu_set_n_threads()` when creating the primary
  CPU backend.
- Apply an independently bounded thread count to the CPU fallback backend used by CUDA sessions.
- Configure backend threads before model loading and keep the value stable for the lifetime of a
  helper session.
- Use `os.availableParallelism()` in the Electron main process for an automatic default that
  respects process affinity and container limits.
- Keep an explicit provider override for diagnostics and machines where physical cores, SMT, or
  hybrid P/E cores make the automatic value suboptimal.
- Restart only the affected Qwen TTS helper session when its thread setting changes.
- Do not treat sustained 100% CPU utilization as the optimization target; optimize measured speech
  latency and throughput while preserving application responsiveness.

## Benchmarking

- Compare thread counts `4`, `8`, `12`, `16`, and the automatic value on representative low-end,
  mainstream, and high-core-count CPUs.
- Measure warm single-request latency, generated-audio realtime factor, process memory, and UI
  responsiveness with identical text, model, voice, and sampling parameters.
- Separate Talker/code-predictor time from vocoder time using `QWEN3_TTS_TIMING` instrumentation.
- Confirm that additional logical threads still improve performance before selecting a value above
  the physical-core count.

## Acceptance Criteria

- Changing `--threads` measurably changes the GGML CPU backend thread count.
- Automatic mode never selects zero threads and leaves capacity for the Electron application.
- Manual configuration is validated and survives provider persistence and reload.
- CPU-only synthesis remains deterministic within the existing sampling guarantees and does not
  introduce concurrent access to the engine's mutable KV caches or RNG.
- Focused native tests and Electron integration tests cover automatic selection, manual override,
  and helper-session restart behavior.
