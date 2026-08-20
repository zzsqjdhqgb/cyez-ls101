# CTC reference A/B: CMUdict vs eSpeak

This experiment tests one narrow question: whether CTC forced alignment should
derive its expected IPA from CMUdict plus a handwritten mapping, or from the
same eSpeak convention used by `facebook/wav2vec2-lv-60-espeak-cv-ft`.

It does not call an LLM. For each recording, the ONNX model runs once and the
identical logits are aligned twice. The script first asserts that its CMU result
is byte-for-byte equal to the saved baseline evidence, then computes the eSpeak
comparison.

## Reproduce

The verified run used `phonemizer==3.4.0`, eSpeak NG 1.51, `en-us`, NumPy, and
ONNX Runtime:

```bash
cd /workspace/textpa
python scripts/compare_ctc_reference_sources.py
```

The eSpeak path mirrors the upstream tokenizer's whole-utterance behavior, so
contextual weak forms such as `a /ɐ/` and `to /tə/` are retained. eSpeak's word
delimiter hints are combined with ordered edit alignment because eSpeak may
occasionally merge multiple written words into one output group.

## Result

Across the three fixed samples:

| Metric | CMUdict | eSpeak |
|---|---:|---:|
| Mean experimental phone score | 71.67 | 73.33 |
| High-threshold candidates | 60 | 52 |

Every eSpeak alignment path score improved. Known representation artifacts for
`computer` (`/t/` vs `/ɾ/`), `reliable` (`/ə/ + /l/` vs `/əl/`), and `are`
(`/ɚ/` vs `/ɑːɹ/`) were removed or substantially reduced. The detailed,
trackable output is in [`run-seed-20260820/report.md`](run-seed-20260820/report.md).

This is enough to use eSpeak as the reference foundation for the next
iteration, but not enough to send its raw candidates to the LLM. Composite and
split tokens such as `/ɔːɹ/` versus `/ɔː/ + /ɹ/` still need an equivalence-aware
alignment or evidence gate.

The teacher-read negative example documented in
`../../SIDE_CONVERSATION_HANDOFF.md` cannot yet be evaluated because its audio
is not present in the workspace. Its sentence does phonemize entirely into
tokens present in the model vocabulary; the reference-only check is retained in
[`run-seed-20260820/teacher-negative-reference-check.json`](run-seed-20260820/teacher-negative-reference-check.json).
