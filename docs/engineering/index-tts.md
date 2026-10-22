# IndexTTS 2.5 runtime

The application runs [`IndexTeam/IndexTTS-2.5`](https://huggingface.co/IndexTeam/IndexTTS-2.5)
through the pinned CPU build of [`0xShug0/audio.cpp`](https://github.com/0xShug0/audio.cpp)
(`index_tts2` model family). IndexTTS 2.5 is a zero-shot voice-cloning TTS engine for zh/en/ja/es/ar;
this application uses it for English exam audio. No Python runtime is involved. Imported model
packages never contain executables.

Published assets use two independent immutable releases in the application repository:
`index-tts-runtime-v0.1.0` contains the native helpers, while `index-tts-model-v1.0.0` contains the
model split into four parts. Their filenames, sizes, and SHA-256 digests are pinned in
`scripts/index-tts/assets.json`. Normal `yarn setup` is offline-capable and verifies those pinned
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
that file before publishing assets or changing the locally assembled model package.

## Runtime architecture

- Each supported operating-system target distributes one `cpu` helper asset. The workflow also
  builds and publishes `cuda` helpers and their CUDA runtime libraries for native runtime
  development, but `assets.json` pins only the CPU helper and the runtime manifest, so setup never
  downloads CUDA artifacts and packaging excludes them. `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` skips
  both downloads and the CUDA cleanup so locally built development artifacts survive. The CPU
  helper is stored in application resources rather than the user's data directory.
- Application execution always passes `--backend cpu`. The Provider configuration exposes no
  backend field; the synthesizer resolves only `ls101-index-tts-helper-cpu` and never spawns the
  CUDA helper.
- Unlike Qwen TTS, a voice is not a fixed speaker embedding: every request carries the reference
  WAV (zero-shot cloning), so switching voices neither restarts the helper nor changes the model.
  The session key is `[modelPath, device, threads, lowMemory]`; only a model or load-parameter
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
automatically and the manifest job fails loudly until the release file list is updated. These
artifacts are not selected by setup or included in application packages.

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

This downloads/verifies the model and writes `dist/index-tts-2.5-q8_0-<version>.zip` containing
`manifest.json`, the GGUF (`tts-model`), and the reference WAVs (`speaker-reference`). The ZIP
builder streams multi-gigabyte files, verifies each asset's SHA-256, and deliberately never
includes a helper executable. Import the ZIP in AI Router, create a local `IndexTTS 2.5` provider,
and run its CPU connection test. Runtime parameters shown in the settings page (threads, language,
maxTokens, seed) come from the package manifest; use `yarn index-tts:build-package --voice id=path`
to assemble a package with different voices or parameters.

The runtime, raw model, and assembled package versions are independent. Reuse the existing model
Release when only the helper or Git-managed voices change; increment `package.version` whenever
the model, voice list, or manifest changes.

## 4. Asset workflow and bootstrap

The IndexTTS Assets workflow accepts `runtime`, `model`, or `both`. The `build` job builds four
legs (linux-x64 and win32-x64, each cpu and cuda); the `model` job downloads the pinned GGUF from
Hugging Face, verifies it, splits it into the four pinned parts, and re-verifies every part hash.
`release-runtime` asserts all four build-info files agree on the upstream revisions, that exactly
four helpers are present, that the CUDA dependency closure covers all five families with a 1 MiB
size floor, then publishes the manifest, helpers, CUDA libraries, and licenses. `release-model`
publishes the four parts, licenses, and manifest. Both jobs refuse to overwrite an existing tag.

**Bootstrap order (hard requirement):** `ci.yml` runs `yarn install --immutable`, whose postinstall
executes `scripts/setup.js`; on a fresh runner setup fails while `runtimeRelease.published` is
`false`, because the runtime Release does not exist yet and no helper can be downloaded. The
correct sequence is:

1. From the feature branch, run this workflow with `workflow_dispatch` (target `both`). The first
   cuda leg may take hours; rerun it once to warm sccache if it times out.
2. Publish creates `index-tts-runtime-v0.1.0` and `index-tts-model-v1.0.0`. Backfill
   `scripts/index-tts/assets.json`: set both `published` flags to `true`, and pin the CPU helper
   and `index-tts-runtime-manifest.json` entries (name/size/SHA-256) under `runtimeRelease.assets`.
   CUDA assets stay unpinned — they ship for native development only. The model part entries are
   already pinned.
3. Commit the backfill. From that point full CI and `yarn test:smoke` are expected to pass. Do not
   relax a pin or hash check to make setup green before the releases exist.

Until the runtime Release exists, only machines that ran `yarn index-tts:build-runtime` locally can
pass setup; the local helper is validated against its `build-cpu.json` metadata and its hash is
logged so it can be pinned.

## 5. Licensing

- **audio.cpp** is Apache-2.0 (`LICENSE.audio-cpp.txt`); GGML is MIT (`LICENSE.ggml.txt`). Both
  ship in `thirdparty-licenses/` and in the Releases.
- **IndexTTS 2.5 model weights** are distributed under the bilibili Model Use License
  (`LICENSE.IndexTTS.txt` with `DISCLAIMER.IndexTTS.txt`). Commercial use requires a separate
  licence when the licensor's annual revenue exceeds 1 billion RMB or monthly active users exceed
  100 million, and model outputs must not be used to improve other commercial AI models. Preserve
  the license and disclaimer when distributing a generated model package outside the application.
- **Reference voices** are Qwen VoiceDesign output (Apache-2.0) with provenance recorded beside
  each WAV.
- **CUDA runtime DLLs** (cublas, cublasLt, cudart, cufft, nvJitLink) are redistributed under the
  NVIDIA CUDA Toolkit 12.8 EULA (`LICENSE.NVIDIA-CUDA.html`); they are published with the runtime
  Release for development builds only and never enter application packages.
