# Qwen3-TTS 0.6B Base runtime

The application runs `Qwen3-TTS-12Hz-0.6B-Base` on CPU through a pinned build of
[`predict-woo/qwen3-tts.cpp`](https://github.com/predict-woo/qwen3-tts.cpp). Python is used only
to create VoiceDesign reference audio during development. Imported model packages never contain
executables.

The published runtime bundle is `qwen-tts-v0.1.0` in the application repository. `yarn setup`
and application build setup query the GitHub Release Assets API, verify each selected asset
against its API-provided size and SHA-256 digest. Release metadata and the helper download are
cached under `externals/ai/qwen3-tts/downloads/`; the two downloaded GGUF files are stored directly
under `externals/ai/qwen3-tts/models/`. The helper is staged under `externals/ai/qwen3-tts/runtime/`. A full
application build then prepares the local model ZIP under `dist/`, while `yarn qwen-tts:prepare`
can build it explicitly. `yarn build:test` sets
`LS101_SKIP_QWEN_TTS_DOWNLOAD=1` so smoke builds do not download the roughly 1.68 GB of models.
If GitHub's anonymous API quota is exhausted, set `GITHUB_TOKEN` or `GH_TOKEN`; a previously
validated API response is also cached at `externals/ai/qwen3-tts/downloads/release-api.json`.

Release version, package version, upstream revisions, model selection, VoiceDesign model, and
fixed-voice metadata have one source of truth: `scripts/qwen-tts/assets.json`. Update that file
before publishing new raw assets or changing the locally assembled model package.

## Runtime architecture

- `ls101-qwen-tts-helper` loads the Base talker, speech tokenizer/vocoder, and one 1024-float
  speaker embedding, then remains alive for serialized synthesis requests.
- The Electron main process communicates with the helper through a bounded binary protocol and
  forces `QWEN3_TTS_BACKEND=cpu`.
- The GitHub Release contains two raw GGUF assets. A local model ZIP combines those models with
  one or more Git-managed `.spk` files. Content-addressed installed
  assets are linked into the filenames expected by the upstream runtime.
- The upstream runtime is pinned to commit
  `b3ba14077cf1b3e11b86e5f84aa9184605c89b28`. The build removes `-march=native` so release
  binaries can run on CPUs other than the build host.

## 1. Build the native helper

Install CMake, a C++17 compiler, Git, and the platform build tool, then run:

```bash
yarn qwen-tts:build-runtime
```

The helper is written to `externals/ai/qwen3-tts/runtime/<platform>-<arch>/`. Build it independently on every
release target; do not copy a binary between operating systems or architectures.

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
externals/ai/qwen3-tts/runtime/linux-x64/ls101-qwen-tts-helper \
  --model-dir externals/ai/qwen3-tts/models \
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
F16. Import the ZIP in AI Router, create a local
`Qwen3-TTS 0.6B (CPU)` provider, and run its connection test.

The raw model Release version and assembled package version are independent. Reuse the existing
Release when only Git-managed voices change, but increment `package.version` whenever the model,
voice list, or package manifest changes so installed packages are not mistaken for older content.

The Qwen Release workflow publishes `qwen3-tts-0.6b-q8_0.gguf` and
`qwen3-tts-tokenizer-f16.gguf` directly rather than wrapping them in another ZIP. `yarn setup`
downloads those files independently with resume support, then builds the importable ZIP from the
downloaded models and the voices committed under `native/qwen-tts/`.

The ZIP builder streams multi-gigabyte GGUF files and verifies each asset's SHA-256. It deliberately
does not accept or include a helper executable.

`qwen3-tts.cpp` and GGML are MIT-licensed; their notices are shipped in `thirdparty-licenses/`.
Qwen3-TTS code and model weights are Apache-2.0. Preserve the upstream Qwen license and model-card
attribution when distributing a generated model package outside the application.
