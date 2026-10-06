# IndexTTS 2.5 runtime

The application exposes [IndexTTS 2.5](https://github.com/index-tts/index-tts) as a third local
speech provider (`index-tts`) next to `pocket-tts` and `qwen-tts`. It is a zero-shot voice-cloning
model: every synthesis request carries a reference audio clip, and the engine returns one whole
22 050 Hz mono PCM16 WAV. There is no streaming path; the renderer receives the finished file
through the existing speech-synthesis event.

Upstream facts, the integration survey, hardware tiers, and the pending decisions live in
[`TODO-index-tts-2-5.md`](../../TODO-index-tts-2-5.md) at the repository root. This document is the
runtime and contract reference.

## Current state

Application-side wiring is implemented and covered by tests; the helper executable, the model
packages, and the asset pipeline are not built yet because the inference route is still being
decided (native `audio.cpp` helper versus an official PyTorch sidecar).

Implemented:

- `index-tts` is a member of `AIRouterSpeechProviderType`, accepted by provider-config validation,
  by the stored-config type guard, and by the model-package runtime engine allowlist.
- `IndexTtsSynthesizer` (`packages/airouter/src/main/index-tts.ts`) implements
  `AIRouterLocalSpeechSynthesizer`, with `IndexTtsProtocolDecoder`
  (`index-tts-protocol.ts`) decoding helper output.
- The provider is registered in `localSynthesizers` and disposed on `will-quit`.
- The Provider editor exposes a compute-backend selector (`CPU` / `NVIDIA GPU (CUDA)`); the stored
  backend is honoured for `index-tts` only. `qwen-tts` remains CPU-only.

## Helper contract

Everything the runtime executable needs to implement is below. Only
`resolveHelperPath(backend, { helperPaths })` knows where the executable lives, so switching between
a native helper and a Python sidecar changes that function alone.

### Executable resolution

| Mode        | Path                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------- |
| Packaged    | `<resourcesPath>/index-tts/<platform>-<arch>/ls101-index-tts-helper-<backend>[.exe]`                |
| Development | `<appPath>/externals/ai/index-tts/runtime/<platform>-<arch>/ls101-index-tts-helper-<backend>[.exe]` |
| Override    | `helperPaths[backend]` (tests, local experiments)                                                   |

A missing executable fails before any process starts with
`缺少 IndexTTS 原生运行时：<path>；请先执行 yarn index-tts:build-runtime`.

### Command line — load-time identity only

```
<helper> --backend <cpu|cuda> \
         --model <absolute path to the tts-model asset> \
         --weight-type <native|f32|f16|bf16|q8_0> \
         --language <auto|zh|en|ja|es|ar|...> \
         --threads <n>
```

`PATH` is prefixed with the helper's directory and `OMP_NUM_THREADS` is set to `threads`. The thread
count must stay fixed per session: CPU thread count is known to change reference encoding and
therefore clone results (upstream issue #679).

**Voice and synthesis parameters must never become command-line arguments.** One helper process
serves a whole `(model, backend, weight-type, language, threads)` combination; the man/woman voices
of an exam alternate through the same process. Putting the reference clip or a sampling parameter
into argv or the session key would load one full model per voice — roughly 16 GB of VRAM for the
7.89 GB fp32 package, which overflows an 8 GB card.

### Request frame (stdin)

One JSON header line followed immediately by exactly `textBytes` UTF-8 bytes:

```json
{
  "op": "synthesize",
  "id": "<32-hex request id>",
  "textBytes": 123,
  "voiceRef": "/abs/reference.wav",
  "emotionAlpha": 1.0,
  "durationFactor": 1.0,
  "numBeams": 3,
  "doSample": true,
  "temperature": 0.8,
  "topK": 30,
  "topP": 0.8,
  "repetitionPenalty": 10.0,
  "maxMelTokens": 1500
}
```

Requests are serialized per session; the helper must echo `id` on the matching response. Defaults
when a field is absent or out of range: `emotionAlpha` 1, `durationFactor` 1, `numBeams` 3,
`doSample` true, `temperature` 0.8, `topK` 30, `topP` 0.8, `repetitionPenalty` 10,
`maxMelTokens` 1500. `voiceRef` is re-resolved by the application on every request, so the helper
must re-encode the reference when it changes (a speaker cache is fine, a stale one is not).

### Response frames (stdout)

One JSON object per line (LF, CRLF tolerated). `result` and `error` are followed by a raw payload of
`size` bytes:

| Frame                                                                     | Payload                                  |
| ------------------------------------------------------------------------- | ---------------------------------------- |
| `{"type":"ready","version":1}`                                            | none — required once after model load    |
| `{"type":"result","requestId":"…","sampleRate":22050,"size":<wav bytes>}` | mono PCM16 WAV                           |
| `{"type":"error","requestId":"…","size":<message bytes>}`                 | UTF-8 message (size 0 ⇒ generic failure) |

Limits enforced by the decoder: header ≤ 4096 B, result payload 44 B – 100 MiB, error payload
≤ 4096 B, `sampleRate` 8000–192 000, `requestId` matching `^[a-zA-Z0-9_-]{1,64}$`. Only
`version: 1` is accepted. Diagnostics belong on stderr; the application keeps the tail for error
messages.

### Lifecycle

| Concern    | Behaviour                                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup    | 180 s to `ready`, then the session is reused                                                                                                 |
| Synthesis  | 600 s per request                                                                                                                            |
| Abort      | process killed, caller receives `DOMException('Speech synthesis was aborted','AbortError')`                                                  |
| Shutdown   | `dispose()` on `will-quit`; a new process is started on demand afterwards                                                                    |
| Failures   | a session that exits or violates the protocol is rejected, dropped, and respawned                                                            |
| Validation | non-WAV output, empty or >64 KiB text, engine mismatch, unknown model/voice, missing asset — all rejected before spawn with Chinese messages |

### Contract test double

`native/index-tts/stub/helper-stub.cpp` implements the protocol without loading a model, so the synthesizer
can be exercised against a real child process (spawn, framing, WAV payload, shutdown). It is gated behind an
environment variable and therefore skipped in normal runs:

```bash
g++ -O2 -std=c++17 -o ls101-index-tts-helper-cuda native/index-tts/stub/helper-stub.cpp
LS101_INDEX_TTS_STUB=$PWD/ls101-index-tts-helper-cuda yarn vitest run \
  packages/airouter/src/__tests__/index-tts-contract.test.ts
```

## Model package contract

Packages follow `ls101.tts-model-package` (format version 1) like the other local engines. IndexTTS
packages differ in three ways: the model artifact is a single `f16` file, every voice is a **reference audio
clip** rather than a speaker embedding, and the package also carries the **runtime** (helper executable plus
its CUDA libraries) as declared assets.

```json
{
  "runtime": { "engine": "index-tts", "engineApiVersion": 1, "minimumAppVersion": "…" },
  "assets": [
    {
      "path": "runtime/win32-x64/ls101-index-tts-helper-cuda.exe",
      "kind": "runtime-helper",
      "size": 0,
      "sha256": "…"
    },
    {
      "path": "runtime/win32-x64/cublas64_12.dll",
      "kind": "runtime-library",
      "size": 0,
      "sha256": "…"
    },
    {
      "path": "models/index-tts2_5-f16.gguf",
      "kind": "tts-model",
      "size": 4547355072,
      "sha256": "…"
    },
    { "path": "voices/american-woman.wav", "kind": "voice-reference", "size": 0, "sha256": "…" }
  ],
  "models": [
    {
      "id": "index-tts2.5-f16",
      "languageCodes": ["zh", "en", "ja", "es", "ar"],
      "artifacts": {
        "tts-model": ["models/index-tts2_5-f16.gguf"],
        "runtime-helper": ["runtime/win32-x64/ls101-index-tts-helper-cuda.exe"]
      },
      "parameters": { "synthesis": { "weightType": "f16", "threads": 4 } }
    }
  ],
  "voices": [{ "id": "american-woman", "files": ["voices/american-woman.wav"] }]
}
```

The helper artifact is selected by `<platform>-<arch>` and `<backend>`, resolved through the normal asset
path resolver, and executed only after its digest matches the application's allowlist (see _Runtime
delivery_). A package whose helper is missing, mislabelled or not allowlisted is rejected with a Chinese
error before any process starts.

Reference clips must be clean speech of roughly 5–15 s; upstream truncates them at 15 s. The two shipped
voices live in `native/index-tts/voices/` (`american-man.wav` 9.52 s, `american-woman.wav` 10.88 s, both
mono 24 kHz PCM16). They are **synthetic**, designed with Qwen3-TTS VoiceDesign, so no human speaker
consent is involved; each clip carries a provenance manifest next to it recording the generator revision,
seed, prompt text and SHA-256. `scripts/index-tts/assets.json` pins the same digests for packaging.

## Precision

The shipped package is **fp16** (`IndexTTS2.5-GGUF/index-tts2_5-f16.gguf`, 4 547 355 072 bytes). fp16 is a
weight format only: the equivalent conversion reproduces the reference greedy tokens exactly (73/73 and
83/83) with vocoder mel-SNR 26–29 dB, above the audible gate. The fp32 package is 7.89 GB, does not fit an
8 GB card and buys no audible quality.

| Format        | Package size | Verdict                                                     |
| ------------- | ------------ | ----------------------------------------------------------- |
| fp32 (`orig`) | 7.89 GB      | not shipped — no audible benefit, does not fit 8 GB cards   |
| **fp16**      | **4.55 GB**  | **shipped** — effectively lossless, runs on 8 GB cards      |
| bf16          | ~4.6 GB      | not shipped                                                 |
| q8_0          | 3.50 GB      | not shipped                                                 |
| int8 / int4   | —            | rejected everywhere: argmax flips and vocoder SNR collapses |

CPU synthesis is **not supported**. The helper keeps `--backend cpu` for development, the provider defaults
to CUDA, and the UI labels CPU as debug-only. The GPU probe decides whether a machine can run the engine at
all: compute capability ≥ 7.5 and a driver of R570+ for the CUDA 12.8 baseline.

## Runtime delivery

The runtime ships **inside the model package**, not in the application installer. A package carries the
weights, the reference voices and the helper plus its CUDA libraries as declared assets; the application
ships only the expected digests.

The application must therefore keep an **allowlist of accepted helper digests** and refuse any package whose
runtime asset is not on it. Verifying the package's self-declared hash is not a security boundary — a
hand-crafted package can declare whatever it likes — so the digest that matters is the one compiled into the
app. Consequences:

- Windows does **not** require an Authenticode signature on the helper; the app-hardcoded SHA-256 is the only
  gate. The allowlist stays fail-closed: an empty list, an unknown platform key or a mismatched digest all
  refuse to spawn.
- Updating the runtime requires an application release, not just a package swap.
- One package per platform (`win32-x64`, `linux-x64`); the helper is selected by platform, architecture and
  backend from the model artifacts.
- The package grows to roughly 5.2–5.4 GB (weights + helper + CUDA libraries), still inside the model
  store's 10 GiB per-asset and 20 GiB per-package limits, but it must be distributed as split volumes
  because of the 2 GiB release-asset cap.
- Packages are user-supplied files, so the helper is untrusted input: it is never executed before its digest
  matches the allowlist, and it is executed from the application data directory rather than from a temporary
  or world-writable location.

This deliberately amends the earlier data-only invariant for model packages ("model packages carry only model
data, no executable JS, WASM or native code") for this engine; `features/ai-router.md` and
`TODO-qwen-tts-cuda-runtime.md` carry the original wording and need updating in the same change.

**Why the runtime is self-built.** The prebuilt `audiocpp-static` npm package (MIT, 0.1.0) does expose an
`audiocpp_server` binary per platform, but its unpacked sizes (29 MB win32, 88 MB Linux) match audio.cpp's
**CPU** builds, not the CUDA ones (461 MB / 224 MB), and its arch coverage is unknown. Since this engine is
CUDA-only, the helper is built from audio.cpp sources in CI against CUDA 12.8/12.9 — the same shape as the
existing `qwen-tts` runtime job — and then published inside the model package.

## Licensing

IndexTTS 2.5 weights, and the upstream repository's own code, are covered by the **bilibili Model
Use License Agreement** — not an OSI licence. Converted or quantised checkpoints are Derivative
Works under §1.5(iii) and inherit every obligation.

- Both language versions are vendored under `thirdparty-licenses/`
  (`LICENSE.bilibili-index-tts.txt`, `LICENSE.bilibili-index-tts.zh.txt`); §9 makes the Chinese text
  prevail, and `DISCLAIMER.bilibili-index-tts.txt` adds voice-consent and usage restrictions.
- §3.4(b) requires keeping the agreement and copyright notices in every distributed copy, and
  §3.4(a) requires passing the terms on to downstream recipients.
- §2.2 requires a separate licence above 100 M monthly active users or RMB 1 B annual revenue.
- §4.1(a) requires a "not endorsed, warranted, or guaranteed by the original right-holder"
  disclaimer when distributing a Derivative Work.

The auxiliary weights the model loads at runtime are permissively licensed (w2v-bert-2.0 MIT,
CAMPPlus Apache-2.0, BigVGAN MIT, Qwen3-0.6B Apache-2.0). One upstream auto-download,
`amphion/MaskGCT`'s semantic codec, is **CC-BY-NC-4.0** and is _not_ used by IndexTTS 2.5; a bundled
runtime must pre-seed the three permissive auxiliary models so that download never happens.

If the Python sidecar route is chosen, the installer notice set grows: `soxr` is LGPL-2.1-or-later
and `opencv-python` wheels bundle FFmpeg (LGPL-2.1) and Qt5 (LGPL-3.0), in addition to PyTorch's
BSD-3-Clause.

## Open items

1. Route decision (native `audio.cpp` helper versus official PyTorch sidecar) — see
   `TODO-index-tts-2-5.md` §3.2.
2. Asset pipeline (`scripts/index-tts/`), CI workflow, and packaging once the route is fixed.
3. GPU capability probe (compute capability, VRAM, driver) to select the runtime bundle and the
   fp32/fp16 package automatically.
4. End-to-end verification on real hardware, including the exam-generation batch flow.
