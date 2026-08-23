# Qwen3-TTS 0.6B Base runtime

The application runs `Qwen3-TTS-12Hz-0.6B-Base` through the pinned CPU build of
[`predict-woo/qwen3-tts.cpp`](https://github.com/predict-woo/qwen3-tts.cpp). Python is used only to
create VoiceDesign reference audio during development. Imported model packages never contain
executables. CUDA support is currently disabled in application setup, configuration, synthesis,
and packaging.

Published assets use two independent immutable releases in the application repository:
`qwen-tts-runtime-v0.3.1` contains the native helpers, while `qwen-tts-model-v1.0.0` contains the
two GGUF files. Their selected filenames, sizes, and SHA-256 digests are pinned in
`scripts/qwen-tts/assets.json`. Normal `yarn setup` is offline-capable and verifies those pinned
values without querying GitHub. `yarn setup --verify-upstream` compares the pinned metadata with
both GitHub Release Assets APIs and caches the reviewed responses as `runtime-release-api.json`
and `model-release-api.json` under `externals/ai/qwen3-tts/downloads/`.

Downloaded GGUF files are stored directly under `externals/ai/qwen3-tts/models/`, and the helper is
staged under `externals/ai/qwen3-tts/runtime/`. A full application build then prepares the local
model ZIP under `dist/`, while `yarn qwen-tts:prepare` can build it explicitly. Test builds run the
same complete setup as other application builds; `--skip-model-package` skips only the separately
distributed package outputs, not asset setup. `GITHUB_TOKEN` or `GH_TOKEN` is only needed to avoid
anonymous API limits during explicit upstream verification.

Runtime release version, model release version, package version, upstream revisions, model
selection, VoiceDesign model, and fixed-voice metadata have one source of truth:
`scripts/qwen-tts/assets.json`. Update that file before publishing assets or changing the locally
assembled model package.

## Runtime architecture

- Each supported operating-system target distributes one `cpu` helper asset. Setup removes staged
  CUDA helpers and CUDA runtime DLLs when downloads are enabled, and packaging excludes them.
  `LS101_SKIP_QWEN_TTS_DOWNLOAD=1` skips both downloads and cleanup so local development artifacts
  are left untouched. The CPU helper is stored in application resources rather than the user's data
  directory.
- A helper loads the Base talker, speech tokenizer/vocoder, and one 1024-float speaker embedding,
  then remains alive for serialized synthesis requests. Application execution always passes
  `--backend cpu`.
- Qwen TTS Provider configuration is normalized to `cpu` in the Electron main process. This applies
  to API writes, transient connection tests, and previously stored `cuda` values. The synthesizer
  also forces CPU before resolving a helper as a final boundary check.
- The Electron main process communicates with the selected helper through a bounded binary
  protocol. CUDA probing remains available only for native runtime development and is not part of
  the application configuration or synthesis flow.
- The model Release contains two raw GGUF assets. A local model ZIP combines those models with one
  or more Git-managed `.spk` files. The Electron main process resolves content-addressed installed
  assets and passes every model and speaker file to the helper by its absolute path.
- The upstream runtime is pinned to commit
  `b3ba14077cf1b3e11b86e5f84aa9184605c89b28`. The CPU and optional development CUDA builds remove
  `-march=native` so binaries can run on CPUs other than the build host.

## 1. Build the native helper

Install CMake, a C++17 compiler, Git, and the platform build tool. Build the portable CPU helper
with:

```bash
yarn qwen-tts:build-runtime --backend cpu
```

For native runtime development only, the source can still build an NVIDIA CUDA helper on a machine
with the CUDA toolkit:

```bash
yarn qwen-tts:build-runtime --backend cuda
```

The historical CUDA build uses CUDA Toolkit 12.8.1. On Windows it needs matching
`cublas64_12.dll`, `cublasLt64_12.dll`, and `nvJitLink_120_0.dll` files beside the helper. These
artifacts are not selected by setup or included in application packages. Use
`LS101_SKIP_QWEN_TTS_DOWNLOAD=1` while testing a locally built CUDA runtime so setup does not clean
the files.

The CUDA development workflow uses Ninja and can use a shared sccache backend. On both Windows and
Linux it needs only the CUDA compiler chain, runtime/development files, cuBLAS, nvJitLink, and CCCL
headers; Visual Studio integration, samples, documentation, profilers, and Nsight are not needed.
Clean builds compile five device-code images per CUDA source instead of GGML's nine-image default.

Helpers are written to `externals/ai/qwen3-tts/runtime/<platform>-<arch>/` with the backend in the
executable name. CPU helpers must be built independently on every release target; do not copy a
binary between operating systems or architectures. CUDA compilation does not require a GPU, but a
development build must be probed and exercised on a machine with a compatible NVIDIA driver.

## 2. Produce GGUF models

The runtime build leaves the pinned upstream checkout under `externals/ai/qwen3-tts/downloads/qwen3-tts.cpp`. In a Python
environment with the upstream conversion dependencies, generate the CPU model files:

```bash
cd externals/ai/qwen3-tts/downloads/qwen3-tts.cpp
huggingface-cli download Qwen/Qwen3-TTS-12Hz-0.6B-Base \
  --revision 5d83992436eae1d760afd27aff78a71d676296fc \
  --local-dir models/Qwen3-TTS-12Hz-0.6B-Base
python scripts/setup_pipeline_models.py --skip-download --coreml off
python scripts/convert_tts_to_gguf.py \
  --input models/Qwen3-TTS-12Hz-0.6B-Base \
  --output models/qwen3-tts-0.6b-q8_0.gguf \
  --type q8_0
cd ../../../..
mkdir -p externals/ai/qwen3-tts/models
cp externals/ai/qwen3-tts/downloads/qwen3-tts.cpp/models/qwen3-tts-0.6b-*.gguf externals/ai/qwen3-tts/models/
cp externals/ai/qwen3-tts/downloads/qwen3-tts.cpp/models/qwen3-tts-tokenizer-f16.gguf externals/ai/qwen3-tts/models/
```

The Base download is pinned to revision `5d83992436eae1d760afd27aff78a71d676296fc`. Q8_0 is
preferred for CPU deployment. F16 is supported when its complete package remains below the ZIP
builder's 4 GiB limit.

## 3. Design candidate voices

Use a separate Python environment. The application itself does not package these dependencies:

```bash
python -m venv .venv-qwen-tts
. .venv-qwen-tts/bin/activate
python -m pip install "qwen-tts==0.1.1" torch numpy soundfile
yarn qwen-tts:design-voice
```

The script pins `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign` to revision
`5ecdb67327fd37bb2e042aab12ff7391903235d3`. By default it creates four native American English
female candidates in `native/qwen-tts/voice-design/`, plus a manifest recording the prompt,
seed, duration, and SHA-256. CPU generation is supported but slow; `--device cuda` is allowed for
this development-only step.

Pass `--instruct` and a fixed `--seed` to design another voice. The bundled
`american-man` voice uses seed `20260818` and a neutral General American adult male prompt; its
exact prompt and provenance are recorded beside the selected reference WAV.

Listen to the candidates and select one with clean, steady pacing. Long pauses, background sound,
strong emotion, or a mispronunciation in the reference can become part of the fixed voice.

## 4. Extract the fixed voice

Run the same C++ speaker encoder used in production:

```bash
mkdir -p native/qwen-tts/voices
externals/ai/qwen3-tts/runtime/linux-x64/ls101-qwen-tts-helper-cpu \
  --backend cpu \
  --tts-model externals/ai/qwen3-tts/models/qwen3-tts-0.6b-q8_0.gguf \
  --tokenizer-model externals/ai/qwen3-tts/models/qwen3-tts-tokenizer-f16.gguf \
  --extract-speaker native/qwen-tts/voice-design/candidate-20260816.wav \
  native/qwen-tts/voices/american-woman.spk
```

Replace `linux-x64` with the current platform and select the actual candidate filename. A `.spk`
file is 4100 bytes: a little-endian dimension header (`1024`) followed by float32 values. It does
not contain the reference waveform or transcript.

Selected references and their provenance are kept under `native/qwen-tts/voice-design/`.
The `american-man` and `american-woman` JSON files record the model revision, seed, prompt,
audio hash, and speaker-embedding hash. The runtime and locally prepared package use only the
corresponding `.spk` files under `native/qwen-tts/voices/`.

## 5. Build and import the model package

```bash
yarn qwen-tts:prepare
```

This command packages exactly the voices declared in `scripts/qwen-tts/assets.json`, uses the
configured quantization, and writes a ZIP under `dist/`. The lower-level
`yarn qwen-tts:build-package` command discovers every `.spk` under `native/qwen-tts/voices` by
default; use `--voice id=/path/to/voice.spk` for explicit files or `--quantization f16` to select
F16. Import the ZIP in AI Router, create a local `Qwen3-TTS 0.6B` provider, and run its CPU
connection test.

The runtime, raw model, and assembled package versions are independent. Reuse the existing model
Release when only the helper or Git-managed voices change, but increment `package.version` whenever
the model, voice list, or package manifest changes so installed packages are not mistaken for
older content.

The Qwen Assets workflow accepts `runtime`, `model`, or `both`. For a helper-only change, increment
`runtimeRelease.version` and publish `runtime`; the expensive model conversion job does not run.
Only a GGUF change requires incrementing `modelRelease.version` and publishing `model`. Both jobs
reject an existing tag instead of overwriting assets. The model Release publishes
`qwen3-tts-0.6b-q8_0.gguf` and `qwen3-tts-tokenizer-f16.gguf` directly rather than wrapping them in
another ZIP. `yarn setup` downloads those files independently with resume support, then builds the
importable ZIP from the downloaded models and the voices committed under `native/qwen-tts/`.

The ZIP builder streams multi-gigabyte GGUF files and verifies each asset's SHA-256. It deliberately
does not accept or include a helper executable.

`qwen3-tts.cpp` and GGML are MIT-licensed; their notices are shipped in `thirdparty-licenses/`.
Qwen3-TTS code and model weights are Apache-2.0. Preserve the upstream Qwen license and model-card
attribution when distributing a generated model package outside the application.
