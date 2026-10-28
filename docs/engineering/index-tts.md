# IndexTTS 2.5 runtime

The application runs [`IndexTeam/IndexTTS-2.5`](https://huggingface.co/IndexTeam/IndexTTS-2.5)
through pinned builds of [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp) (`index_tts2`
model family) — the CPU helper by default and the CUDA helper when the user selects that backend.
IndexTTS 2.5 is a zero-shot voice-cloning TTS engine for zh/en/ja/es/ar;
this application uses it for English exam audio. No Python runtime is involved. Imported model
packages never contain executables.

Published assets use two independent immutable releases in the application repository: the
runtime Release (`index-tts-runtime-v<version>`) contains the native helpers, while the model
Release (`index-tts-model-v<version>`) contains the model split into four parts. Their versions,
filenames, sizes, and SHA-256 digests are pinned in `scripts/index-tts/assets.json`; the release
versions are never hardcoded in the IndexTTS docs or the workflow. Normal `yarn setup` is
offline-capable and verifies those pinned
values without querying GitHub; `yarn index-tts:download --verify-upstream` compares the pinned
metadata with the GitHub Release Assets API and the Hugging Face tree API, caching the reviewed
responses under `externals/ai/index-tts/downloads/`.

The single model GGUF is 3,502,955,328 bytes, above GitHub's 2 GiB asset limit, so the model
Release stores it as four byte-ordered parts: three 1 GiB parts plus a 281,729,856-byte remainder.
The split is deterministic — applying it to the pinned source bytes always yields the four pinned
part hashes — and `download-release-assets.mjs` re-verifies every part hash while merging them back
into the single GGUF. The merged file is stored under `externals/ai/index-tts/models/`, and the
helper is staged under `externals/ai/index-tts/runtime/`.

Runtime release version, model release version, package version, upstream revisions, model
selection, and voice metadata have one source of truth: `scripts/index-tts/assets.json`. Update
that file before publishing assets or changing the locally assembled model package, and never
hardcode a release version in docs, scripts, or workflow comments — refer to this file instead.

## Runtime architecture

- Each supported operating-system target distributes one `cpu` and one `cuda` helper asset.
  `assets.json` pins both helpers, the Windows cuBLAS DLLs, `LICENSE.NVIDIA-CUDA.html`, the
  cJSON/sentencepiece/Abseil/Darts-clone/protobuf-lite/libyaml notices, and the runtime manifest,
  so the default `yarn install` (whose postinstall runs setup) downloads every
  pinned artifact for the current platform — the CUDA helper included — even though installers
  stay CPU-only through the electron-builder packaging filters. TODO: this "pin and download
  everything" policy is deliberate for now and will be revisited by a follow-up plan (for example
  downloading the CUDA artifacts only on demand); it is not a settled contract.
  `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` skips the whole IndexTTS download task so locally built
  development artifacts survive, and `LS101_INDEX_TTS_RUNTIME_ONLY=1` stages the runtime without
  the model (product-docs builds use this). The CPU helper is stored in application resources
  rather than the user's data directory.
- The Provider configuration exposes a `backend` field (`cpu`, the default, or `cuda`). CUDA is
  selected in the settings UI after a probe (`--probe-backend cuda`) reports a usable device, and
  the synthesizer then spawns `ls101-index-tts-helper-cuda` with `--backend cuda`. The session key
  includes the backend, so switching backends restarts the process. Installers still ship CPU-only
  via the packaging filters, and a CUDA request without the staged helper fails with a clear
  message pointing at `yarn install`.
- Unlike Qwen TTS, a voice is not a fixed speaker embedding: every request carries the reference
  WAV (zero-shot cloning), so switching voices neither restarts the helper nor changes the model.
  The session key is `[modelPath, backend, device, threads, lowMemory]`; only a model or load-parameter
  change restarts the process, and the old process must fully exit (including its temporary
  directory) before the replacement spawns.
- The Electron main process communicates with the helper through a bounded binary protocol:
  `READY`, then `SYNTHESIZE <id> <bytes>` + JSON payload, answered by
  `RESULT <id> <sampleRate> <bytes>` + WAV or `ERROR <id> <bytes>` + UTF-8 message. A per-request
  failure (for example an unreadable reference WAV) answers ERROR and keeps the session; protocol
  malformation, engine failure, or a non-zero exit invalidates the session.
- The helper spawns with a private `TMPDIR`/`TEMP`/`TMP` because audio.cpp materializes tokenizer
  data embedded in the GGUF into the system temporary directory; the directory is removed when the
  process exits.
- The upstream runtime is pinned to commit `c7f5743f037d588049c63aa75e9b4fdb279cfe01` with the
  in-tree vendored GGML tree `5191d4c73bdae6762f0b8df17904c144d6525b07`. Builds remove
  `-march=native` so binaries run on CPUs other than the build host.

## Content-addressed GGUF loading

Installed model packages store assets as `blobs/sha256/<hash>` with no file extension, and
`speech-model-store` resolves model paths in that form. Upstream audio.cpp identified GGUF files by
extension in three places (`open_tensor_source`, `prepare_model_directory`, and
`model_spec::is_gguf_file`), so an extensionless blob fell through to the safetensors source and
failed on a missing sidecar file. `native/index-tts/content-addressed-gguf.patch` (applied by
`build-runtime.mjs` after the revision check) replaces those three checks with a magic-number
check: an existing regular file whose first four bytes are `GGUF`. Valid `*.gguf` files always
pass, so extension-based behaviour is unchanged; extensionless content-addressed blobs become
loadable. The end-to-end smoke must verify both a `.gguf` path and an extensionless path.

## 1. Build the native helper

Install CMake 3.20+, a C++17 compiler, Git, and Ninja. Build the portable CPU helper with:

```bash
yarn index-tts:build-runtime --backend cpu
```

For native runtime development only, a CUDA helper can be built on a machine with the CUDA 12.8
toolkit (set `INDEX_TTS_CUDA_REDIST_DIR` to the toolkit's runtime library directory — `bin` on
Windows, `lib64` on Linux; on Windows run the build from a Visual Studio developer prompt so
`dumpbin` is available):

```bash
yarn index-tts:build-runtime --backend cuda
```

The script clones the pinned audio.cpp revision (never `git submodule update`: the only real
submodule registers an SSH URL this build does not need), verifies the vendored GGML tree hash,
applies `content-addressed-gguf.patch` idempotently, configures CMake with the model composite
locked to `index_tts2` and static/portable flags, and stages the result plus licenses and
`build-<backend>.json` metadata under `externals/ai/index-tts/runtime/<platform>-<arch>/`. CPU
builds on Linux must show no dynamic dependencies beyond libc/libstdc++/libm/libgcc. Both backends
are smoke-tested by running the helper with no arguments: it must exit 1 with
`An absolute --model path is required` on stderr before any engine initialization, which is what
lets GPU-less CI runners validate the CUDA build too.

CUDA compilation uses `CMAKE_CUDA_ARCHITECTURES=75;86-real;89-real;120a-real` (five device images
per CUDA source instead of GGML's nine) and goes through sccache for C, C++, and CUDA alike
(mirroring qwen), which requires sccache >= 0.18.0: the two engine `.cu` files carry
`-DYAML_VERSION_STRING=\"...\"` from the vendored libyaml defines, and 0.17.0 fails them with
"Could not parse shell line" (sccache#2811). qwen is unaffected because its `.cu` set is pure
ggml kernels with no escaped defines. The workflow also raises `SCCACHE_MAX_FRAME_LENGTH`
(mmvf.cu diagnostics exceed the 8 MiB default) and disables the idle timeout.

The CUDA dependency closure is **discovered from the built helper, not hardcoded**: Linux runs
`ldd` (with `LD_LIBRARY_PATH` pointed at `INDEX_TTS_CUDA_REDIST_DIR`) and Windows walks
`dumpbin /DEPENDENTS` transitively (cublasLt enters through cublas64_12.dll). Discovery matters
because the linker dead-strips unreferenced objects: the index_tts2 composite uses the Vocos
vocoder with the host iSTFT, and the cuFFT-based CUDA iSTFT belongs to model families
(fsq/miocodec/neutts) this build does not link — so `istft_cuda_runtime.o` is compiled but never
pulled in, and cuFFT never enters the closure. The verified closure is `cublas64_12.dll` +
`cublasLt64_12.dll` on Windows (cuBLAS has no static MSVC build; cuDART is statically linked by
`CUDA_RUNTIME_LIBRARY=Static`) and **empty on Linux** (GGML_STATIC=ON static-links
cuBLAS/cuBLASLt/cuDART). Discovered files are staged beside the helper with per-family floors
(cuDART keeps a 100 KB floor — it is a thin loader; the others keep qwen's 1 MiB floor), the
staged runtime must re-resolve under `ldd` with no "not found", and `LICENSE.NVIDIA-CUDA.html`
is staged alongside. If a future audio.cpp pin makes something dynamic, discovery picks it up
automatically and the manifest job fails loudly until the release file list is updated. The
discovered DLLs are pinned in `assets.json` and downloaded by setup on Windows; the packaging
filters keep them out of application packages.

Helpers are written per operating system; do not copy a binary between platforms. CUDA compilation
does not require a GPU, but a development build must be exercised on a machine with a compatible
NVIDIA driver.

## 2. Model and voices

The model is `audio-cpp/audio.cpp-gguf` revision `9c78726d0d2cf7ee8511e68ef003490c1251062f`, path
`IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf`, pinned by size and SHA-256 in `assets.json`. While
`modelRelease.published` is `false`, setup bootstraps by downloading that file directly from
Hugging Face with resume support; once the split parts are published, setup downloads the four
parts, verifies each hash, and merges them.

Voices are reference WAV files. The two bundled voices (`american-man`, `american-woman`) were
generated by the Qwen VoiceDesign model during development and are committed with their provenance
JSON under `native/qwen-tts/voice-design/`; Apache-2.0 covers the generated audio. Any 8–192 kHz
mono-or-multi-channel PCM WAV between 44 bytes and 32 MiB can serve as a voice: the helper mixes
channels down to mono and the engine conditions on it per request.

## 3. Build and import the model package

```bash
yarn index-tts:prepare
```

The model is staged beforehand by `yarn setup` (or `yarn index-tts:download`); `prepare` then
verifies the local GGUF bytes against the `model` block of `scripts/index-tts/assets.json` (size
and SHA-256) and writes `dist/index-tts-2.5-q8_0-<version>.zip`, with the version taken from
`package.version` in the same file. The package contains `manifest.json`, the GGUF (`tts-model`),
the reference WAVs (`speaker-reference`), and the license texts `LICENSE.IndexTTS.txt`,
`DISCLAIMER.IndexTTS.txt`, and `LICENSE.audio-cpp.txt`. The builder hashes every asset while
streaming it into the archive, and the pre-packaging pin check means a truncated or tampered GGUF
is rejected — with no partial ZIP left behind (`prepare` writes a `.part` file and renames it only
on success) — before the manifest could legitimize bytes that differ from the pinned model. The
archive is a classic ZIP written through fflate's streaming writer: it does not support ZIP64, so
the builder refuses to assemble a package whose inputs exceed the format's ~4 GiB limit. The
package deliberately never includes a helper executable; `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` skips
the local package preparation as well. Import the ZIP in AI Router, create a local `IndexTTS 2.5`
provider, and run its CPU connection test. Runtime parameters shown in the settings page (threads,
language, maxTokens, seed) come from the package manifest; use `yarn index-tts:build-package
--voice id=path` to assemble a package with different voices or parameters.

The runtime, raw model, and assembled package versions are independent. Reuse the existing model
Release when only the helper or Git-managed voices change; increment `package.version` whenever
the model, voice list, or manifest changes.

## 4. Asset workflow and bootstrap

The IndexTTS Assets workflow accepts `runtime`, `model`, or `both`. The `build` job builds four
legs (linux-x64 and win32-x64, each cpu and cuda); the `model` job downloads the pinned GGUF from
Hugging Face, verifies it, splits it into the four pinned parts, and re-verifies every part hash.
`release-runtime` asserts all four build-info files agree on the upstream revisions, that exactly
four helpers are present, and that the Windows CUDA closure covers the cuBLAS/cuBLASLt families
(cuDART keeps its 100 KB floor if it ever appears; Linux must stage no shared CUDA libraries at
all), then publishes the manifest, helpers, CUDA libraries, and licenses. `release-model`
publishes the four parts, licenses, and manifest. Both jobs refuse to overwrite an existing tag:
if a `both` run publishes one Release and then fails before the other, re-run only the failed jobs
(GitHub skips succeeded jobs) or dispatch the missing target alone — a fresh `both` dispatch fails
fast on the already-published tag's precondition check.

**Bootstrap order (hard requirement):** `ci.yml` runs `yarn install --immutable`, whose postinstall
executes `scripts/setup.js`; on a fresh runner setup fails while `runtimeRelease.published` is
`false`, because the runtime Release does not exist yet and no helper can be downloaded. The
correct sequence is:

1. From the feature branch, run this workflow with `workflow_dispatch` for each unpublished
   Release. Use target `runtime` when only the runtime is unpublished; target `both` is reserved
   for the initial bootstrap where neither Release exists and would otherwise fail an existing-tag
   precheck after needlessly rebuilding published assets. The first cuda leg may take hours; rerun
   it once to warm sccache if it times out.
2. After publishing, backfill `scripts/index-tts/assets.json` from the actual Release assets. Set
   the `published` flag for each newly published Release, and pin every runtime asset setup
   downloads (name/size/SHA-256). The repository-backed third-party notices are already pinned;
   refresh both helpers for each platform, the Windows cuBLAS DLLs, `LICENSE.NVIDIA-CUDA.html`, and
   `index-tts-runtime-manifest.json`. The model part entries are already pinned.
3. Commit the backfill. From that point full CI and `yarn test:smoke` are expected to pass. Do not
   relax a pin or hash check to make setup green before the releases exist.

Current state: both Releases are published and every managed runtime asset is pinned from the
actual Release bytes. For a later runtime change, increment `runtimeRelease.version` and its tag,
set `published` to `false`, and keep only repository-backed license pins until the replacement
Release exists. Then run target `runtime`, backfill the remaining assets from that Release, and
re-enable setup. Locally staged license copies survive `exact` cleanup through the pattern-based
preserve allowlist in `download-release-assets.mjs`.

Until the runtime Release exists, only machines that ran `yarn index-tts:build-runtime` locally can
pass setup; the local helper is validated against its `build-cpu.json` metadata (including the
application runtime version and upstream revisions) and its hash is logged so it can be pinned.

## 5. Licensing

- **audio.cpp** is Apache-2.0 (`LICENSE.audio-cpp.txt`); GGML is MIT (`LICENSE.ggml.txt`). Both
  ship in `thirdparty-licenses/` and in the Releases.
- **Statically linked helper dependencies** — cJSON (MIT), sentencepiece (Apache-2.0), its bundled
  Abseil (Apache-2.0), Darts-clone (BSD-3-Clause) and protobuf-lite (BSD-3-Clause) components, and
  libyaml (MIT) — carry their notices in `native/index-tts/licenses/`. The additional SentencePiece
  dependency notices are `LICENSE.absl.txt`, `LICENSE.darts-clone.txt`, and
  `LICENSE.protobuf-lite.txt`; copies also ship in `thirdparty-licenses/`. Local builds stage all
  notices, the release workflow uploads them, and setup downloads them with the runtime assets.
- **IndexTTS 2.5 model weights** are distributed under the bilibili Model Use License
  (`LICENSE.IndexTTS.txt` with `DISCLAIMER.IndexTTS.txt`). Commercial use requires a separate
  licence when the licensor's annual revenue exceeds 1 billion RMB or monthly active users exceed
  100 million, and model outputs must not be used to improve other commercial AI models. The
  package builder includes the license and disclaimer texts in every generated model package, and
  they must be preserved when distributing a package outside the application.
- **Reference voices** are Qwen VoiceDesign output (Apache-2.0) with provenance recorded beside
  each WAV.
- **CUDA runtime DLLs** (the discovered closure — currently `cublas64_12.dll` and
  `cublasLt64_12.dll` on Windows) are redistributed under the NVIDIA CUDA Toolkit 12.8 EULA
  (`LICENSE.NVIDIA-CUDA.html`); they are published with the runtime Release, pinned in
  `assets.json`, and downloaded by setup, but never enter application packages.
