# IndexTTS 接入研究报告

> 调研日期：2026-10-16。调研范围：本仓库 TTS 扩展体系、两次被放弃的 `del/feat/index-tts-2.5` 尝试、上游 IndexTTS 与 audio.cpp 项目、本机 CPU 可行性实测。
> 结论先行：**技术上完全可行，且已在本机验证通过**；此前两次尝试失败的原因不在技术路线，而在 CUDA CI 策略与未完成的脚手架。推荐照抄 Qwen TTS 的成熟接入模式（CPU-only + setup 分发 + 可导入模型包），复用旧分支已验证的代码与哈希。

---

## 1. 结论摘要

| 问题 | 结论 |
| --- | --- |
| 用什么推理引擎 | [audio.cpp](https://github.com/0xShug0/audio.cpp)（GGML 纯 C++ 音频推理框架，Apache-2.0），`index_tts2` 模型族原生支持 IndexTTS-2 / IndexTTS-2.5，官方 GGUF 包 |
| 与现有架构的关系 | 和 Qwen TTS（qwen3-tts.cpp + GGUF）**完全同构**：native helper 子进程 + 二进制协议 + 模型包导入 + Provider 注册 |
| CPU 是否可用 | **可用，已实测**：加载 ~13s；合成 RTF ≈ 24–27（4 线程容器 CPU）。适合离线批量生成考试音频，不适合交互式即时合成 |
| 模型体积 | `index-tts2_5-q8_0.gguf` = 3,502,955,328 B（3.26 GiB），超出 GitHub Release 单文件 2 GiB 限制，需分片（旧分支已有现成分片方案与已验证哈希） |
| 许可证 | 权重为 **bilibili Model Use License**（条件商用：年收入 >10 亿元人民币或 MAU >1 亿需单独授权；输出不得用于改进其他 AI 模型）；audio.cpp 代码 Apache-2.0 |
| 历史尝试死因 | ① CUDA helper 在 GitHub 托管 runner 上构建过重（Windows 6 小时后被取消）+ CRLF 路径 bug + apt 失败；② 第二次只完成运行时下载脚手架：上游 pin 指向**不存在的仓库**（`lifeiteng/audio.cpp` → 404）、模型哈希是占位符、合成链路完全没接 |
| 推荐路线 | 阶段 1：CPU-only、setup 分发、复用 del/feat 的 helper/协议/合成器；阶段 2（可选）：CUDA 仅作开发实验，不进产品路径（与 Qwen TTS 现行策略一致） |

---

## 2. 现有参考架构：Qwen TTS 的接入模式

IndexTTS 接入应镜像这套已在生产的模式（详见 [docs/engineering/qwen-tts.md](docs/engineering/qwen-tts.md)）：

```text
native/qwen-tts/main.cpp                    # helper 源码（包装 pinned 上游 qwen3-tts.cpp）
scripts/qwen-tts/assets.json                # 唯一事实源：runtime/model release 版本、SHA-256、尺寸
scripts/qwen-tts/build-runtime.mjs          # 本地构建 helper（--backend cpu|cuda）
scripts/qwen-tts/download-release-assets.mjs# setup 阶段下载 + 校验（离线可用，--verify-upstream 对账 GitHub API）
scripts/qwen-tts/prepare-package.mjs        # 组装可导入模型包 ZIP（含 voices）
scripts/setup.js                            # 任务清单入口（postinstall/predev/prebuild 都跑）
native/qwen-tts/voices/*.spk                # Git 管理的固定音色
packages/airouter/src/main/qwen-tts.ts       # QwenTtsSynthesizer（AIRouterLocalSpeechSynthesizer 实现）
packages/airouter/src/main/qwen-tts-protocol.ts # 有界二进制协议解码器
packages/airouter/src/main/index.ts          # localSynthesizers 注册 + IPC 通道
packages/airouter/src/shared/types.ts        # Provider 类型联合 'pocket-tts' | 'qwen-tts'
electron-builder.yml                         # extraResources 打包 CPU helper（排除 CUDA DLL）
.github/workflows/qwen-tts.yml               # CI：metadata → build（linux-x64/win32-x64 × cpu/cuda）→ release
```

产品侧关键决策（Qwen TTS 已做出、IndexTTS 应沿用）：

- **CUDA 在应用内被全面禁用**：setup 清理已下载的 CUDA helper 与 DLL，Provider 配置归一化为 `cpu`，打包排除 CUDA 资产；CUDA 构建仅保留给原生运行时开发。
- 资产发布为自有仓库（`zzsqjdhqgb/cyez-ls101`）的**不可变 Release**（`qwen-tts-runtime-vX.Y.Z` / `qwen-tts-model-vX.Y.Z`），文件名、尺寸、SHA-256 全部 pin 在 assets.json。
- 模型以**原始 GGUF 资产**发布；setup 下载后与 Git 管理的 voices 组装成可导入 ZIP；用户在 AI Router 里导入并创建本地 Provider，跑连接测试。
- imported 模型包不含可执行文件；helper 放应用资源目录，模型放用户数据目录（内容寻址）。

---

## 3. 历史尝试复盘

### 3.1 main 上的废弃 workflow（按要求不参考）

dev/main 上现存 [.github/workflows/index-tts.yml](.github/workflows/index-tts.yml)（297 行，`eb46af1f` 注册）：digest/package 两步 CUDA 构建流程，4.5 GB 权重下载。**该方案已废弃，本报告不以其为参考**；下述推荐方案的 CI 部分完全以仍存活的 [qwen-tts.yml](.github/workflows/qwen-tts.yml) 为模板。

### 3.2 第一次尝试：`del/feat/index-tts-2.5`（2026-10-08 ~ 10-12）

这是**架构上最完整**的一次，接近可发布：

- `native/index-tts/main.cpp`：包装 `0xShug0/audio.cpp`（pin `c7f5743f037d588049c63aa75e9b4fdb279cfe01`，经 GitHub API 验证真实存在，2026-10-08 提交）；构建为 `libaudiocpp.so` + helper 可执行文件（`$ORIGIN` rpath）。
- 协议：`READY 1\n` → 请求 `SYNTHESIZE <id> <payloadBytes>\n` + JSON `{text, voicePath, language, maxTokens, seed}` → 响应 `RESULT <id> <sampleRate> <wavBytes>\n` + WAV，或 `ERROR <id> <bytes>\n`。
- 完整的应用侧实现：`index-tts.ts`（带队列、单 owner 进程、包删除阻塞、闲置回收的 IndexTtsSynthesizer）、`index-tts-protocol.ts`（有界解码器）、`index-tts-model.ts`（manifest 校验：engine `index-tts`、单份 tts-model GGUF、voice 为 44 B–32 MB 的 speaker-reference WAV、语言 auto/zh/en/ja/es/ar）。
- `scripts/index-tts/assets.json`（schemaVersion 1）：模型 pin 为 `audio-cpp/audio.cpp-gguf` 的 `IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf`，3,502,955,328 B，SHA-256 `5e827b20…`（**经 HF API 验证与 LFS oid 完全一致**），分 4 片发布；voices 复用 Qwen VoiceDesign 生成的 `american-man/woman.wav`（provenance JSON 齐全）。
- 许可文件齐备：`LICENSE.IndexTTS.txt`、`DISCLAIMER.IndexTTS.txt`、`LICENSE.audio-cpp.txt`、`LICENSE.GGML.txt` 等。

**失败点全部在 CI**（根目录三份日志）：

- [index-tts-failed.log](index-tts-failed.log)（76 MB，10-09）：Linux 任务在 `Jimver/cuda-toolkit@v0.2.36` 安装时 `sudo` exit 100（apt 网络失败）；Windows 任务在 "Build CUDA helper and stage dependencies" 步骤 ENOENT——`build-runtime.mjs:120` 读到的路径尾部带 `\r`（workflow env 变量 CRLF 注入），`ls101-index-tts-helper.exe\r` 拷贝失败。
- [index-tts-windows.log](index-tts-windows.log)（64 MB，10-09）：Windows CUDA 构建从 08:55 跑到 15:19（>6 小时）后被手动取消；sccache 统计 1826 次编译请求、1672 次缓存写入——**CUDA 编译量本身就把托管 runner 拖死了**。
- [index-tts-windows-37998933634.log](index-tts-windows-37998933634.log)（59 MB，10-10）：再次被取消。

但注意：**本地 Linux CPU 构建是成功的**。`externals/ai/index-tts/runtime-cpu/linux-x64/` 仍留有完整产物（helper 85 KB + `libaudiocpp.so` 7.7 MB + 全套许可 + `build-cpu.json` 构建清单），`externals/ai/index-tts/models/index-tts2_5-q8_0.gguf`（3.5 GB）本地 SHA-256 校验通过。

### 3.3 第二次尝试：`del/2/feat/index-tts-2.5`（2026-10-14，2 个提交）

转向「应用内按需下载运行时」，但**只有脚手架，从未跑通**：

- `native/index-tts/main.cpp` 重写（538 行）：改为静态链接（去掉 .so）、新二进制协议（`SYNTHESIZE <id> <seed> <language> <voicePathBytes> <textBytes>\n` + 原始字节，不再 JSON）、单模型单会话、按请求换 voice、明确不加载 Qwen emotion 模型。协议设计本身是合理精简。
- `scripts/index-tts/assets.json`（schemaVersion 2）：runtime 指向 `https://github.com/lifeiteng/audio.cpp.git` —— **该仓库不存在（GitHub API 404）**；model 声称 `IndexTeam/Index-TTS` 的 `index-tts2_5-q8_0.gguf` 只有 198,660,736 B（199 MB）—— **该文件不存在，且与同文件里沿用的真实 3.5 GB 哈希自相矛盾**（同一个 SHA 配两个尺寸）。TS 侧 `index-tts-runtime.ts` 里又写了第三个哈希（`c0e61827…`）且 win32 条目 `size: 0`、SHA 全零占位。
- 新增 `IndexTtsRuntimeManager` / `CudaRuntimeManager`（按需下载 + SHA-256 allowlist + 安装标记 + 进度轮询）、Runtime 设置页 UI、preload 桥、集成测试更新——**但 Provider 类型联合没有加 `index-tts`，没有任何合成器接入**，应用无法真正用上它。
- `CudaRuntimeManager` 复用 Qwen 的 CUDA release（Linux helper 909 MB，Windows helper + cublasLt 674 MB 等约 1 GB+），继续押注 CUDA——正是第一次的死因。

另外：`packages/airouter/dist/` 里的 `index-tts-*.js`、`cuda-runtime.js`、`gpu-probe.js` 是本地构建该分支留下的陈旧产物（dist 已 gitignore、包从 src 解析，无功能影响，建议清掉避免混淆）。

### 3.4 教训

1. **不要在 CI 里构建 CUDA helper 作为产品路径**——Qwen TTS 活下来正是因为把 CUDA 降级为开发选项、产品只发 CPU。
2. 上游 pin 必须可验证（`git clone` + `rev-parse HEAD` 对账），第二次尝试连源码都拉不到。
3. assets.json 里的哈希/尺寸在发布前必须来自真实下载物（第一次尝试做对了：与 HF LFS oid 逐字节一致）。
4. 「应用内按需下载」与既有 setup 体系重复建设，没必要——setup 已支持离线校验、断点续传、上游对账。

---

## 4. 上游调研

### 4.1 IndexTTS-2.5 本体（[index-tts/index-tts](https://github.com/index-tts/index-tts)）

- Bilibili/IndexTeam 的零样本 TTS：0.8B GPT 自回归 + DiT CFM + BigVGAN；2026-08-10 发布。
- 语言：zh / en / ja / es / ar；音色-情绪解耦；细粒度情绪控制（情绪参考音频 + `emo_alpha`、8 维情绪向量、`use_emo_text` 文本情绪推断、`emo_text` 显式情绪描述）；语速控制 `duration_factor` 0.5–2.0×；发音控制（拼音 / CMU 音素 / 假名 `<文字|发音>` 内联标注）。
- 官方栈是 Python（uv + torch，CUDA ≥12.8，可选 DeepSpeed/vLLM）——**对本应用不可行**（应用不引入 Python）。
- 质量（官方评测，CV3-Eval）：en WER 5.12 / SS 68.06（IndexTTS2.5），en WER 3.89 / SS 67.79（IndexTTS2.5-RL）；与 Qwen3-TTS（WER 5.06）同级，中文更优。
- 速度：RTX 4090 bf16 RTF 0.2065；RTX 5090 + audio.cpp CUDA 长文本 RTF 0.332。

### 4.2 audio.cpp（[0xShug0/audio.cpp](https://github.com/0xShug0/audio.cpp)）

GGML 之上的纯 C++ 音频推理框架（v0.9.1，2026-10-07；110+ 模型族），对本应用的关键事实：

- `index_tts2` 模型族：任务 TTS/Clone/Ctrl，zh/en/ja/es/ar，**IndexTTS-2 与 IndexTTS-2.5 同族**（由模型 config `version: "2.5"` 选变体），GGUF 16/Q8。
- GGUF 官方包在 [audio-cpp/audio.cpp-gguf](https://huggingface.co/audio.cpp-gguf)（ModelScope 镜像 `HereIsMark/audio.cpp-gguf`）：
  `index-tts2_5-q8_0.gguf` 3,502,955,328 B；`index-tts2_5-f16.gguf` 4,547,355,072 B；`index-tts2_5-orig.gguf` 7,885,093,440 B。
- CMake 裁剪开关正是两次尝试用到的：`AUDIOCPP_MODEL_SET=custom`、`AUDIOCPP_MODELS=index_tts2`、`AUDIOCPP_DEPLOYMENT_BUILD`、`ENGINE_ENABLE_CPU_ALL_VARIANTS=OFF`、`GGML_STATIC=ON` 等。
- 提供 C ABI（`src/capi/audiocpp.cpp`，#530 合入）；.NET 绑定项目已验证「CPU runtime 与 CUDA runtime 分包」的先例。
- 会话选项：`index_tts2.weight_type`（q8_0）、`mem_saver`、`speaker_cache_slots`、各图竞技场 MB 数等；请求选项：`language`（auto 检测）、采样参数（top_p 0.8 / top_k 30 / temperature 0.8 / repetition_penalty 10 / num_beams 3 / max_tokens 1500 / seed）、`duration_scale`、情绪族选项。
- **文本正则化（TN）是规则版移植**（wetext 规则的 C++ 重实现，50+ 用例与官方对齐）：非常规输入（字母粘连数字、罕见日期/单位、邮箱、URL）可能与官方输出不同；es 不做 NeMo 归一化；ja 不做分词。对英文考试文本（含 "Question 1"、日期、价格等）**需要专门 QA**。
- 输出：22050 Hz 单声道 PCM16 WAV（实测确认）。
- audio.cpp 自身 Apache-2.0；模型权重保留各自原始许可。

### 4.3 许可证（必须随包分发并记录）

- **IndexTTS-2/2.5 权重：bilibili Model Use License**（非 OSI）：年营收 >10 亿元人民币或 MAU >1 亿需单独商业授权；模型及其输出不得用于改进其他商业 AI 模型。本应用当前规模在阈值之内，但需在文档中记录条件并随模型包附 `LICENSE.IndexTTS.txt` + `DISCLAIMER.IndexTTS.txt`（旧分支已有现成文件）。
- audio.cpp / GGML：Apache-2.0 / MIT，通知放 `thirdparty-licenses/`。
- 参考音频：沿用 Qwen VoiceDesign 生成的 `american-man/woman.wav`（Apache-2.0 模型生成，provenance JSON 记录 prompt/seed/哈希）。

---

## 5. 本机实测（Linux 容器，4 线程 CPU）

用旧分支留下的 `ls101-index-tts-helper-cpu` + 真实 3.5 GB q8_0 模型 + `american-woman.wav` 参考音色：

| 指标 | 实测值 |
| --- | --- |
| 模型加载到 `READY 1` | 13.1–13.4 s |
| 合成 "This is a short test of Index TTS voice cloning on CPU." | 142 s 总墙钟（含加载）→ 5.58 s 音频 |
| 会话内首请求（~4.0 s 音频） | 109.4 s（RTF ≈ 27） |
| 会话内第二请求（~4.3 s 音频） | 102.4 s（RTF ≈ 24） |
| 输出格式 | 22050 Hz mono PCM16 WAV，峰值 26048/32768，RMS 健康 |

产物保存在 [out/index-tts-smoke.wav](out/index-tts-smoke.wav)（本地证据，out 已 gitignore）。

**解读**：CPU 合成功能正确但慢（约 25× 实时）。考试音频是**离线/批量**生成的（备卷时合成、考试时播放），这个速度完全可用（一条 5 s 题目音频 ~2 分钟，批处理跑一夜能出几百条）；但它不适合「即时试听」交互场景——UI 上要么用 Pocket TTS（已有、快）做即时预览，要么明确提示生成耗时。8–16 线程的桌面 CPU 会显著快于本容器，但仍预计在 5–10× 实时区间；交互式场景若要快，唯一现实路径是后续的 CUDA helper（dev-only，同 Qwen 策略）。

---

## 6. 推荐接入方案

### 阶段 0：清理（先行）

- 删除根目录三份 CI 失败日志（`index-tts-failed.log`、`index-tts-windows.log`、`index-tts-windows-37998933634.log`，共 ~200 MB）。
- 清空 `packages/airouter/dist/` 里的陈旧 index-tts/cuda-runtime/gpu-probe 产物。
- 从 main/dev 删除废弃的 [.github/workflows/index-tts.yml](.github/workflows/index-tts.yml)（将被新方案的重写版取代）。
- `externals/ai/index-tts/` 本地遗留（7.5 GB dev-models + 3.3 GB models + runtime-cpu）可保留作开发物料，或按需重下。

### 阶段 1：运行时与资产（照抄 Qwen TTS 模式，CPU-only）

1. **helper**：以 `del/feat` 的 [native/index-tts/main.cpp] 协议实现为底，融合 `del/2` 的静态链接 CMakeLists（去掉 `libaudiocpp.so` + `$ORIGIN`，单一可执行文件更接近 Qwen helper 的形态）。上游 pin 改为 `0xShug0/audio.cpp` 的最新 release 提交（v0.9.1 或更新），`ensurePinnedSource()` 的 clone + `rev-parse` 对账逻辑保留。
2. **scripts/index-tts/**：assets.json 回到 schemaVersion 1 的正确形态——runtime pin（0xShug0 + 真实 commit）、modelRelease 4 分片（哈希 `0368d2ff…`/`5ff77353…`/`ae13dab6…`/`347e529…` 已在旧分支验证过分片方案；如改用新 pin 需重新分片并回填）、package、voices。`build-runtime.mjs`（去掉 CUDA 分支或保留为 dev-only）、`download-release-assets.mjs`（分片下载 + 合并 + 校验，参照 qwen 版的 resume/verify/verify-upstream）、`prepare-package.mjs`。
3. **setup 接入**：在 [scripts/setup.js](scripts/setup.js) 的 tasks 里加 `index-tts/download-release-assets.mjs`（`assetVerification: true`、`modelDownload: true`，product-docs 模式跳过）。可参考 Qwen 的做法加 `LS101_SKIP_INDEX_TTS_DOWNLOAD` 逃生阀。
4. **打包**：electron-builder.yml 增加 `externals/ai/index-tts/runtime` → `index-tts` extraResources（只含 CPU helper；模型不进安装包，走 setup 下载 + 模型包导入）。
5. **CI**：新写 `index-tts.yml`，结构照抄 [qwen-tts.yml](.github/workflows/qwen-tts.yml)：metadata（构建矩阵与版本校验）→ build（ubuntu-22.04 linux-x64 + windows-2022 win32-x64，**只建 cpu**，无需 cuda-toolkit/sccache，分钟级）→ model（下载分片、校验、出 manifest）→ release-runtime / release-model（不可变 tag，已存在即失败）。CUDA 构建如要保留，仅作为手动 dev workflow，产物不进 release。
6. **package.json**：加 `index-tts:build-runtime` / `index-tts:download` / `index-tts:prepare` 等脚本，与 qwen-tts 命名对齐。

### 阶段 2：应用侧 Provider（复用旧分支实现）

1. [packages/airouter/src/shared/types.ts](packages/airouter/src/shared/types.ts)：`AIRouterSpeechProviderType` 增加 `'index-tts'`（local 联合随之扩展）；不需要 del/2 的 RuntimeStatus/桥接那套（setup 分发后无应用内下载）。
2. 从 `del/feat` 分支平移三个文件（当时的实现含完整防御与测试）：
   - `packages/airouter/src/main/index-tts.ts`（IndexTtsSynthesizer：单 owner 队列、启动/合成/闲置超时、包删除阻塞）
   - `packages/airouter/src/main/index-tts-protocol.ts`（有界解码器）
   - `packages/airouter/src/main/index-tts-model.ts`（manifest 校验 + 参数归一化）
3. [packages/airouter/src/main/index.ts](packages/airouter/src/main/index.ts)：`localSynthesizers` 注册 `'index-tts'`；helper 路径解析对齐 Qwen（应用资源目录里的 `ls101-index-tts-helper-cpu`）。
4. [packages/airouter/src/main/speech-service.ts](packages/airouter/src/main/speech-service.ts)：manifest `runtime.engine === config.type` 校验天然覆盖新 engine；确认连接测试与 voice 列表路径（voices 来自 manifest，speaker-reference WAV 资产）。
5. 渲染层：[AIRouterSpeechSettingsPage.tsx](packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx) 增加 IndexTTS provider 类型（本地 Provider 表单：threads、language、maxTokens、seed 等参数 + 模型包导入 + 连接测试），参照 Qwen 区块。
6. 语音参考资产：沿用 `native/qwen-tts/voice-design/american-{man,woman}.wav` 作为默认音色（provenance 已记录）；后续可加更多参考音色（注意 IndexTTS **没有内置音色**，每音色都是一份参考 WAV 资产）。
7. 测试：旧分支的 `index-tts*.test.ts` 一并平移适配；集成冒烟按 AGENTS.md 用 `xvfb-run -a yarn test:smoke`。

### 阶段 3（可选，后置）：CUDA 实验路径

仅在原生运行时开发环境启用（同 Qwen 的历史 CUDA 构建文档定位）：本地 `--backend cuda` 构建 + `LS101_SKIP_INDEX_TTS_DOWNLOAD=1`，CUDA 12.8 工具链，产物**不进** release 与安装包。除非未来产品明确需要交互级速度，否则不把 CUDA 资产（约 1 GB DLL + 909 MB helper）纳入应用内下载。

### 需要的产品决策（建议默认值）

| 决策点 | 建议默认 |
| --- | --- |
| 采样率 | 保持 22050 Hz 输出，经现有 `speech-audio-transcoder` 归一到目标格式（与 Qwen 一致） |
| 量化 | q8_0（3.26 GiB；f16 4.24 GiB 无必要） |
| 语言参数 | 默认 `auto`，Provider 参数开放 zh/en/ja/es/ar（考试场景主要是 en） |
| 情绪/语速 | 首版**不暴露**情绪控制（旧 helper 就没接 Qwen emotion 模型，模型也小 199 MB→不适用；情绪走参考音频隐式传递）；`duration_scale` 可作为参数暴露（0.5–2.0，控制语速） |
| 与 Qwen TTS 的关系 | 共存：Qwen（0.6B、快、固定音色）做即时/预览；IndexTTS（0.8B、克隆、慢）做高质量考试音频批量生成 |

---

## 7. 风险与开放问题

1. **bilibili Model Use License**：条件商用（>10 亿元营收 / >1 亿 MAU 需授权；输出不得用于训练其他 AI 模型）。需要在 thirdparty-licenses 与用户文档中明示；若未来商业化规模接近阈值，联系 indexspeech@bilibili.com。
2. **TN 差异**：audio.cpp 的规则版文本正则化在数字/日期/邮箱/URL 等输入上可能与官方 Python 不同。**考试文本常含 "Question 1"、"2026"、"9:30"、价格等**——上线前必须用真实考试语料做朗读 QA（听 + 对比），必要时在应用层预归一化数字文本。
3. **CPU 性能**：实测 RTF ≈ 24–27（4 线程）。批量生成可用；交互场景明确不可用。UI 文案要设置预期（「生成约需 X 分钟」）。
4. **下载体积**：模型 3.26 GiB（分 4 片）+ helper（~8 MB）。学校机房首次部署要考虑网络；setup 已有断点续传。
5. **参考音色依赖**：无内置音色；默认音色复用 Qwen VoiceDesign 产物，若要扩充需新的 provenance 记录流程。
6. **上游演进**：audio.cpp 迭代很快（v0.9.1 距今一周）。pin 升级要走 `--verify-upstream` 流程并重测 TN 与质量；IndexTTS2.5-RL（WER 更低）未来出 GGUF 可作为模型升级选项。
7. **离线模式**：index_tts2 族 audio.cpp 标注 offline（无 streaming），对本应用无影响（考试音频都是完整文件）。

---

## 8. 附录

### 8.1 实测复现（本机）

```bash
cd externals/ai/index-tts/runtime-cpu/linux-x64
./ls101-index-tts-helper-cpu            # 无参启动 → "An absolute --model path is required"
# 协议冒烟：
printf 'SYNTHESIZE smoke1 <payloadLen>\n<json>' | \
  ./ls101-index-tts-helper-cpu --backend cpu \
  --model ../../models/index-tts2_5-q8_0.gguf --threads 4
# json = {"text":"...","voicePath":"/abs/path.wav","language":"en","maxTokens":1500,"seed":42}
# 响应：READY 1\n → RESULT smoke1 22050 <n>\n + n 字节 WAV
```

### 8.2 关键 pin（已验证）

- audio.cpp：`0xShug0/audio.cpp` @ `c7f5743f037d588049c63aa75e9b4fdb279cfe01`（旧分支 pin，真实存在；建议升级到 v0.9.1 标签后再 pin 新 commit）
- 模型：`audio-cpp/audio.cpp-gguf` / `IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf`
  size 3,502,955,328；sha256 `5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628`（与 HF LFS oid 一致）
- 本地 `externals/ai/index-tts/models/index-tts2_5-q8_0.gguf` 经 `sha256sum` 校验与上值一致。

### 8.3 参考

- IndexTTS 上游：<https://github.com/index-tts/index-tts>（README：特性、API、许可）
- IndexTTS-2.5 权重：<https://huggingface.co/IndexTeam/IndexTTS-2.5>
- audio.cpp：<https://github.com/0xShug0/audio.cpp>；模型文档 `docs/models/index_tts2.md`；许可表 `docs/model_licenses.md`
- audio.cpp GGUF：<https://huggingface.co/audio-cpp/audio.cpp-gguf>
- 本仓库参照系：[docs/engineering/qwen-tts.md](docs/engineering/qwen-tts.md)、[.github/workflows/qwen-tts.yml](.github/workflows/qwen-tts.yml)、[scripts/qwen-tts/assets.json](scripts/qwen-tts/assets.json)
