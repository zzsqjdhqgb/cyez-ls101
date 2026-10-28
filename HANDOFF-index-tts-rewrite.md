# IndexTTS 接入实现任务（全新实现 · 严格对齐 Qwen TTS 形态）

> 本文档是实现提示词。目标读者：负责实现的 agent。背景调研已完成，所有设计决策已定稿，**不要重新论证**；若你认为某项决策不可行，停止并在产出说明中写明理由，不要擅自变更方案。

---

## 0. 边界与禁令（最高优先级）

**禁止查阅以下任何内容**（它们是被放弃的历史方案，参考它们会导致错误的设计）：

- 任何 `del/*` 分支（`del/feat/index-tts-2.5`、`del/2/feat/index-tts-2.5`）：禁止 `git log/show/diff/checkout` 这些分支
- `.gop-research/` 目录
- `externals/ai/index-tts/` 下的 `downloads/`、`runtime-cpu/`、`dev-models/`（历史遗留构建物）
- `.github/workflows/index-tts.yml` 的现有内容（废弃 workflow，本任务将整体重写它）
- `out/` 目录、`packages/airouter/dist/` 里的 `index-tts*`/`cuda-runtime*`/`gpu-probe*` 陈旧产物

**唯一允许使用的遗留物**：`externals/ai/index-tts/models/index-tts2_5-q8_0.gguf`（已通过 SHA-256 校验的上游模型，用于本地端到端验证，见 §9）。

**其他禁令**：不引入 Python 运行时；**应用路径 CPU-only 不变（合成器恒以 `--backend cpu` spawn、模型包/Provider 配置不含 backend 字段），但 CUDA helper 采用 Qwen TTS 的「构建并发布、但 setup 不下载、安装包排除」方案**（CI 构建 cpu+cuda 双后端、Release 同时发布、`assets.json` 只 pin cpu——详见 §4.2/§5.1/§5.3/§6.6/§7，全部镜像 qwen 的现行实现）；不做应用内运行时下载管理器；不新增 IPC 通道（预期零新增；若确有必要，先在产出说明中论证）；不执行 `git add/commit`（见 AGENTS.md）；不改与 IndexTTS 无关的代码。

## 1. 必读参照系（实现的唯一模板）

按顺序精读以下文件，**本任务的一切形态问题都以 Qwen TTS 的对应实现为准**：

1. [AGENTS.md](AGENTS.md)、[docs/engineering/qwen-tts.md](docs/engineering/qwen-tts.md)
2. [.github/workflows/qwen-tts.yml](.github/workflows/qwen-tts.yml)（745 行，CI 模板）
3. `scripts/qwen-tts/` 全部 5 个文件（脚本层模板）
4. [scripts/setup.js](scripts/setup.js)、`scripts/download-asset.js`、`scripts/asset-integrity.js`（共享基础设施：`downloadVerifiedAsset`（断点续传下载+校验）、`ensureAssetSet`/`assertAssetFile`/`isSafeAssetPath`（资产完整性），必须复用、不得重写）
5. `packages/airouter/src/main/qwen-tts.ts`、`qwen-tts-protocol.ts`（合成器与协议模板）
6. `packages/airouter/src/main/speech-service.ts`、`speech-model-store.ts`、[packages/airouter/src/shared/types.ts](packages/airouter/src/shared/types.ts)（Provider 注册与模型包清单 schema）
7. [packages/airouter/src/main/index.ts](packages/airouter/src/main/index.ts)（localSynthesizers 注册点）
8. [packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx](packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx)（设置页 UI 模板）
9. [electron-builder.yml](electron-builder.yml)（extraResources 打包）、`scripts/__tests__/download-qwen-tts.test.js`、`build-qwen-tts-package.test.js`（脚本测试模板）

## 2. 目标

为应用接入本地 IndexTTS-2.5 语音合成引擎（零样本音色克隆，zh/en/ja/es/ar，本应用主要用 en），作为与 `qwen-tts` 并列的第五种 speech provider：`'index-tts'`。推理引擎使用上游 [audio.cpp](https://github.com/0xShug0/audio.cpp)（GGML 纯 C++ 音频推理框架，Apache-2.0）的 `index_tts2` 模型族，模型为 IndexTTS-2.5 的 Q8_0 GGUF 量化。

与 Qwen TTS 的差异只有三点，其余完全一致：

| 维度 | Qwen TTS（现状） | IndexTTS（本任务） |
| --- | --- | --- |
| 上游引擎 | predict-woo/qwen3-tts.cpp | 0xShug0/audio.cpp（`index_tts2` 族） |
| 模型 | 2 个 GGUF，共 ~1.6 GiB，Release 直发 | 1 个 GGUF 3,502,955,328 B，超 GitHub 2 GiB 限制，需分片发布 |
| 音色 | `.spk` 声纹文件，加载期传入 | 参考音频 WAV，**每个请求**传入（换音色不换模型不重启进程） |

## 3. 唯一事实源：`scripts/index-tts/assets.json`

结构对齐 [scripts/qwen-tts/assets.json](scripts/qwen-tts/assets.json)，以下值**已逐一验证过**，照抄：

```json
{
  "schemaVersion": 1,
  "runtime": {
    "repository": "https://github.com/0xShug0/audio.cpp.git",
    "revision": "c7f5743f037d588049c63aa75e9b4fdb279cfe01",
    "ggmlRevision": "5191d4c73bdae6762f0b8df17904c144d6525b07"
  },
  "runtimeRelease": {
    "repository": "zzsqjdhqgb/cyez-ls101",
    "version": "0.1.0",
    "tag": "index-tts-runtime-v0.1.0",
    "prerelease": true,
    "published": false,
    "assets": []
  },
  "modelRelease": {
    "repository": "zzsqjdhqgb/cyez-ls101",
    "version": "1.0.0",
    "tag": "index-tts-model-v1.0.0",
    "prerelease": true,
    "published": false,
    "parts": [
      { "name": "index-tts2_5-q8_0.gguf.part-0001", "size": 1073741824,
        "sha256": "0368d2ff002b9ee74d13084953d567ffa5b9e4c15d9fbdd989d43f035b931d2f" },
      { "name": "index-tts2_5-q8_0.gguf.part-0002", "size": 1073741824,
        "sha256": "5ff77353f7b0a7d2b6534cddb8638a5945d37fa399ff95303b8955882b40dca9" },
      { "name": "index-tts2_5-q8_0.gguf.part-0003", "size": 1073741824,
        "sha256": "ae13dab612641cc346ed58d2ec85563065635a51c313383ef7376935deaae937" },
      { "name": "index-tts2_5-q8_0.gguf.part-0004", "size": 281729856,
        "sha256": "347e52912a2245c8c0f37238014784622285f12574424e841c4ef93f27060749" }
    ]
  },
  "model": {
    "id": "IndexTeam/IndexTTS-2.5",
    "revision": "c39ce5ba981572cb187443877ff559dfb246ce63",
    "ggufRepository": "audio-cpp/audio.cpp-gguf",
    "ggufRevision": "9c78726d0d2cf7ee8511e68ef003490c1251062f",
    "upstreamPath": "IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf",
    "quantization": "q8_0",
    "size": 3502955328,
    "sha256": "5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628"
  },
  "package": {
    "id": "index-tts-2.5-q8_0",
    "name": "IndexTTS 2.5 Q8_0",
    "version": "0.1.0",
    "minimumAppVersion": "0.4.2"
  },
  "voices": [
    { "id": "american-man", "name": "American English Man",
      "file": "native/qwen-tts/voice-design/american-man.wav",
      "provenance": "native/qwen-tts/voice-design/american-man.json",
      "license": "Apache-2.0 (Qwen VoiceDesign model); generated reference audio",
      "languageCodes": ["en"] },
    { "id": "american-woman", "name": "American English Woman",
      "file": "native/qwen-tts/voice-design/american-woman.wav",
      "provenance": "native/qwen-tts/voice-design/american-woman.json",
      "license": "Apache-2.0 (Qwen VoiceDesign model); generated reference audio",
      "languageCodes": ["en"] }
  ]
}
```

说明：分片方案 = 按字节顺序、每片 1073741824 B 切分上述 GGUF（最后一片为余量 281729856 B）。**此切分是确定性的**：对 SHA-256 为 `5e827b20…` 的源文件执行该切分，四片哈希必然等于上述值（已实测复现）。分片/合并函数据此编写，切分后逐片校验哈希作为正确性自检。模型权重许可为 bilibili Model Use License（条件商用，见 §8），参考音频为 Qwen VoiceDesign 生成的合成语音（Apache-2.0，provenance JSON 在同目录）。

`published: false` 的含义：模型 Release 尚未发布。`download-release-assets.mjs` 以此为**唯一**模式开关（见 §5.3）。

（runtime 回填说明）`runtimeRelease.assets` bootstrap 后**只 pin cpu helper（每平台一个）+ `index-tts-runtime-manifest.json`**——镜像 qwen 的 assets 列表形态；cuda helper 与 Windows CUDA DLL 虽随同一 Release 发布（§7），但**不进入 assets、不被 setup 下载**（应用恒 CPU，见 §0/§6.4/§5.3）。

## 4. native helper：`native/index-tts/`

### 4.1 产出物

- `native/index-tts/main.cpp` —— helper 源码（单文件，允许一个 `audio.h` 放 WAV 解码/编码工具）
- `native/index-tts/CMakeLists.txt` —— 构建 `ls101-index-tts-helper`（**单一静态可执行文件**，无伴生 .so/.dll）
- `native/index-tts/content-addressed-gguf.patch` —— 上游加载补丁（见 §4.6，由 `build-runtime.mjs` 应用到 audio.cpp checkout）
- `native/index-tts/licenses/` —— 从上游抓取并提交的许可文件（见 §8）

### 4.2 CMake 规格

- `cmake_minimum_required(VERSION 3.20)`，`project(ls101-index-tts-helper LANGUAGES C CXX)`，C++17
- `AUDIOCPP_SOURCE_DIR` cache PATH 必填，校验 `${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp` 存在
- 锁定只编 index_tts2 族：`AUDIOCPP_MODEL_SET=custom`、`AUDIOCPP_MODELS=index_tts2`、`AUDIOCPP_DEPLOYMENT_BUILD=ON`、`AUDIOCPP_BUILD_C_API=OFF`、`AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER=OFF`
- 静态单文件：`BUILD_SHARED_LIBS=OFF`、`GGML_STATIC=ON`、`GGML_NATIVE=OFF`（可移植，禁 `-march=native`）、`GGML_METAL=OFF`、`ENGINE_ENABLE_OPENMP=OFF`、`GGML_OPENMP=OFF`、`ENGINE_ENABLE_CPU_ALL_VARIANTS=OFF`、`ENGINE_BUILD_EXAMPLES=OFF`、`ENGINE_BUILD_TESTS=OFF`
- **CPU 构建（产品路径）**：`GGML_CUDA=OFF`（与 `ENGINE_ENABLE_CUDA=OFF`），产物为 `ls101-index-tts-helper-cpu`
- **CUDA 构建（仅开发/发布，不进应用——镜像 qwen 的 `--backend cuda` 变体）**：`ENGINE_ENABLE_CUDA=ON`、`GGML_CUDA=ON`、`CMAKE_CUDA_ARCHITECTURES=75;86-real;89-real;120a-real`（4 档 ≈ 每个 CUDA 源 5 个镜像，GGML 默认 9 个——这是控制 Windows CI 编译时长的关键，不得省略）；产物为 `ls101-index-tts-helper-cuda`，需要 CUDA Toolkit 12.8 工具链；Linux 的 CUDA 库允许动态链接（依赖闭包由 `build-runtime.mjs` 发现并随暂存目录分发，见 §5.1），Windows 需在 helper 旁暂存 `cublas64_12.dll`、`cublasLt64_12.dll`、`nvJitLink_120_0.dll` 及 cuFFT DLL（闭包发现，见 §5.1）
- 可执行目标直接编译 C ABI 翻译单元：`add_executable(ls101-index-tts-helper main.cpp "${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp")`，include `${AUDIOCPP_SOURCE_DIR}/include`，链接 `engine_runtime ggml`
- 请求载荷是 JSON：优先链接 audio.cpp 树内 vendored cJSON 目标；若静态配置下该目标不可用，则直接把 `${AUDIOCPP_SOURCE_DIR}/external/cJSON/cJSON.c` 编进 helper。**线格式两种情况下完全一致**
- MSVC 加 `/utf-8`；`install(TARGETS … RUNTIME DESTINATION .)`
- 验收（**仅 cpu 构建**）：Linux 构建产物用 `ldd` 检查，除 libc/libstdc++/libm/libgcc 外**零动态库依赖**（不允许 libaudiocpp.so）。cuda 构建不适用该条——它预期携带 CUDA 动态依赖（Linux）或伴生 DLL（Windows），闭包校验见 §5.1

### 4.3 CLI 契约

```
ls101-index-tts-helper --model <绝对路径> [--backend cpu|cuda] [--threads N]
                       [--device N] [--low-memory 0|1]
```

- `--model` 必填且必须是绝对路径；缺失/相对路径时：**stderr 打印 `An absolute --model path is required`，退出码 1**（CI 冒烟步骤依赖此契约，不得改动文案）
- `--backend`：接受 `cpu`（默认）与 `cuda`（镜像 qwen helper 的取值；`cuda` 仅供原生运行时开发与 CI 构建，应用侧恒传 `cpu`，见 §6.4；传其它值报错）
- `--threads`：1–256，默认 4；`--device`：0–31，默认 0；`--low-memory`：0/1，默认 1
- 未知参数、重复参数、越界数值：stderr 报错 + 退出码 1
- 无参数运行 = 缺 `--model`，走上面的报错路径（**在任何后端下都必须在引擎初始化之前退出**——这保证无 GPU 的 CI runner 也能对 cuda 构建跑无参冒烟）

### 4.4 进程协议（stdin/stdout 二进制安全，请求严格串行）

```text
helper → host : "READY 1\n"
host → helper : "SYNTHESIZE <id> <payloadBytes>\n" + payloadBytes 字节 UTF-8 JSON
helper → host : "RESULT <id> <sampleRate> <wavBytes>\n" + wavBytes 字节 WAV
               | "ERROR <id> <messageBytes>\n" + UTF-8 消息
```

- JSON 载荷字段：`text`（必填字符串）、`voicePath`（必填字符串，参考 WAV 的绝对路径）、`language`（必填，`auto|zh|en|ja|es|ar`）、`maxTokens`（必填整数 1–8192）、`seed`（可选整数 0–4294967295）。拒绝未知/重复字段、非整数数值、内嵌 NUL
- 边界：协议头 ≤4096 B；载荷 ≤512 KiB；文本 ≤64 KiB；结果 ≤100 MiB；`id` 匹配 `[A-Za-z0-9_-]{1,64}`；容忍 `\r\n`
- **单请求 ERROR 不退出**（如参考音频无效），继续服务下一请求；仅致命错误（协议畸形、引擎初始化失败、写失败）以退出码 1 + stderr 诊断退出
- Windows：`_setmode(stdin/stdout, _O_BINARY)`；argv 用 `CommandLineToArgvW` + `WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS)` 转 UTF-8

### 4.5 引擎接入（audio.cpp C ABI）

- 校验 `audiocpp_abi_version()`：**运行时 major 必须等于编译期 `AUDIOCPP_ABI_VERSION_MAJOR`，且运行时 minor ≥ 编译期 `AUDIOCPP_ABI_VERSION_MINOR`**。返回值打包为 `(major<<16)|(minor<<8)|patch`；pin 提交的 ABI 是 **0.2.0**（返回 512，头文件 `include/audiocpp.h` 定义 MAJOR 0 / MINOR 2 / PATCH 0）。**切勿写成「≥2.0」**——major 是 0，该条件永远为假，helper 会拒绝启动
- `audiocpp_model_load` 时 config family 固定 `"index_tts2"`；加载后校验 `audiocpp_model_family()` = `index_tts2` 且 description 含 `"IndexTTS2.5"`
- 会话选项：`index_tts2.mem_saver = low_memory`、`index_tts2.speaker_cache_slots = 1`、`index_tts2.emotion_cache_slots = 1`、`index_tts2.emotion_text_cache_slots = 1`；会话 `task="tts"`、`mode="offline"`、backend config 传 backend/device/threads
- 请求：`audiocpp_request_set_text(text, language)`、参考音频经 WAV 解码后 `audiocpp_request_set_voice_audio(samples, frames, rate, channels)`、`max_tokens`/`seed` 用 `audiocpp_request_set_option`
- 不使用情绪控制（无 emotion 文本/音频/向量，Qwen emotion 子模型不会加载）
- 参考音频解码（自行实现，`audio.h`）：完整 RIFF 块遍历校验、支持 8–192 kHz、多声道混合为单声道、文件 ≤32 MiB；畸形参考 → ERROR 消息而非崩溃
- 结果音频编码为 canonical WAV：**22050 Hz、单声道、16 位 PCM**，RIFF 头字段自洽（byteRate = rate×2、blockAlign=2、data 长度与总长一致）
- 模型路径会以**无扩展名**的内容寻址形式传入（应用侧模型包解析见 §6.4；上游为此需要 §4.6 的加载补丁）

### 4.6 上游加载补丁：无扩展名 GGUF 识别（必须实现）

**问题（已实测复现）**：应用安装模型包后，`speech-model-store` 把资产存为 `blobs/sha256/<hash>` 的**无扩展名**路径，`resolveAssetFilePath` 返回的就是这种路径。而 pin 提交的 audio.cpp 在三处按**文件扩展名**判定 GGUF：

- `src/framework/assets/tensor_source.cpp` 的 `open_tensor_source`（`extension == ".gguf"` 分支）与 `prepare_model_directory`（扩展名命中才会 `materialize_gguf_sidecars` 物化内嵌 sidecar）
- `src/framework/model_spec/package.cpp` 的 `is_gguf_file`（按扩展名）

用无扩展名路径加载 IndexTTS2.5 GGUF 的实测失败：`missing model package file 'qwen_emotion_vocab': <模型父目录>/qwen0.6bemo4-merge/vocab.json`——因为扩展名不命中 → sidecar 不物化 → builtin spec 把 `model:` 资源根解析到模型文件的父目录。而带 `.gguf` 扩展名的同一路径加载、合成全部正常。

**要求**：编写一个新补丁 `native/index-tts/content-addressed-gguf.patch`（Git 管理），把上述扩展名判定改为**魔数判定**（读文件前 4 字节 == `"GGUF"`；`is_existing_file` 不存在时返回 false）。三处调用点都必须覆盖：`tensor_source.cpp` 的两个判定点（`open_tensor_source` 与 `prepare_model_directory`）与 `package.cpp` 的 `is_gguf_file`（后者可改为复用前者导出的判定，避免两份实现）。补丁必须最小化、不改变任何带扩展名路径的既有行为（魔数判定对合法 `.gguf` 文件恒真）。`build-runtime.mjs` 在 checkout 校验（§5.1）之后、CMake 配置之前 `git apply` 该补丁；重复运行时先检查 `git diff --no-ext-diff` 与已应用补丁一致则跳过，不一致（存在其它本地改动）即报错。

**验证要求（写进 §9 端到端冒烟）**：除带扩展名路径外，必须再用一个**无扩展名路径**（把模型符号链接到临时目录的哈希名文件，如 `.tmp/<sha256>`）加载并完成一次合成，两种路径都必须成功。

## 5. 脚本层：`scripts/index-tts/`（严格 5 文件，形态对齐 `scripts/qwen-tts/`）

**禁止**出现第 6 个脚本（无 `install-runtime.mjs`、`test-runtime.mjs`、`runtime-metrics.mjs`、`config.mjs`）。运行时摄取只有一条路径：GitHub Release 下载。分片拆分/合并逻辑作为 `download-release-assets.mjs` 的内部函数。

### 5.1 `build-runtime.mjs`

镜像 qwen 版（含 `--backend cpu|cuda` 参数，用法同 `yarn qwen-tts:build-runtime --backend …`）：校验 assets.json（40 位 hex revision/ggmlRevision）→ `git clone --filter=blob:none` 到 `externals/ai/index-tts/downloads/audio.cpp`（已存在则 fetch）→ `git checkout --detach <revision>` → **校验** `rev-parse HEAD` = revision 且 `rev-parse HEAD:external/ggml` = ggmlRevision（注意：`external/ggml` 是树内 vendored 目录，该值是其 **tree hash**，不是子模块 commit）→ **应用 §4.6 补丁**（`git apply`，幂等处理见该节；实现可参考 qwen 脚本 `applyPatch` 的「先正向、失败则反向校验已应用」模式）→ CMake 配置+构建（backend 取 cpu 或 cuda，§4.2 对应 flag 集；Ninja；可用 `SCCACHE_PATH`/`INDEX_TTS_CMAKE_GENERATOR` 环境变量，镜像 qwen）→ 暂存到 `externals/ai/index-tts/runtime/${platform}-${arch}/ls101-index-tts-helper-<backend>[.exe]`（chmod 755）→ 同目录写入 licenses（§8）与 `build-<backend>.json` 元数据（sourceCommit、ggmlRevision、backend、target、工具链版本）→ 运行一次无参冒烟（期望 stderr 契约，见 §4.3；cpu 与 cuda 构建都跑）。

**禁止执行 `git submodule update --init [--recursive]`**（qwen 脚本里的这行不能照抄）：pin 提交的 audio.cpp 唯一子模块是 `external/audio.cpp-server-frontends`，其 `.gitmodules` 里登记的是 SSH URL（`git@github.com:0xShug0/audio.cpp-server-frontends.git`），本机与 GitHub 托管 runner 都没有对应部署密钥，克隆必然失败并中断构建。该子模块仅在 `AUDIOCPP_BUILD_SERVER_FRONTENDS=ON` 时被引用（本构建为 OFF），对本构建**完全不需要**；真正被本构建使用的 `external/ggml` 是树内 vendored 源码、随主仓库一起 checkout，已由上方的 tree-hash 校验覆盖。（该子模块仓库本身公开存在，若未来确需初始化，可用一次性 URL 重写 `git -c url."https://github.com/".insteadOf=git@github.com: submodule update --init` 绕开 SSH——但本任务不做。）

**CUDA 构建的依赖闭包发现与暂存（仅 `--backend cuda` 时执行；镜像 qwen 的 Windows DLL 暂存并推广到双平台）**：

- 环境变量 `INDEX_TTS_CUDA_REDIST_DIR`（由 workflow 设置：Windows 为 `$CUDA_PATH/bin`，Linux 为 `$CUDA_PATH/lib64`）指向已安装 CUDA Toolkit 12.8 的运行时库目录
- 构建完成后**发现**闭包而非硬编码文件名：Linux 对 helper 逐个 `ldd`，收集 `libcublas*`、`libcublasLt*`、`libcudart*`、`libcufft*`、`libnvJitLink*` 依赖并把对应文件从 `INDEX_TTS_CUDA_REDIST_DIR` 拷入暂存目录（`LD_LIBRARY_PATH` 指向暂存目录后 `ldd` 不得再出现 `not found`）；Windows 对 helper 用 `dumpbin /DEPENDENTS`，收集 `cublas64_12.dll`、`cublasLt64_12.dll`、`cudart*`、`cufft*`、`nvJitLink*` 并从 `$CUDA_PATH/bin` 拷入暂存目录（每个 DLL 校验 ≥1 MiB，镜像 qwen 的体积下限守卫）
- 闭包断言：至少覆盖 cublas、cublasLt、cudart、cufft、nvJitLink 五族（IndexTTS2.5 的 BigVGAN/STFT 路径用到 cuFFT，缺族即报错，不得静默发布）
- 同目录写入 `LICENSE.NVIDIA-CUDA.html`（从 `https://docs.nvidia.com/cuda/eula/index.html` 下载，镜像 qwen release-runtime 的做法）
- cpu 构建完全不受以上影响（无任何 CUDA 步骤）

### 5.2 `build-package.mjs`

镜像 qwen 版 ZIP64 流式打包器：按 assets.json 的 package/voices/model 组装可导入模型包 ZIP（manifest + 模型 + 参考音频），逐资产 SHA-256 校验，**绝不包含可执行文件**。manifest 内容见 §6.2。

### 5.3 `download-release-assets.mjs`

镜像 qwen 版的模式与参数（`--verify`、`--verify-upstream`；环境变量 `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` 跳过、`LS101_INDEX_TTS_RUNTIME_ONLY=1` 仅运行时）：

- **runtime**：从自有仓库 Release（`runtimeRelease.tag`）下载已 pin 的 helper 资产（文件名、尺寸、SHA-256 逐项校验），暂存到 `externals/ai/index-tts/runtime/`。**assets.json 只 pin cpu helper（镜像 qwen：cuda helper 及其 CUDA 依赖虽随同一 Release 发布，但不 pin、不被 setup 下载）**。`runtimeRelease.published=false` 时报错并提示先构建本地 runtime（`yarn index-tts:build-runtime`），本地构建产物同样要过 `build-cpu.json` + 哈希自检
- **CUDA 遗留清理（镜像 qwen 的 `disabledCudaRuntimeFiles`/`cleanupDisabledCudaRuntimes`）**：下载启用时，脚本主动删除两个平台暂存目录里的 cuda 构建物——`ls101-index-tts-helper-cuda*`，以及按前缀匹配的 CUDA 运行库（`cublas*`、`cublasLt*`、`cudart*`、`cufft*`、`nvJitLink*`、`libcublas*`、`libcufft*`、`libnvJitLink*`、`LICENSE.NVIDIA-CUDA.html`）；`LS101_SKIP_INDEX_TTS_DOWNLOAD=1` 时跳过下载**同时跳过清理**，保留本地用 `--backend cuda` 构建的开发产物（与 qwen 的 `LS101_SKIP_QWEN_TTS_DOWNLOAD=1` 语义一致）。删除逻辑对 ENOENT/ENOTDIR 容忍（镜像 qwen 的清理函数）
- **引导顺序（必须遵守，否则 CI 全红）**：`runtimeRelease.published=false` 且本地无已暂存构建时，本脚本**硬失败**会让 `scripts/setup.js`（postinstall/predev/prebuild 都会调用）在**任何全新环境**上失败——包括 ci.yml 的 `yarn install --immutable`（postinstall 触发 setup）与 `yarn build:test`。因此合入前的验收顺序固定为：**先**从 feature 分支 `workflow_dispatch` 运行重写后的 workflow（§7），发布 `index-tts-runtime-v0.1.0` 与 `index-tts-model-v1.0.0` 两个 Release 并回填 assets.json（runtime 的 `published:true` + 资产哈希；model 的 `published:true` + 分片条目），**再**跑完整 CI / `yarn test:smoke` 验收。在 bootstrap 完成前，除本地已构建 runtime 的环境外，setup 失败是**预期状态**，不得为让它变绿而绕过 pin 校验或放宽哈希检查
- **model**：`modelRelease.published=false` 时从 HF bootstrap——按 `model.ggufRepository/ggufRevision/upstreamPath` 下载原始 GGUF（`downloadVerifiedAsset`，校验 size+sha256）到 `externals/ai/index-tts/models/`；`published=true` 时从自有 Release 下载 parts、逐片校验后顺序合并，再整体校验 `model.sha256`。两种模式是**同一个函数的两个分支**，由 published 标志选择，不得扩散到其它文件
- 提供 `--verify-upstream`：runtime 对账 GitHub Release API；model 对账 HF blobs API + 自有 Release API（镜像 qwen 的缓存响应文件做法，存 `externals/ai/index-tts/downloads/`）
- 复用 `downloadVerifiedAsset`/`ensureAssetSet`/`assertAssetFile`/`isSafeAssetPath`，禁止重写下载/校验基础设施

### 5.4 `prepare-package.mjs`

组合根：调用 download → build-package，产出 `dist/` 下的模型包 ZIP（镜像 qwen 的 `qwen-tts:prepare`）。

### 5.5 `package.json` 与 `scripts/setup.js`

新增脚本：`index-tts:build-runtime`、`index-tts:download`、`index-tts:build-package`、`index-tts:prepare`。[scripts/setup.js](scripts/setup.js) 的 tasks 追加：

```js
{ script: 'index-tts/download-release-assets.mjs', assetVerification: true, modelDownload: true,
  productDocsEnvironment: { LS101_INDEX_TTS_RUNTIME_ONLY: '1' } }
```

## 6. 应用侧集成（`packages/airouter`）

### 6.1 类型与注册

- [packages/airouter/src/shared/types.ts](packages/airouter/src/shared/types.ts)：`AIRouterSpeechProviderType` 增加 `'index-tts'`（`AIRouterLocalSpeechProviderType` 随之扩展为 `'pocket-tts' | 'qwen-tts' | 'index-tts'`）
- [packages/airouter/src/main/index.ts](packages/airouter/src/main/index.ts)：`localSynthesizers` 注册 `'index-tts': indexTtsSynthesizer`；`app.once('will-quit', …)` dispose，全部镜像 qwen 写法
- `speech-service.ts`：`manifest.runtime.engine === config.type` 校验天然覆盖；确认连接测试、音色列表、模型包导入路径对 `'index-tts'` 透明（qwen 怎么走它就怎么走）。backend 语义与 qwen 对齐为「应用恒 CPU」：Provider 配置不暴露 backend 字段，合成器永远以 `--backend cpu` spawn 并只解析 `ls101-index-tts-helper-cpu`（镜像 qwen 在主进程把 backend 归一化为 cpu 的边界效果；cuda helper 仅供原生运行时开发，应用永不解析、永不 spawn——与 qwen 的现行方案一致）
- `speech-model-store.ts`：如 providerType 过滤/引擎 allowlist 需要登记 `'index-tts'`，对齐 qwen 的登记方式
- 新文件三个：`main/index-tts.ts`、`main/index-tts-protocol.ts`、`main/index-tts-model.ts`（文件级拆分保持三件套；不要塞成单文件，也不要更多文件）

### 6.2 模型包 manifest 契约（`index-tts-model.ts`）

导出：`INDEX_TTS_LANGUAGES = ['auto','zh','en','ja','es','ar'] as const`、`IndexTtsParameters`、`indexTtsParameters(parameters)`、`assertIndexTtsManifest(manifest)`。

- `assertIndexTtsManifest`：`manifest.runtime.engine === 'index-tts'` 时执行——每个 model 的 `artifacts['tts-model']` 恰好一项且对应 asset `kind === 'tts-model'`；每个 voice 的 `files` 恰好一项且 asset `kind === 'speaker-reference'`、大小 44 B–32 MiB；参数经 `indexTtsParameters` 校验。不匹配抛中文错误
- `indexTtsParameters` 归一化（结构对齐 qwen 的 `parseRuntimeParameters`，分为 load/synthesis 两段）：
  - `load.threads`：整数 1–256，默认 4
  - `load.device`：整数 0–31，默认 0
  - `load.lowMemory`：布尔，默认 true
  - `synthesis.language`：`INDEX_TTS_LANGUAGES` 之一，默认 `auto`
  - `synthesis.maxTokens`：整数 1–8192，默认 1500
  - `synthesis.seed`：可选整数 0–4294967295
- 模型包 manifest 由 `build-package.mjs` 生成：`format: 'ls101.tts-model-package'`、`formatVersion: 1`、`runtime: { engine: 'index-tts', engineApiVersion: 1, minimumAppVersion }`、assets（`tts-model` GGUF + `speaker-reference` WAV，含 path/kind/size/sha256）、models（含上述 parameters 默认值）、voices（引用 WAV 资产）

### 6.3 协议解码器（`index-tts-protocol.ts`）

镜像 `qwen-tts-protocol.ts` 的类结构与防御风格：`IndexTtsProtocolDecoder`，构造 `(onMessage, onError)`，`push(chunk)`/`end()`；导出 `INDEX_TTS_MAX_TEXT_BYTES = 64*1024`、`INDEX_TTS_MAX_REQUEST_BYTES = 512*1024`。消息类型：`{type:'ready', version}`、`{type:'result', requestId, sampleRate, data}`、`{type:'error', requestId, message}`。逐条校验：READY 恰两字段且 version 1–100；RESULT 恰四字段、rate 8000–192000、wav 长度 44–100 MiB；ERROR 恰三字段、消息 0–4096 B；requestId 匹配 `[A-Za-z0-9_-]{1,64}`；头超 4096 B、载荷不完整、消息非法 → onError 中文错误。

### 6.4 合成器（`index-tts.ts`）——行为规格（验收测试将逐条覆盖，必须逐条实现）

`IndexTtsSynthesizer implements AIRouterLocalSpeechSynthesizer`。构造选项（**名称固定**）：`{ helperPath?, spawnProcess?, startupTimeoutMs?, synthesisTimeoutMs?, shutdownTimeoutMs?, idleTimeoutMs?, maxQueuedRequests? }`。默认值：startup 180000、synthesis 600000、shutdown 5000、idle 300000、queue 32。

内部结构镜像 `QwenTtsSynthesizer` 的骨架（sessions Map + per-key 队列 promise 链 + activeSessions），但**音色在请求期传递**（会话键不含 voice，dispatch 时传 voicePath），并满足以下不变量：

1. **单进程独占**：同一时刻至多一个 helper 进程；会话键 = `[modelPath, device, threads, lowMemory]` 的 JSON 串
2. **串行调度**：请求进单 owner 队列严格串行；队列满（默认 32）直接拒绝（`IndexTTS 等待队列已满`）
3. **换模型**：键变化时先等旧进程完全退出（含其临时目录清理）再启动新进程；旧进程 SIGTERM 后 5s 内不退 → SIGKILL，再 5s 仍不退 → 置永久故障（`IndexTTS helper 未能退出，已停止后续加载`），拒绝后续加载直到 dispose
4. **三类取消**：排队中取消 → 立即 reject，不影响活动请求；加载中取消 → 中止加载，后续请求可用其它音色/模型正常恢复；推理中取消 → abort 当前请求、按进程故障处理、下个请求重启进程
5. **超时**：启动超时 → 会话失效；合成超时 → 会话失效；两者之后都能通过重启进程恢复服务
6. **单请求 ERROR**（如无效参考音频）：仅 reject 该请求，**已加载模型保留**，会话继续
7. **协议畸形**（未知 requestId、重复 READY、版本不符、WAV 结构无效、stdout 管道关闭、进程非零退出）：会话立即失效（stderr 尾部 ≤16 KiB 附加进错误信息）；失效后到达的迟到事件必须被忽略，不得污染新会话
8. **模型包删除/资源变更**：提供 `releasePackage(id, version, remove)` 与 `releaseAssets(operation)` 协调接口——挂起调度、取消受影响的排队请求、等推理与进程清理完成后再执行文件操作；文件操作彼此串行化；期间新请求以（`IndexTTS 模型包正在删除` / `IndexTTS 模型资源正在更新，请稍后重试`）拒绝
9. **闲置回收**：队列空 5 分钟（timer unref）释放进程、监听器与临时目录
10. **dispose 幂等**：取消全部排队、等活跃与进程清理完成；dispose 后任何调用直接拒绝（`IndexTTS 已关闭`），永不再 spawn
11. **spawn 前校验**：`format !== 'wav'` 拒绝（`IndexTTS 当前只支持 WAV 输出`）；文本 trim 后 1–65536 UTF-8 字节；manifest 契约（§6.2）不符拒绝；资产路径解析可被 abort 且不 spawn
12. **输出校验**：RESULT 的 WAV 逐字段验证（RIFF/WAVE、fmt 16 B PCM 单声道、byteRate=rate×2、blockAlign=2、16 位、data 长度一致、偶数字节），返回 `{ data, format:'wav', mediaType:'audio/wav', sampleRate, channels:1, durationMs }`

其他要求：helper 进程 spawn 参数 `--backend cpu --model <abs> --device --threads --low-memory`；进程环境给私有 `TMPDIR/TEMP/TMP`（helper 可能在临时目录物化内嵌 tokenizer 数据），退出后清理该目录；Windows 下 `windowsHide: true`；错误消息中文并带 `{ cause }` 链；helper 路径解析镜像 qwen（packaged：`process.resourcesPath/index-tts/${platform}-${arch}/ls101-index-tts-helper-cpu[.exe]`；dev：`externals/ai/index-tts/runtime/…`）。

### 6.5 渲染层

[AIRouterSpeechSettingsPage.tsx](packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx)：新增 IndexTTS provider 区块，结构对齐 Qwen TTS 区块（本地 Provider 表单 + 模型包导入/删除 + 连接测试 + 音色列表）。可调参数暴露：threads、language、maxTokens、seed（可选）。文案中文，风格与现有页面一致。**不新增 Runtime 管理页、不新增下载进度 UI**（资产走 setup）。

### 6.6 打包

[electron-builder.yml](electron-builder.yml) extraResources 追加（**逐行镜像 qwen 的条目，包括 CUDA 排除过滤器**——cuda 资产可能因本地开发构建而存在于该目录，必须从安装包排除）：

```yaml
- from: externals/ai/index-tts/runtime
  to: index-tts
  filter:
    - '**/*'
    - '!**/ls101-index-tts-helper-cuda*'
    - '!**/cublas*.dll'
    - '!**/cufft*.dll'
    - '!**/nvJitLink*.dll'
    - '!**/libcublas*'
    - '!**/libcufft*'
    - '!**/libnvJitLink*'
    - '!**/LICENSE.NVIDIA-CUDA.html'
```

（安装包内只含 cpu helper；cuda helper 及 CUDA 运行库「存在但被移除」——与 qwen 的 `qwen-tts` 条目同构。）

## 7. CI 工作流：重写 `.github/workflows/index-tts.yml`

**整体重写**（现有内容是废弃方案，不要保留任何一行）。以 [qwen-tts.yml](.github/workflows/qwen-tts.yml) 为模板逐 job 镜像，差异：

- `metadata`：校验 assets.json、输出 runtime/model 版本与 tag；构建矩阵含 cpu 与 cuda 双后端（见下）
- `build`：矩阵**镜像 qwen 的 4 条腿**——`ubuntu-22.04/linux-x64 × cpu`、`ubuntu-22.04/linux-x64 × cuda`、`windows-2022/win32-x64 × cpu`、`windows-2022/win32-x64 × cuda`（cuda 腿构建并发布、但产品不使用，见 §0）；Node 24；Windows 用 `VsDevCmd.bat` + Ninja（镜像 qwen 的 Windows 步骤写法）；构建统一经由 `node scripts/index-tts/build-runtime.mjs --backend ${{ matrix.backend }}`（补丁应用、子模块禁令、CUDA 依赖闭包发现都在脚本内处理，见 §5.1/§4.6）；构建后冒烟（spawnSync 无参运行，断言退出码 1 + stderr 含 `An absolute --model path is required` + 体积下限）**对 4 条腿一致**——cuda 构建的无参退出发生在引擎初始化之前（§4.3），无 GPU 的 runner 也能跑；暂存 `release-assets/`：每腿 helper（`ls101-index-tts-helper-<backend>-<target>[.exe]`）+ `build-info-<target>-<backend>.json`（含上游 revision/ggmlRevision，镜像 qwen 的 build-info），**Windows cuda 腿**额外暂存闭包发现的 CUDA DLL（每个 ≥1 MiB 守卫，镜像 qwen 的 "Stage Windows CUDA runtime dependencies" 步骤），**Linux cuda 腿**额外暂存闭包发现的 `lib*.so*`（由脚本完成，workflow 只收集）；上传 artifact（命名 `index-tts-runtime-<target>-<backend>`）
  - **cuda 腿的额外步骤（`if: matrix.backend == 'cuda'`，全部镜像 qwen-tts.yml）**：`mozilla-actions/sccache-action@v0.0.11`（version v0.17.0）；`Jimver/cuda-toolkit@v0.2.36`（`cuda: 12.8.1`、`method: network`，子包白名单在 qwen 基础上**追加 cuFFT**：Windows `["nvcc","cudart","cublas","cublas_dev","cufft","cufft_dev","nvjitlink","thrust"]`，Linux `["nvcc"]` + non-cuda `["libcublas","libcublas-dev","libcufft","libcufft-dev","libnvjitlink"]`）；构建 env `SCCACHE_GHA_ENABLED=true`；设置 `INDEX_TTS_CUDA_REDIST_DIR`（win: `$CUDA_PATH/bin`，linux: `$CUDA_PATH/lib64`）
  - `timeout-minutes`：cpu 腿 120（同 qwen）；**cuda 腿 360**（平台单 job 上限 6 小时；audio.cpp 的 ggml-cuda 内核量远大于 qwen3-tts.cpp，首跑最慢——务必启用 §4.2 的架构裁剪与 sccache，缓存命中后显著缩短；首跑超时则直接重跑利用已写入的部分缓存）
  - **CRLF 警示**：bash 步骤拼接/传递路径时警惕行尾 `\r` 混入文件名（历史失败案例：`ls101-index-tts-helper.exe\r` 导致 ENOENT）。镜像 qwen 的写法（env 直传常量、Node heredoc 内 `path.join` 拼接）即可规避
- `model`：按 `model.ggufRepository/ggufRevision/upstreamPath` 从 HF 下载（校验 sha256=5e827b20…、size=3502955328）→ **切分为 1 GiB 分片并逐片校验哈希（期望值见 §3）** → 连同许可文件（§8）暂存上传；**任何资产 ≥2 GiB 必须报错**（镜像 qwen 的守卫）
- `release-runtime`：下载全部 4 个 runtime artifact（`pattern: index-tts-runtime-*`、`merge-multiple: true`），生成 `index-tts-runtime-manifest.json`——镜像 qwen 的 manifest 生成步骤：断言 4 份 build-info 的上游 revision/ggmlRevision 一致；断言 helper 资产恰为 4 个（cpu/cuda × linux-x64/win32-x64）；断言 Windows CUDA DLL 集合与 §5.1 闭包一致（每个 ≥1 MiB）；从 `https://docs.nvidia.com/cuda/eula/index.html` 下载 `LICENSE.NVIDIA-CUDA.html`；拷贝 `thirdparty-licenses/` 的 `LICENSE.GGML.txt` 与 `LICENSE.audio-cpp.txt`（或 `native/index-tts/licenses/` 中随构建暂存的副本）；资产按 `kind: native-runtime | native-runtime-dependency | license` 分类并标注 backend/runtimeDirectory（镜像 qwen）；tag 已存在即失败；`softprops/action-gh-release@v3` 发布（prerelease），files 覆盖 helper、CUDA DLL/so、许可、manifest；release body 说明「双后端发布，应用仅使用 CPU helper，CUDA 资产不进入安装包」
- `release-model`：镜像 qwen 的不可变发布（tag 已存在即失败；模型 release 资产为 4 个分片 + manifest + 许可）。**发布后人工回填 assets.json 的 published 标志与资产哈希**（一次性 bootstrap：首次发布前 `published:false`，setup 走 HF；发布后翻 true——runtime 侧**只 pin cpu helper + runtime manifest json**（镜像 qwen：cuda 资产随 Release 发布但不 pin、不下载），model 侧 pin 分片条目）——此流程写进 workflow 注释与工程文档
- **bootstrap 与验收的先后顺序（硬性）**：ci.yml 在 `yarn install --immutable` 的 postinstall 就会执行 `scripts/setup.js`，`published:false` 状态下全新 runner 必然失败。因此正确顺序是：feature 分支就绪 → 从该分支 `workflow_dispatch` 运行本 workflow（构建 4 腿 helper、切分模型、发布两个 Release；**cuda 腿首跑可能耗时数小时，必要时先行重跑一次预热 sccache**）→ 人工回填 assets.json（`published:true`、runtime 侧 cpu helper + manifest 的文件名/尺寸/SHA-256、model 分片条目）→ 提交回填 → **此时起** CI 才可能全绿、`yarn test:smoke` 才可运行。**不要**在 bootstrap 前要求全量 CI 绿（§11 的完成定义已按此顺序表述）；也**不要**为了让 setup 提前通过而临时放宽任何 pin/哈希校验
- 校验类小步骤允许镜像 qwen 的内联 Node heredoc 风格；**构建/下载/切分等重逻辑一律在 scripts/ 里**，workflow 只调用

## 8. 许可与文档

- `native/index-tts/licenses/` 提交：`LICENSE.IndexTTS.txt`（bilibili Model Use License，从 https://raw.githubusercontent.com/index-tts/index-tts/main/LICENSE 抓取）、`DISCLAIMER.IndexTTS.txt`（同仓库 /DISCLAIMER）、`LICENSE.audio-cpp.txt`（从 https://raw.githubusercontent.com/0xShug0/audio.cpp/master/LICENSE 抓取）。`build-runtime.mjs` 暂存时随 helper 一并拷贝
- `thirdparty-licenses/` 增加上述三份 + `LICENSE.GGML.txt`（如已存在则复用）；模型 Release 资产包含它们
- **CUDA 侧许可（镜像 qwen）**：`LICENSE.NVIDIA-CUDA.html` 从 https://docs.nvidia.com/cuda/eula/index.html 下载，随 runtime Release 发布、在 cuda 构建的暂存目录随闭包分发；NVIDIA CUDA Toolkit 12.8 的运行时 DLL（cublas/cublasLt/cudart/cufft/nvJitLink）按 NVIDIA EULA 分发，thirdparty-licenses 相应补一份说明（qwen 已有先例可循）
- 新写 [docs/engineering/index-tts.md](docs/engineering/index-tts.md)：结构对齐 [docs/engineering/qwen-tts.md](docs/engineering/qwen-tts.md)（runtime 架构、本地构建、模型来源与分片、打包导入、workflow 用法、bootstrap 发布流程、许可说明——明确 bilibili Model Use License 的条件商用条款：年收入 >10 亿元人民币或 MAU >1 亿需单独授权；输出不得用于改进其他商业 AI 模型）

## 9. 本地验证资源（已备好）

- **模型**：`externals/ai/index-tts/models/index-tts2_5-q8_0.gguf`（3,502,955,328 B，SHA-256 已核对为 §3 值）——直接用，**不要重新下载 3.3 GiB**
- **上游源码**：`build-runtime.mjs` 自行 clone pin 提交（此前遗留的 `downloads/audio.cpp-c7f5743/` checkout 已在清理中删除，不存在可复用的本地副本；如需省一次 clone，可在运行前手动放置同 revision 的 checkout 到 `downloads/audio.cpp`，脚本仍必须做 `rev-parse` 校验）
- **参考音频**：`native/qwen-tts/voice-design/american-{man,woman}.wav` + provenance JSON
- **性能预期**（本容器，4 线程）：模型加载到 READY ≈13 s；合成 RTF ≈24–27（4 s 音频约 100 s）。**这是正常值，不要试图"修复"**；产品语义是离线批量生成考试音频，不是即时合成。CUDA 参考（上游 audio.cpp 基准）：RTX 5090 长文本 RTF ≈0.33（约 3 倍实时）——开发机上 `--backend cuda`（配合 `LS101_SKIP_INDEX_TTS_DOWNLOAD=1` 保留本地暂存）即接近该量级，**但 CUDA 不属于本任务的应用侧验收范围**（本容器无 GPU，不做本地 CUDA 冒烟；cuda 构建正确性由 CI 的无参冒烟 + 闭包校验把关）

**端到端冒烟（完成定义的一部分）**：构建 helper 后，用真实模型 + american-woman.wav 跑协议级合成，**两种模型路径都必须各自完成一次**：

1. 带扩展名路径：spawn helper（`--backend cpu --model <abs>.gguf --threads 4`）→ 读到 `READY 1` → 发 `SYNTHESIZE <id> <len>\n` + JSON 载荷 → 收到 `RESULT <id> 22050 <n>\n` + n 字节 WAV，解析出 ≥3 s 的有效音频
2. **无扩展名路径（§4.6 补丁的回归验证，不得省略）**：把模型**符号链接**为临时目录下的哈希名文件（如 `.tmp/5e827b20…`，无扩展名；Linux 冒烟用 symlink 即可，不要复制 3.5 GB），用该路径重复上述完整合成并同样成功

把两条命令、耗时、输出时长写进产出说明。若第 2 条失败而第 1 条成功，即为 §4.6 补丁缺失或未生效，视为端到端验证不通过。

## 10. 测试要求（自行编写；不迁移任何既有用例）

- `packages/airouter/src/__tests__/index-tts.test.ts`：用注入的 `spawnProcess` 协议替身（自己实现协议双）驱动 `IndexTtsSynthesizer`，覆盖 §6.4 的 12 条不变量（每条至少一个用例，重点：串行与换模型、三类取消、超时恢复、单请求 ERROR 不杀会话、迟到事件忽略、包删除/导入协调、队列上限、闲置回收、dispose 幂等、spawn 前校验）
- `index-tts-protocol.test.ts`：解码器正常帧/分片到达/边界/畸形（镜像 `qwen-tts-protocol.test.ts` 风格）
- `index-tts-model.test.ts`：参数归一化与 manifest 契约的接受/拒绝矩阵
- `scripts/__tests__/download-index-tts.test.js`、`build-index-tts-package.test.js`：镜像 `download-qwen-tts.test.js`/`build-qwen-tts-package.test.js` 的测试形态（纯函数提取 + mock），必须覆盖分片切分/合并的确定性（小文件夹具 + 期望哈希）
- 集成冒烟：改动了 renderer → `xvfb-run -a yarn test:smoke`（AGENTS.md）

## 11. 完成定义

1. `yarn lint`、`yarn typecheck`、`yarn test:scripts`、`yarn test:vitest` 全绿
2. Linux 端到端合成冒烟通过（§9 的**两条路径**：带扩展名 + 无扩展名），产出真实 WAV
3. 交付说明包含：改动文件清单、§6.4 十二条不变量与测试用例的映射表、两条端到端冒烟数据、与本提示词的任何偏离及理由、未完成项（Windows 与 cuda 构建仅能由 CI 首次运行验证；cuda 的实际推理正确性需要有 GPU 的开发机另行抽测，不属于本任务验收）
4. 提供（但不执行）建议的 `git add` 命令清单

**关于全量 CI / `yarn test:smoke`**：它们依赖 setup 下载已发布的 Release 资产，在 §5.3/§7 的 bootstrap（发布两个 Release 并回填 assets.json）完成之前**预期无法通过**，因此不在本任务的完成定义内；bootstrap 由维护者按 §7 的顺序执行，回填后全量 CI 才作为验收门槛。
