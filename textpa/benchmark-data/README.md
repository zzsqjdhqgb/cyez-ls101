# Raw LLM benchmark data

This directory contains raw assessment records from TextPA/MultiPA benchmark
runs. Most runs cover all 50 items. The `gpt-5.6-luna-max-extreme4` run uses
four labeled calibration anchors and intentionally covers the other 46 items.
The JSONL files in `llm-benchmark/` are the unfinalized output of
`textpa assess`; they do not contain API keys, canonical IPA, or derived fusion
scores. Each JSONL file has a
same-stem `.manifest.json` with the model, endpoint, reasoning effort (when
explicitly requested), retry/timeout settings, and the SHA-256 of the input
cue file.

The exact four human-scored examples are stored in `calibration/`; its README
records the deterministic selection rule and leakage limitation. The
calibrated manifest additionally records their order, scores and file hash.

Finalized outputs from the same runs are preserved in
`derived-llm-benchmark/`. They can still be regenerated from a raw file:

```bash
run_name=gpt-5.6-sol-high

textpa finalize \
  "benchmark-data/llm-benchmark/${run_name}.jsonl" \
  -o "/tmp/${run_name}-final.jsonl"

textpa evaluate-multipa \
  "/tmp/${run_name}-final.jsonl" \
  --annotations artifacts/multipa-reference/annotation.csv \
  --accuracy-field scores.paper_cohort_accuracy
```

The calibrated 46-item run requires intentional subset evaluation:

```bash
run_name=gpt-5.6-luna-max-extreme4

textpa finalize \
  "benchmark-data/llm-benchmark/${run_name}.jsonl" \
  -o "/tmp/${run_name}-final.jsonl"

textpa evaluate-multipa \
  "/tmp/${run_name}-final.jsonl" \
  --annotations artifacts/multipa-reference/annotation.csv \
  --accuracy-field scores.paper_cohort_accuracy \
  --allow-subset
```

Additional preserved material is grouped by purpose:

- `anchor-benchmark/` contains the complete four-anchor experiment directory,
  including its 46-item raw and finalized outputs.
- `diagnostic-smoke/` contains the audio, cue/transcript inputs, manifests, and
  the Sol medium diagnostic response.
- `reasoning-rerun-smoke/` contains the single-sample reasoning-depth reruns.
- `smoke/` contains the early smoke-test inputs and finalized paper-model
  outputs.
- `multipa-reference/` contains the small public reference snapshot.
- `upstream-reference/` preserves the downloaded SpeechOcean snapshot from the
  pinned TextPA checkout; it was not used by the current MultiPA benchmark.

To reproduce a raw run on another machine, first prepare the reference data
with `textpa prepare-reference --output-dir artifacts/multipa-reference`, then
use the matching model and endpoint values from its manifest. The absolute
input path in a manifest is local metadata; verify the recorded SHA-256 rather
than relying on that path. API keys must be supplied through the environment,
never committed to this directory.
