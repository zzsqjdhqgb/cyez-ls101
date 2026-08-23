# CMUdict + CTC-GOP pronunciation correction demo

`scripts/run_pronunciation_gop_demo.py` is the single callable entry point for
the local pronunciation-only experiment. It replaces the earlier manual chain
of audio conversion, ASR, model inference, alignment, candidate filtering, and
report formatting.

The demo does not assess grammar, wording, content, pauses, or a total score.
For free speech, ASR text is a provisional alignment target rather than a
ground-truth answer. Unknown ASR words are rejected unless the caller supplies
an explicit ARPAbet pronunciation; the script never silently performs a
semantic correction.

## Requirements

- Python 3.10 or newer with the packages pinned in `requirements-lock.txt`.
- FFmpeg on `PATH`.
- A local Hugging Face Wav2Vec2 CTC checkpoint whose vocabulary is the 39
  stressless CMU/ARPAbet phones plus `<pad>`. The current research model is
  expected at `/workspace/.gop-research/model` and is intentionally ignored by
  git because its weights are about 1.2 GB.
- `node`, `sherpa-onnx-node`, the local Qwen3 ASR assets, and
  `scripts/test-stt.js` only when using `--asr qwen3`.

Inside the current workspace, the demo automatically discovers the ignored
`.gop-research/site` dependency directory when the packages are not installed
in the active Python environment.

## Free-speech example

This command takes only the recording as semantic input. Qwen3 ASR runs inside
the Python entry point, followed by CMUdict reference generation, local acoustic
inference, CTC alignment, GOP evidence, and conservative report generation:

```bash
python3 textpa/scripts/run_pronunciation_gop_demo.py \
  --audio .gop-research/exam/recording-11.webm \
  --asr qwen3 \
  --model-dir .gop-research/model \
  --pronunciation 'overweigh=OW V ER W EY' \
  --output-dir .gop-research/exam/stable-gop-demo \
  --overwrite
```

The explicit `overweigh` entry records the ASR acoustic hypothesis. It is not a
grammar or vocabulary correction. If ASR produces another out-of-dictionary
word, the command exits with a message naming the required
`--pronunciation WORD=PHONES` argument.

## Known-text example

For a reading task or a previously reviewed transcript, bypass ASR:

```bash
python3 textpa/scripts/run_pronunciation_gop_demo.py \
  --audio answer.wav \
  --text-file transcript.txt \
  --model-dir .gop-research/model \
  --output-dir artifacts/pronunciation-demo
```

`--text 'The exact sentence.'` and `--text -` (stdin) are also supported.

## Outputs

The output directory contains:

- `result.json`: full word/phone alignment, legal CMUdict variant selected for
  each word, timestamps, acoustic winner, GOP log ratio, diagnostics, and
  provenance;
- `report.md`: conservative Chinese learner-facing pronunciation feedback.

Existing outputs are not overwritten unless `--overwrite` is supplied. A
successful run exits with status 0 and prints the two output paths as JSON. A
configuration, dictionary, dependency, model, or alignment error exits with
status 2 without writing a partial report.

## GOP modes

`--gop-method auto` is the default. The exact CTC-GOP-S wildcard denominator is
quadratic in reference length and expensive for long free speech, so `auto`
only uses it below `--exact-work-limit`. Larger inputs use bounded CTC Viterbi
GOP, computed as the aligned target phone's mean log posterior minus the
log-sum posterior of competing phones.

Use `--gop-method exact` only for short utterances. The command rejects an
exact run whose estimated work exceeds the limit instead of appearing to hang.
Raise `--exact-work-limit` explicitly when the additional runtime is intended.

The feedback layer reports only repeated, ordinary English consonant
confusions that pass conservative evidence thresholds. Raw phone rows remain
available in `result.json`; a low GOP value alone is not presented as an
established pronunciation error.
