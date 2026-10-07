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

The route is decided: a native `audio.cpp` helper built from `native/index-tts/`, an fp16 model
package, CUDA only. Application wiring, the helper source and the asset pipeline (`scripts/index-tts/`)
are implemented and covered by tests, and the CI workflow (`.github/workflows/index-tts.yml`) exists
but has not run yet; the real CUDA build and the end-to-end synthesis run still need a GPU machine (see
[`TODO-index-tts-2-5.md`](../../TODO-index-tts-2-5.md)). The shipped allowlist
(`INDEX_TTS_HELPER_SHA256`) is still empty: a package imports, but every synthesis attempt is refused
until the CI digest run is committed (see _Runtime delivery_).

Implemented:

- `index-tts` is a member of `AIRouterSpeechProviderType`, accepted by provider-config validation,
  by the stored-config type guard, and by the model-package runtime engine allowlist.
- `IndexTtsSynthesizer` (`packages/airouter/src/main/index-tts.ts`) implements
  `AIRouterLocalSpeechSynthesizer`, with `IndexTtsProtocolDecoder`
  (`index-tts-protocol.ts`) decoding helper output; it resolves, digest-checks and stages the
  packaged runtime before spawning it.
- The provider is registered in `localSynthesizers` and disposed on `will-quit`.
- The Provider editor exposes a compute-backend selector (`CPU` / `NVIDIA GPU (CUDA)`); the stored
  backend is honoured for `index-tts` only. `qwen-tts` remains CPU-only.
- `native/index-tts/main.cpp` and `CMakeLists.txt` implement the helper on audio.cpp's C ABI
  (`AUDIOCPP_BUILD_C_API=ON`); `scripts/index-tts/build-runtime.mjs` builds it against a pinned
  audio.cpp checkout and stages it under `externals/ai/index-tts/runtime/<platform>-<arch>/`.
- `scripts/index-tts/` builds the ZIP64 model package (weights + runtime + voices + licences),
  splits it into <2 GiB volumes, and reports and gates the runtime digests; the workflow runs it in
  `digest` and `package` modes and adds a `contract` job that compiles the real helper with its stub
  engine and runs the protocol contract test.

## Helper contract

Everything the runtime executable needs to implement is below; `native/index-tts/main.cpp` is the
only implementation. The synthesizer has no hard-coded install path: it resolves the executable from
the model package on every staging pass, so a future sidecar only has to provide the same assets and
protocol.

### Executable resolution

`IndexTtsSynthesizer` resolves what it spawns from one of two sources:

| Source        | What is spawned                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| Override      | `helperPaths[backend]` from the `IndexTtsSynthesizerOptions` constructor — tests and local experiments        |
| Model package | the staged copy of the packaged helper: `<runtimeRoot>/<platformKey>/<packageId>-<packageVersion>/<basename>` |

The override is returned immediately and bypasses package resolution, staging and the allowlist.
Without it the synthesizer:

1. calls `selectRuntimeAssets(manifest, modelId, backend, '<platform>-<arch>')`, which reads
   `models[].artifacts['runtime-helper']` — an entry naming both the platform and the backend wins,
   a backend-only entry is the fallback, and anything missing or ambiguous returns `null` so the
   caller fails closed — and collects the libraries the helper loads from its own directory (see
   _Runtime delivery_);
2. checks every asset digest against `INDEX_TTS_HELPER_SHA256` for the platform key;
3. resolves each asset path through the model store (`request.resolveAssetPath`) and requires a
   regular file;
4. copies the files into the staging directory, re-hashes each copy, applies the POSIX modes, and
   spawns the staged helper.

Every failure is raised before `spawn`: a package without a matching runtime prints
`IndexTTS 模型包未提供 <platform>-<arch> 的 <CUDA|CPU> 运行时`; a digest missing from the allowlist
prints `IndexTTS 运行时未通过白名单校验（<platform>-<arch>）：<assetPath>`; a bad copy prints
`IndexTTS 运行时文件校验失败：<assetPath>`; and a missing blob prints
`缺少 IndexTTS 原生运行时：<path>；请先执行 yarn index-tts:build-runtime`. The application passes
`<application data>/models/tts/runtime` as `runtimeRoot`; the constructor default (used by tests) is
`os.tmpdir()/ls101-index-tts-runtime`.

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

### Fatal versus recoverable failures

The dividing line is whether the stdin stream boundary is still trustworthy.

- **Framing violations are fatal.** A header that fails `parse_request_header` (missing or unknown
  `op`, missing or invalid `id`, non-integer, negative or above-64-KiB `textBytes`) prints
  `IndexTTS 请求协议错误：…` to stderr and exits 2 without an error frame. A short payload
  (`gcount() != textBytes`) prints `IndexTTS 请求负载不完整（id=…）` and also exits 2, as does a
  header that exceeds the 64 KiB cap. A mis-parsed header or a short payload desynchronises stdin,
  so continuing would read the next request's bytes as this request's payload.
- **Request-level failures are recoverable.** Once the header parsed and the payload was consumed
  exactly, a failing request (engine error, invalid engine geometry, oversized output, an exception)
  produces an `error` frame and the same process keeps serving the next request. The helper exits 2
  only if even that error frame cannot be written, because stdout framing is broken then.

The application sees the difference through the process exit: when the helper exits non-zero
mid-request, `index-tts.ts` rejects the in-flight request with
`IndexTTS helper 退出（code=<n>, signal=<n|none>）：<last 16 KiB of stderr>`, wrapped in the usual
`IndexTTS 合成失败（…）：` prefix. The session is dropped from the pool, so the next request resolves
and stages the runtime again and starts a fresh helper; the helper's stderr diagnostics are what the
user sees in the error message.

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
packages differ in four ways: the model artifact is a single `f16` file, every voice is a **reference
audio clip** rather than a speaker embedding, the package also carries the **runtime** (helper
executable plus its CUDA libraries) as declared assets, and the bilibili licence set travels inside it
as `license` assets. The runtime-specific fields, with `package` and `extensions` omitted:

```json
{
  "runtime": { "engine": "index-tts", "engineApiVersion": 1, "minimumAppVersion": "0.4.2" },
  "assets": [
    {
      "path": "runtime/win32-x64/ls101-index-tts-helper-cuda.exe",
      "kind": "runtime-helper",
      "size": 12582912,
      "sha256": "…"
    },
    {
      "path": "runtime/win32-x64/cublas64_12.dll",
      "kind": "runtime-library",
      "size": 157286400,
      "sha256": "…"
    },
    {
      "path": "models/index-tts2_5-f16.gguf",
      "kind": "tts-model",
      "size": 4547355072,
      "sha256": "87bed9b82fc8f22119a1a1042332091016c28e37f29b0e93343ccdbfa76ef66a"
    },
    {
      "path": "voices/american-woman.wav",
      "kind": "voice-reference",
      "size": 522284,
      "sha256": "d84992242a33494813263e795d1bc401335b79dda96de6c829c3743bc15847ac"
    },
    {
      "path": "licenses/LICENSE.bilibili-index-tts.txt",
      "kind": "license",
      "size": 10554,
      "sha256": "53875532237e0a97b17a41721556ff57e93193fc566e48c3a0febe6e35bb5343"
    },
    {
      "path": "licenses/LICENSE.bilibili-index-tts.zh.txt",
      "kind": "license",
      "size": 7336,
      "sha256": "366175ecf329274358801b8365922677c52f25e643dcf00f0bc15857b5b2777f"
    },
    {
      "path": "licenses/DISCLAIMER.bilibili-index-tts.txt",
      "kind": "license",
      "size": 2212,
      "sha256": "3ba7e9e94f823f4bd3a2446c55a7bd1fa71769c4ca733153cc89130f43493b49"
    }
  ],
  "models": [
    {
      "id": "index-tts2.5-f16",
      "name": "IndexTTS 2.5 fp16",
      "languageCodes": ["zh", "en", "ja", "es", "ar"],
      "artifacts": {
        "tts-model": ["models/index-tts2_5-f16.gguf"],
        "runtime-helper": ["runtime/win32-x64/ls101-index-tts-helper-cuda.exe"]
      },
      "parameters": {
        "synthesis": {
          "weightType": "f16",
          "language": "auto",
          "threads": 4,
          "numBeams": 3,
          "doSample": true,
          "temperature": 0.8,
          "topK": 30,
          "topP": 0.8,
          "repetitionPenalty": 10.0,
          "maxMelTokens": 1500,
          "durationFactor": 1.0,
          "emotionAlpha": 1.0
        }
      }
    }
  ],
  "voices": [
    {
      "id": "american-woman",
      "name": "American English Woman",
      "files": ["voices/american-woman.wav"]
    }
  ]
}
```

`size` must be the exact uncompressed byte count of the ZIP entry and `sha256` the 64-character hex
digest of those bytes: the importer checks both and rejects a mismatch
(`模型包资产大小不匹配` / `模型包资产哈希不匹配`), which is why a `"size": 0` entry can never be
imported. The values above are the real pins for the model, voice and licence files
(`scripts/index-tts/assets.json` and `thirdparty-licenses/`); the runtime entries are illustrative —
`build-package.mjs` hashes the built binaries, and `…` stands for the digest the CI digest run
reports.

The runtime assets are selected by `<platform>-<arch>` and `<backend>`, but **all** of them — helper
and libraries — must be on the application allowlist, and the helper is executed only from its staged
copy (see _Runtime delivery_). A package whose runtime is missing, mislabelled or not allowlisted is
rejected with a Chinese error before any process starts.

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
weights, the reference voices, the licences and the helper plus its CUDA libraries as declared assets;
the application ships only the expected digests.

### Allowlist

`INDEX_TTS_HELPER_SHA256` (`packages/airouter/src/main/index-tts-runtime.ts`) is keyed by
`<platform>-<arch>` and lists **every runtime asset digest for that platform**: the helper executable
(`runtime-helper`) and every shared library / CUDA DLL the helper loads from its own directory
(`runtime-library`). The name is kept only because `scripts/index-tts/verify-allowlist.mjs` parses the
identifier. The digest declared by the package is not a security boundary — a hand-crafted package can
declare any hash it likes — so only digests compiled into the application are copied and executed. The
check fails closed: an empty or missing list for the platform key, an empty digest, or a digest
matching no entry all refuse to stage and spawn. Because the libraries are covered too, a package
cannot pair a byte-identical allowlisted helper with a trojanised `libaudiocpp`/CUDA library.

The lists are filled in when the runtime release for a platform is cut; `INDEX_TTS_HELPER_SHA256` is
currently empty, so no packaged runtime is accepted yet, and updating the runtime requires an
application release rather than a package swap.

`scripts/index-tts/verify-allowlist.mjs` is the release-time gate. It hashes **every file** in the
staged runtime directory (`externals/ai/index-tts/runtime/<platform>/`, exactly the set
`build-package.mjs` ships) and fails unless each digest is on the app allowlist. `--report` prints a
table with sizes and digests plus a paste-ready `INDEX_TTS_HELPER_SHA256` block and does not fail on
unlisted digests; the strict run (no `--report`) exits non-zero and lists the files that are missing.
CI appends the `--report` output to the step summary and runs the strict gate before packaging.

### Staging and spawn

Every runtime asset travels inside the model package, and imported blobs are written with mode `0600`,
so the helper could never be executed from the blob store even if its digest matched. Before spawning,
the synthesizer:

1. resolves the helper from `models[].artifacts['runtime-helper']` and the libraries from the
   `runtime-library` assets (plus any `artifacts['runtime-library']` entry); a library declared next to
   the selected helper is always kept, because the helper loads it from its own directory (CMake RPATH
   `$ORIGIN`), while one naming another platform or an explicit different backend is skipped;
2. checks every asset digest against `INDEX_TTS_HELPER_SHA256[<platform>-<arch>]`;
3. resolves each asset to its blob and requires a regular file, rejecting duplicate basenames;
4. copies the files into `<runtimeRoot>/<platformKey>/<packageId>-<packageVersion>/`
   (`<runtimeRoot>` is `<application data>/models/tts/runtime`; path segments are sanitised) and
   **re-hashes every copied file** against the digest the allowlist accepted;
5. sets `0755` on the helper and on `*.so`/`*.so.<n>` libraries and `0644` on the other files, on POSIX
   (Windows needs no mode change);
6. spawns the staged path, never the blob path.

The staging directory is reused while every staged file exists, hashes to its declared digest and (on
POSIX) keeps its expected mode; otherwise the files are copied into a temporary sibling and swapped in
with a single rename, so no reader observes a half-copied runtime. Requests racing for the same
directory are serialised.

Consequences:

- Windows does **not** require an Authenticode signature on the helper; the app-hardcoded SHA-256 is the only
  gate, for the helper and for every library.
- One package per platform (`win32-x64`, `linux-x64`); the helper is selected by platform, architecture and
  backend from the model artifacts.
- The package grows to roughly 5.2–5.4 GB (weights + helper + CUDA libraries), still inside the model
  store's 10 GiB per-asset and 20 GiB per-package limits, but it must be distributed as split volumes
  because of the 2 GiB release-asset cap.
- Packages are user-supplied files, so the runtime is untrusted input: nothing is executed before every
  digest matches the allowlist, and the executable bit is applied only to the verified copy staged in the
  application data directory rather than to a temporary or world-writable location.

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
- The model package carries all three files inside the ZIP (`licenses/…`, asset kind `license`), and
  `scripts/index-tts/build-package.mjs` also copies them next to the volumes as `<prefix>-licenses/`
  so the release job attaches them as standalone assets. Downloaders therefore receive the agreement
  and disclaimer without unpacking a 5 GB archive.
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

1. Build the real CUDA helper (`.github/workflows/index-tts.yml`, `mode=digest`), commit the reported
   digests into `INDEX_TTS_HELPER_SHA256`, then produce and publish the split volumes (`mode=package`).
2. End-to-end verification on real hardware: import the package, synthesize the 22 050 Hz WAV, and run
   the exam-generation batch flow.
3. A first real CI run, a packaged smoke run (install → import → first synthesis), and importing the
   actual >4 GiB archive are still unexercised; the ZIP64 path is covered by unit tests only.
