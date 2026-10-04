# CMU vs eSpeak CTC reference A/B

同一音频只运行一次 ONNX 推理，再用 CMUdict IPA 和 eSpeak `en-us` IPA 分别做
CTC 强制对齐。本实验不调用 LLM；分数和候选数仅用于比较参考体系，不代表人工真值。

## Aggregate

- CMU overall mean: `71.67`
- eSpeak overall mean: `73.33`
- CMU high candidates: `60`
- eSpeak high candidates: `52`

| Sample | CMU score | eSpeak score | Delta | CMU high | eSpeak high |
|---|---:|---:|---:|---:|---:|
| 1 | 64 | 65 | +1 | 29 | 28 |
| 2 | 64 | 66 | +2 | 25 | 20 |
| 3 | 87 | 89 | +2 | 6 | 4 |

## Sample 1

- ID: `0da366a3-a684-4c34-9109-11fdfc63227c---68bc2586-0cbd-4669-aa68-094aebd76b7.wav`
- Audio: [WAV](../../ctc-pause-correction-demo/run-seed-20260820/audio/0da366a3-a684-4c34-9109-11fdfc63227c---68bc2586-0cbd-4669-aa68-094aebd76b7.wav)
- CMU reference phones: `130`
- eSpeak reference phones: `126`
- Top-candidate words removed by eSpeak: `computer, reliable`
- Top-candidate words introduced by eSpeak: `big`

**CMU top candidates**

`looking` ʊ→ə (0, high); `for` f→w (0, high); `because` b→s (0, high); `because` ɔː→ɪ (0, high); `sure` ʊ→ɚ (0, high); `I` aɪ→aʊ (1, high); `definitely` l→k (1, high); `definitely` i→t (1, high); `reliable` ə→əl (1, high); `definitely` ə→n (2, high); `definitely` ə→ɪ (2, high); `computer` t→ɾ (3, high)

**eSpeak top candidates**

`looking` ʊ→ə (0, high); `for` ɔːɹ→ə (0, high); `because` b→s (0, high); `for` f→ð (1, high); `I` aɪ→aʊ (1, high); `definitely` l→k (1, high); `definitely` i→t (1, high); `because` ʌ→ɪ (1, high); `sure` ʊɹ→ɚ (1, high); `definitely` ə→ɪ (2, high); `big` ɡ→k (3, high); `big` ɪ→eɪ (3, high)

Full comparison: [JSON](samples/0da366a3-a684-4c34-9109-11fdfc63227c---68bc2586-0cbd-4669-aa68-094aebd76b7.wav.json)

## Sample 2

- ID: `197b043a-7182-4de2-9a46-ce84fd3f5bd1---46ca6809-80ae-4412-b6e2-1fdf4ea2b98.wav`
- Audio: [WAV](../../ctc-pause-correction-demo/run-seed-20260820/audio/197b043a-7182-4de2-9a46-ce84fd3f5bd1---46ca6809-80ae-4412-b6e2-1fdf4ea2b98.wav)
- CMU reference phones: `110`
- eSpeak reference phones: `109`
- Top-candidate words removed by eSpeak: `habit`
- Top-candidate words introduced by eSpeak: `spending, you, for`

**CMU top candidates**

`Of` v→t (0, high); `course` s→æ (0, high); `things` θ→t (0, high); `habit` ə→eɪ (0, high); `course` ɔː→ʌ (2, high); `saving` eɪ→ɪ (2, high); `money` ʌ→æ (3, high); `money` ʌ→æ (3, high); `means` iː→eɪ (3, high); `course` ɹ→p (3, high); `very` ɛ→ɜː (6, high); `plan` æ→aɪ (7, high)

**eSpeak top candidates**

`Of` v→t (0, high); `course` oːɹ→ʌ (0, high); `things` θ→t (0, high); `saving` eɪ→ɪ (2, high); `money` ʌ→æ (3, high); `money` ʌ→æ (3, high); `means` iː→eɪ (3, high); `very` ɛ→ɜː (6, high); `plan` æ→aɪ (7, high); `spending` d→i (7, high); `you` uː→iː (8, high); `for` f→t (9, high)

Full comparison: [JSON](samples/197b043a-7182-4de2-9a46-ce84fd3f5bd1---46ca6809-80ae-4412-b6e2-1fdf4ea2b98.wav.json)

## Sample 3

- ID: `5f97bbc9-c953-4143-a4fe-09006ba4c74a---92b07602-30f4-4899-831b-18091ea6063.wav`
- Audio: [WAV](../../ctc-pause-correction-demo/run-seed-20260820/audio/5f97bbc9-c953-4143-a4fe-09006ba4c74a---92b07602-30f4-4899-831b-18091ea6063.wav)
- CMU reference phones: `101`
- eSpeak reference phones: `101`
- Top-candidate words removed by eSpeak: `are`
- Top-candidate words introduced by eSpeak: `on`

**CMU top candidates**

`apparently` ɛ→ɪ (1, high); `apparently` t→n (3, high); `Cherry` ɛ→ɜː (7, high); `Cherry` i→ɪ (8, high); `apparently` ə→ɐ (8, high); `are` ɚ→ɑːɹ (14, high)

**eSpeak top candidates**

`apparently` æ→ɪ (1, high); `apparently` t→n (3, high); `Cherry` ɛ→ɜː (7, high); `Cherry` i→ɪ (8, high); `on` ɔ→ɑː (35, tentative)

Full comparison: [JSON](samples/5f97bbc9-c953-4143-a4fe-09006ba4c74a---92b07602-30f4-4899-831b-18091ea6063.wav.json)

## Known gap

The teacher-read negative regression described in `SIDE_CONVERSATION_HANDOFF.md`
has no corresponding audio file in the workspace, so it is not included in this run.
The reference sentence itself was phonemized successfully and all resulting eSpeak
tokens exist in the model vocabulary. See
[`teacher-negative-reference-check.json`](teacher-negative-reference-check.json).
