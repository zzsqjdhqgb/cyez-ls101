# Agnes SpeechOcean762 Benchmark

This directory records the Agnes `agnes-2.5-flash` SpeechOcean762 test-set
run. The raw model responses and the derived IPA/fusion output are kept as
JSONL so that the benchmark can be audited without reissuing API requests.

## Run configuration

- Dataset: SpeechOcean762 `test`, 2,500 utterances.
- API: OpenAI-compatible Chat Completions at
  `https://apihub.agnes-ai.com/v1/chat/completions`.
- Model: `agnes-2.5-flash`.
- `max_tokens=65535`, concurrency 20, request-start interval 3.25 seconds.
- Thinking was explicitly enabled with
  `chat_template_kwargs.enable_thinking=true`.
- No calibration anchor was used. The existing anchors are from MultiPA and
  are not transferable; selecting anchors from this test split would leak
  evaluation labels.
- The key is loaded from `TEXTPA_API_KEY` in the ignored `.env.local` file.
  No key value is stored in this directory.

The complete request manifest, hashes, token totals, and interruption history
are in
`agnes-2.5-flash-speechocean762-thinking.jsonl.manifest.json`.

## Results

The raw output is
`agnes-2.5-flash-speechocean762-thinking.jsonl`; the finalized output is
`agnes-2.5-flash-speechocean762-thinking-final.jsonl`.

| Accuracy field | PCC | Fluency PCC |
| --- | ---: | ---: |
| `assessment.accuracy` (LLM only) | 0.317258 | 0.442628 |
| `scores.paper_cohort_accuracy` | 0.469238 | 0.442628 |
| `scores.deployment_accuracy_1_5` | 0.484143 | 0.442628 |

The run used 3,635,015 total tokens, including 1,670,551 reasoning tokens.
There were two process interruptions; each was resumed from the JSONL output,
and the final file has 2,500 unique IDs with no missing assessments.

## Local 50-item baseline

Before spending API requests on SpeechOcean762, the same model was checked on
the repository's 50-item MultiPA smoke benchmark. The explicit-thinking run
was selected for the large evaluation because its LLM-only and deployment
Accuracy PCC were higher, even though its Fluency PCC was slightly lower.

| Configuration | LLM Accuracy PCC | Fluency PCC | Paper-fused Accuracy PCC | Deployment Accuracy PCC |
| --- | ---: | ---: | ---: | ---: |
| Provider-default thinking | 0.180741 | 0.643554 | 0.577599 | 0.505097 |
| Explicit `enable_thinking` | 0.365219 | 0.601460 | 0.576555 | 0.575206 |

The four raw/finalized 50-item files are retained in this directory with
`multipa-baseline` and `multipa-thinking` stems. No SpeechOcean test labels
were used as calibration anchors.

## Four-anchor rerun

At the user's request, the explicit-thinking MultiPA run was repeated with the
four existing `multipa-extreme4-anchors.jsonl` examples inserted into every
prompt. The four anchor records were excluded from scoring, so this is a
46-item held-out result. The selection is transductive because the anchors were
chosen using labels from this same 50-item benchmark; it is not an
out-of-sample deployment estimate.

| Configuration, same 46 IDs | LLM Accuracy PCC | Fluency PCC | Paper-fused Accuracy | Deployment Accuracy |
| --- | ---: | ---: | ---: | ---: |
| Explicit Thinking, no anchors | 0.436284 | 0.595166 | 0.574926 | 0.579581 |
| Explicit Thinking, four anchors | 0.257959 | 0.570639 | 0.519649 | 0.480239 |

On this comparison, anchors reduced every reported PCC. The raw and finalized
anchor outputs are
`agnes-2.5-flash-multipa-thinking-extreme4.jsonl` and
`agnes-2.5-flash-multipa-thinking-extreme4-final.jsonl`; the exact protocol,
hashes, and score fields are in the matching `.manifest.json` and
`agnes-2.5-flash-multipa-thinking-extreme4-comparison.json`.

To reproduce the anchored run:

```bash
PYTHONPATH=src python3 scripts/run_agnes_eval.py \
  --input benchmark-data/multipa-reference/paper_cues.jsonl \
  --output benchmark-data/agnes/agnes-2.5-flash-multipa-thinking-extreme4.jsonl \
  --env .env.local --concurrency 20 --min-interval 3.25 \
  --retries 12 --timeout 300 --max-tokens 65535 --thinking \
  --calibration-anchors benchmark-data/calibration/multipa-extreme4-anchors.jsonl \
  --exclude-calibration-anchors
```

## Reproduction

Set the ignored environment file with the endpoint credentials, then run:

```bash
PYTHONPATH=src python3 scripts/run_agnes_eval.py \
  --speech-zip benchmark-data/upstream-reference/speechocean.zip \
  --output benchmark-data/agnes/agnes-2.5-flash-speechocean762-thinking.jsonl \
  --env .env.local \
  --concurrency 20 --min-interval 3.25 --retries 12 \
  --timeout 300 --max-tokens 65535 --thinking
```

Finalize and evaluate locally (no API call):

```bash
textpa finalize \
  benchmark-data/agnes/agnes-2.5-flash-speechocean762-thinking.jsonl \
  -o benchmark-data/agnes/agnes-2.5-flash-speechocean762-thinking-final.jsonl

python3 scripts/evaluate_speechocean762.py \
  benchmark-data/agnes/agnes-2.5-flash-speechocean762-thinking-final.jsonl \
  --annotations benchmark-data/agnes/speechocean762-test-human-scores.jsonl \
  --accuracy-field scores.paper_cohort_accuracy
```

The upstream ZIP is the large source snapshot. The labels manifest records the
SpeechOcean repository revision and source hashes used to derive the tracked
human-score JSONL.
