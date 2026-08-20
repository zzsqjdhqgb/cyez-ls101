# CTC + TextPA pause correction demo

This demo is deliberately separate from the Electron application. It tests an
evidence-constrained correction flow for free-speech recordings:

```text
published Whisper transcript (provisional, not ground truth)
                         +
application Wav2Vec2 ONNX INT8 logits
                         |
                  CTC forced alignment
                         |
              expected/observed phone conflicts

published TextPA Charsiu frame alignment
                         |
                  internal [SIL] events

structured evidence -> text LLM -> Chinese correction without a score
```

The LLM never receives human labels. Every reported pronunciation or fluency
issue must cite a generated `P-*` or `F-*` evidence ID. The response validator
rejects unknown IDs. Because MultiPA is free speech, its Whisper transcript is
only a provisional alignment target; the result cannot establish omitted or
incorrect words.

## Run

The Python prototype needs `numpy` and `onnxruntime`. It reads the existing
`.env.local` for the OpenAI-compatible endpoint and key without copying either
into output files.

```bash
python -m pip install numpy onnxruntime
python scripts/run_ctc_pause_correction_demo.py --evidence-only
python scripts/run_ctc_pause_correction_demo.py
```

The fixed default seed is `20260820`. It randomly orders the 50 published
MultiPA cues, skips only transcripts that the product-compatible CMUdict path
cannot represent, and selects the first three eligible samples. Audio, prompts,
raw provider responses, parsed corrections, evidence, source hashes, and the
human-listening report are retained in the run directory.

The script executes samples sequentially. HTTP 429 and transient server errors
are retried; an explicit billing or credit error stops the run immediately.
