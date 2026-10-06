# TODO: IndexTTS 2.5 本地 TTS Provider 接入方案

> 状态：**路线已定**（2026-10-06）：`audio.cpp` 原生 helper + **fp16** 模型包（`index-tts2_5-f16.gguf`，4.55 GB）+
> **仅 CUDA**（放弃 CPU 档：模型过大，CPU 用户不纳入支持范围）
> 目标引擎 ID：`index-tts`
> 精度口径：fp16 权重（经实测几乎无损；不再提供 fp32/f32 包）

## 0. 实施进度

| #   | 事项                                                                                              | 状态                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 分支 `feat/index-tts-2.5`                                                                         | ⛔ **被环境阻塞**：`.git` 为只读挂载，需在宿主机执行 `git switch -c feat/index-tts-2.5`                                                                                             |
| 2   | 引擎标识 `'index-tts'`（provider 联合类型）                                                       | ✅ `shared/types.ts`                                                                                                                                                                |
| 3   | 三处硬编码白名单                                                                                  | ✅ `speech-service.ts`（校验 + 类型守卫）、`speech-model-store.ts`（`isRuntime` 引擎允许列表）                                                                                      |
| 4   | 设置页 Provider/模型包标签与本地选项                                                              | ✅ `AIRouterSpeechSettingsPage.tsx`                                                                                                                                                 |
| 5   | 合成器模块 `index-tts.ts` + `index-tts-protocol.ts` + 单测                                        | ✅ 会话键只含加载期身份；**运行时改为从模型包资产解析 + 应用侧摘要白名单（失败关闭）**；17 + 8 + 11 项单测                                                                          |
| 6   | 主进程注册（`main/index.ts` 的 `localSynthesizers['index-tts']` + dispose）                       | ✅                                                                                                                                                                                  |
| 7   | 计算后端选择（CPU/CUDA）：shared 类型 + 服务校验与持久化 + 设置页下拉/徽标                        | ✅（GPU 用户必需）                                                                                                                                                                  |
| 8   | 资产管线 `scripts/index-tts/*`、CI workflow、`electron-builder.yml`                               | 🚧 已定形：**运行时随模型包分发**（`runtime-helper`/`runtime-library` 资产 + 应用侧摘要白名单）；待落地脚本与 workflow                                                              |
| 9   | 许可材料                                                                                          | ✅ `LICENSE` / `LICENSE_ZH`（以中文为准）/ `DISCLAIMER` 已 vendor 进 `thirdparty-licenses/`（随 `extraFiles` 分发）；`licensing-audit.md` 已加 P1 条目；引擎文档已含 Licensing 一节 |
| 10  | 端到端验证（导入模型包 → 合成 22050 Hz WAV → 试听；试卷批量生成）                                 | ⏳ **依赖路线决策与 GPU 实验**                                                                                                                                                      |
| 11  | GPU 能力探针（计算能力 + 显存 + 驱动版本 → 判定可用性并提示 fp16）                                | ✅ 模块 `gpu-probe.ts` + IPC 链路 + 设置页展示/重新检测 + 10 项单测                                                                                                                 |
| 12  | **真实进程契约测试**（`native/index-tts/stub/helper-stub.cpp` 测试替身 + 环境变量门控的契约测试） | ✅ 3 项：真实 spawn 下校验 WAV（RIFF/WAVE、单声道、22050、16 bit、data 长度）、多请求串行复用同一进程、错误帧转中文报错                                                             |
| 13  | 原生 helper 实现 + 构建脚本                                                                       | 🟡 `native/index-tts/main.cpp`(1276 行) + `CMakeLists.txt` + `scripts/index-tts/build-runtime.mjs` 已就绪；协议层已用真实进程验证，**真实 CUDA 链接构建待 GPU 机器**                |
| 14  | 参考音色 + 溯源                                                                                   | ✅ 复用 qwen VoiceDesign 的合成音色（9.52 s / 10.88 s，24 kHz 单声道），含溯源清单，已 pin 进 `scripts/index-tts/assets.json`                                                       |
| 15  | ZIP64 打包器 + 分卷 + CI workflow                                                                 | ⏳ 设计已定（§5.1/§5.2），脚本未写                                                                                                                                                  |

已验证的基线：`yarn typecheck` 通过；`@ls101/airouter` 全项目 **17 文件 112 项**通过；`AIRouterSettingsPage` 16 项通过；改动文件 ESLint/Prettier 干净。

## 1. 目标与范围

为 airouter 增加第三个本地语音合成 Provider，与 `pocket-tts`、`qwen-tts` 并列：

- 能力：零样本音色克隆（参考音频）、多语言（zh/en/ja/es/ar）、情感控制、语速控制、发音标注
- 形态：完全离线，Windows x64 + Linux x64
- 契约：整段返回 PCM16 WAV、单声道、22050 Hz（正好落在现有 `concatWav` 约束内）
- 数据边界：模型包仍是纯数据 ZIP；可执行运行时走独立 runtime 产物

## 2. 上游事实（已核实）

### 2.1 官方 IndexTTS-2.5

| 项               | 值                                                                                                                                     | 来源                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| 版本 / 发布      | v2.5.0，2026-08-10 发布，commit `39207d91c3`                                                                                           | GitHub Releases API |
| 参数 / 语言      | 0.8B；zh、en、ja、es、ar（跨语言合成、音色-情感解耦）                                                                                  | 官方 README         |
| 能力             | 参考音频克隆、情感参考音频、8 维情感向量、文本情感（QwenEmotion）、`duration_factor` 0.5–2.0、`<文字\|发音>` 拼音/CMU/假名、长文本分段 | 官方 README         |
| 论文             | arXiv 2601.03888                                                                                                                       | 官方 README         |
| 官方 RTF（4090） | 2.5 bf16 0.20 / 2.5 fp32 0.21（长文本均值）                                                                                            | 官方 README         |

官方权重清单（HF API `?blobs=true` 实测）：

| 文件                                                             | 大小                      |
| ---------------------------------------------------------------- | ------------------------- |
| `gpt.pth`                                                        | 3,259,599,833 B (3.26 GB) |
| `qwen0.6bemo4-merge/model.safetensors`                           | 1,192,135,096 B (1.19 GB) |
| `codec.pth`                                                      | 607,290,935 B (607 MB)    |
| `s2mel.pth`                                                      | 414,908,601 B (415 MB)    |
| 其他（tokenizer.json 11.4 MB、feat1/feat2、tiktoken、config 等） | ≈ 13 MB                   |
| 小计（官方仓库）                                                 | ≈ 5.49 GB                 |

精度实测（解压 checkpoint 的 `data.pkl` 存储类核实）：`gpt.pth`、`codec.pth`、`s2mel.pth` 均为 **fp32**；
`qwen0.6bemo4-merge/model.safetensors` 为 **bf16**。即「官方 fp32」指的是三个主干 checkpoint。

首次运行还会自动下载辅助权重（不在官方仓库内，必须一并打包才能离线）：

| 辅助权重                                                              | 大小                      | 许可                         |
| --------------------------------------------------------------------- | ------------------------- | ---------------------------- |
| `facebook/w2v-bert-2.0` `model.safetensors`                           | 2,322,063,736 B (2.32 GB) | MIT                          |
| `nvidia/bigvgan_v2_22khz_80band_256x` `bigvgan_generator.pt` + config | 449,228,171 B (449 MB)    | MIT                          |
| `funasr/campplus` `campplus_cn_common.bin`                            | 28,036,335 B (28 MB)      | Apache-2.0                   |
| **离线可用的模型包合计**                                              | **≈ 8.29 GB**             | 宽松许可                     |
| （`amphion/MaskGCT` semantic_codec 177 MB）                           | 2.5 **不需要**            | **CC-BY-NC-4.0** ← 见 2.2(a) |

官方 Python 依赖（`pyproject.toml`，已核实）：

- `requires-python >=3.10,<3.12`
- `torch==2.8.*` / `torchaudio==2.8.*`，并且 uv 源**默认指向 `https://download.pytorch.org/whl/cu128`**（Linux/Windows 均装 CUDA 版 torch，无 CPU 索引配置）
- 其余重依赖：`transformers==4.52.1`、`modelscope==1.27.0`、`opencv-python`、`matplotlib`、`tensorboard`、`pandas`、`numba`、`keras==2.9.0`、`openai-whisper`、`descript-audiotools`、`jieba`、`g2p-en`、`fugashi`、`WeTextProcessing`(Linux)/`wetext`(其他)
- 可选：`deepspeed==0.17.1`、`flash-attn`、`torch.compile`

官方推理 API（`indextts/infer_v2_5.py`，已核实）：

```python
tts = IndexTTS2(cfg_path=..., model_dir=..., use_bf16=False, device=None,
                use_cuda_kernel=None, use_deepspeed=False, use_accel=False,
                use_torch_compile=False, use_qwen_emo=False)
tts.infer(spk_audio_prompt, text, output_path, lang, emo_audio_prompt=None,
          emo_alpha=1.0, emo_vector=None, use_emo_text=False, emo_text=None,
          use_random=False, interval_silence=200, verbose=False,
          max_text_tokens_per_segment=120, stream_return=False,
          more_segment_before=0, duration_factor=1.0, text_normalization=True,
          **generation_kwargs)
```

- `device='cpu'` 明确支持（自动关闭 bf16 与 CUDA kernel，官方提示 "Be patient"）
- 输出 22050 Hz；`use_emo_text=True` 需 `use_qwen_emo=True`（额外加载 1.19 GB Qwen0.6B 情感模型）
- 显存 <10 GB 时自动启用长文本分块（`low_vram`）

许可：**bilibili 模型使用许可协议**（非 OSI）。要点：保留协议全文与版权声明；下游同等约束；月活 >1 亿或年营收 >10 亿元人民币需另行授权；不得用输出改进其他 AI 模型（非商用除外）；禁止高风险场景默认部署。

硬件口径（官方模型卡）：需要 NVIDIA GPU、约 6 GB 显存；代码在显存 <10 GB 时自动启用长文本分块。官方**没有** Windows 一键包，只有 uv/pipx CLI 安装。

### 2.2 Python 路线的三个硬坑（已核实，直接影响能否商用/离线/可用）

**(a) CC-BY-NC 许可污染**：`indextts/utils/model_download.py::ensure_models_available()` 会**无条件**下载 4 个辅助模型，其中包含
`amphion/MaskGCT` 的 `semantic_codec/model.safetensors`（HF 卡面 license = **CC-BY-NC-4.0**，非商用）。
但 2.5 的推理路径（`infer_v2_5.py`）只使用 w2v-bert-2.0、campplus、bigvgan 三处，
`semantic_codec` 走的是模型自带的 `codec.pth`（bilibili 许可），**MaskGCT 权重对 2.5 是多余下载**
（仅旧版 `infer_v2.py` 使用）。风险在于：一旦触发自动下载，产物里就混入了 NC 授权权重。
→ 结论：商业分发必须**预置 `hf_cache/`**（w2v-bert-2.0 + campplus_cn_common.bin + bigvgan），
并保证 `ensure_models_available()` 永不执行。其余三个辅助权重均为宽松许可：w2v-bert-2.0 (MIT)、
funasr/campplus (Apache-2.0)、nvidia/bigvgan_v2_22khz_80band_256x (MIT)。

**(b) 离线安全**：`infer_v2_5.py` 第 4 行硬编码 `os.environ['HF_HUB_CACHE'] = './checkpoints/hf_cache'`
（**相对 CWD**，sidecar 必须 chdir 到模型根目录）；`indextts/utils/network_detection.py::need_proxy()`
在辅助模型缺失时会向 huggingface.co / modelscope.cn 做**实时 TCP 探测**。
→ 预置 `hf_cache/` 可同时消除这两个问题；否则离线机房会出现不可控的外网探测/超时。

**(c) 性能与安装体积**：

- CPU 可跑但**远慢于实时**：社区实测 IndexTTS-2 在 i9-1195H 上 RTF ≈ **37.6**（46.8 s 音频耗时 1761 s），
  即 1 秒语音约 38 秒计算；官方 RTX 4090 上 2.5 为 RTF ≈ 0.21。→ CPU 仅适合后台批处理，
  交互式使用必须 GPU。已知官方 issue #679：CPU 线程数会改变克隆结果，sidecar 必须**固定 `OMP_NUM_THREADS`**。
- torch 安装体积：PyPI 上 torch 2.8.0 Windows 轮子为 CPU-only 241.3 MB；Linux PyPI 轮子自带 CUDA 887.9 MB；
  若按官方默认 `cu128` 源，Linux 还会额外拉取 ~2.5–3.5 GB 的 `nvidia-*` 轮子（cudnn 674 MB、cublas 567 MB 等）；
  Windows CUDA 轮子则把 CUDA DLL 打进 `torch/lib`。
- 离线产品必须**预置固定版本的 wheel**，不能依赖 `download.pytorch.org` 实时解析（该索引历史上出现过静默失效）。
- `WeTextProcessing`（Linux 文本正则化）首次使用会往 **site-packages 写 tagger 缓存** → venv 必须可写，
  不能放在 `Program Files` 等只读位置。

相较之下，**路线 A（audio.cpp GGUF）把辅助权重打进 GGUF**，其发布方随包附带
`THIRD_PARTY_LICENSES/`（Amphion-MIT、BigVGAN-MIT、CAMPPlus-Apache-2.0、Qwen3-Apache-2.0、W2V-BERT-2.0-MIT，
**无 NC 条目**），从根上避开 (a)，且没有 Python 的 CWD/网络探测/线程数问题。

### 2.3 精度取舍（社区实测）

MNN 转换方系统性测量后**否决**了 int8/int4：int8/int4 BigVGAN SNR ≤15 dB（fp32 64.5 dB）、int8 CFM mel 离群、int8 CAMPPlus/semantic encoder 使 greedy argmax 仅 17% 命中、int8 GPT 35%、fp16 计算精度 ≤7%——结论是 **fp16 只能作为权重格式，不能作为计算精度**。这与本方案的 fp32 口径一致。

## 3. 候选集成路线

| #     | 路线                                           | 运行时                                        | 权重体积                                                                                      | CPU                                              | CUDA                                                      | 许可                                                      | 功能覆盖                                                                                                                              | 落地风险                                                                                                                                                                                                                 |
| ----- | ---------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **audio.cpp 原生 helper**（GGUF `orig`/`f16`） | C++/ggml，**有官方预编译二进制**              | orig **7.89 GB**（辅助权重已内嵌）/ f16 4.55 GB                                               | ✅                                               | ✅（CUDA 12.4/13.3/12.8）                                 | 运行时 Apache-2.0；权重 bilibili；**辅助权重宽松、无 NC** | 高（情感/语速/发音/分块全支持）                                                                                                       | 中：需引入 ggml+audio.cpp；文本正则化为 C++ 重写                                                                                                                                                                         |
| **B** | **官方 PyTorch sidecar**                       | 自带 CPython + 固定 wheel 的 venv + torch 2.8 | 5.49 GB + 辅助 2.80 GB = **8.29 GB**；另加 torch 环境 0.24–3.5 GB+                            | ⚠️ RTF≈38，仅批处理                              | ✅（torch 自带 CUDA 运行时）                              | BSD-3(torch) + bilibili 权重；**须规避 CC-BY-NC 下载**    | 100%（官方实现）                                                                                                                      | 中高：安装体积、离线预置、线程数一致性、venv 需可写                                                                                                                                                                      |
| **C** | ONNX fp32                                      | ONNX Runtime / `openvino-node`                | 实测 **≈10.9 GiB**（prefill 4.49 GB 与 step 3.96 GB **各存一份完整 GPT 权重**，白占 8.45 GB） | 慢（ORT CPU 端到端 RTF≈3.3，BigVGAN 占大头）     | ORT-node 的 CUDA EP 仅 Linux；OpenVINO 可走 Intel GPU/NPU | bilibili                                                  | **完全没有情感控制**（源码 docstring：QwenEmotion 与 emo-vector 两条路径都被移除，`emo_vec.onnx` 只是从参考音频隐式推情感）；无 es/ar | **高**：编排需 ~931 行 Python 移植到 TS（frontend 414 / pipeline 147 / dsp 139 / sampler 79 / protocols 73 / cfm 50 / features 20）；`onnxruntime-node@1.24.3` 无 `addInitializer`（共享权重各会话各存一份）与 IOBinding |
| **D** | vLLM 本地服务                                  | Python + vLLM                                 | 同 B + vLLM                                                                                   | ✖                                                | ✅                                                        | 同上                                                      | 官方                                                                                                                                  | **已排除**：recipe 要求 `vram_minimum_gb: 96`（H20/H200），安装 >13 GB，且 Stage 0 用普通采样而非官方 beam search，结果与官方不一致                                                                                      |
| **E** | MNN `fp32`/`fp16`                              | Python + pymnn（有 C++ API）                  | fp32 ≈7 GB（**bit-exact**，mel-SNR ≈70 dB）/ fp16 权重 ≈3.6 GB                                | ✅ **CPU 上比 ORT 好**：声码器约 6× 于 ONNX 构建 | ✖                                                         | bilibili                                                  | **同样完全没有情感控制**；无 es/ar                                                                                                    | 中：与"官方 fp32"口径最接近的 CPU 移植，但功能是残缺的                                                                                                                                                                   |
| **F** | 官方 TensorRT/Triton 后端                      | `backends/trt/`（v2.5.0 随仓，第三方代码）    | 同 B + TensorRT 引擎                                                                          | ✖                                                | ✅（最快，2.0 fp16 RTF 0.1365）                           | 待核（第三方论文代码）                                    | 官方                                                                                                                                  | 高：**2.5 尚无引擎**，需 tensorrt-llm 0.21.0 + 宿主 OpenMPI 4.x，实际仅 Linux                                                                                                                                            |

产品侧性能口径（重要）：本应用的 TTS 消费方是**试卷听力音频批量生成**
（`packages/renderer/src/features/templates/TemplateExamGeneration.ts:254-291`：逐段顺序合成、带进度、失败重试、可中断），
不是实时对话。因此评价标准是「一份试卷的批量耗时可否接受」，而不是单句延迟——
这使 CPU 方案在**预渲染**场景仍有讨论空间，但 RTF≈38 意味着 30 秒音频约需 19 分钟，仍应优先考虑 GPU。

### 3.1 能力矩阵：官方 vs 各移植版（决定路线取舍）

| 能力                                   | 官方 Python         | audio.cpp GGUF            | ONNX / MNN / MLX 移植 |
| -------------------------------------- | ------------------- | ------------------------- | --------------------- |
| 文本情感 `use_emo_text`（QwenEmotion） | ✔                   | ✔                         | ✘（明确移除）         |
| 情感向量 / 情感参考音频 / `emo_alpha`  | ✔                   | ✔                         | ✘                     |
| `duration_factor` 语速控制             | ✔                   | ✔                         | ✘                     |
| `<字\|拼音/CMU/假名>` 发音标注         | ✔                   | ✔                         | ✘                     |
| zh/en/ja/es/ar                         | ✔                   | ✔（es/ja 文本归一化有缺） | zh/en/ja/yue          |
| 长文本分段                             | ✔（token 预算分段） | 部分                      | ✘                     |
| 流式输出                               | ✔（代码级）         | ✘                         | ✘                     |
| CUDA Graph / torch.compile / DeepSpeed | ✔                   | ✘                         | ✘                     |
| `use_random` 情感原型随机              | ✔                   | 部分                      | ✘                     |

**结论**：如果产品要用情感/语速/发音标注/多语言，只剩 **A（audio.cpp）** 与 **B（官方）** 两条路；
移植版（ONNX/MNN）虽然体积小，但**功能是残缺的**。另：sherpa-onnx **不支持** IndexTTS；
无 OpenVINO 移植；`ThreadAbort/IndexTTS-Rust` 只有 BigVGAN+说话人编码器；CrispASR 仅支持 1.5。

### 3.2 推荐排序（调研结论）

1. **首选 A（audio.cpp 原生 helper）**：运行时 Apache-2.0、辅助权重内嵌且无 NC 条目、有 C ABI 与预编译二进制、
   CPU/CUDA 双后端、功能覆盖情感/语速/发音标注，最贴合本仓库「原生 helper + 数据型模型包」的既有形态。
   代价：需引入 ggml+audio.cpp（可用 `AUDIOCPP_MODEL_SET=custom --models=index_tts2` 裁剪）、Linux 需自建以维持 glibc 基线。
2. **备选 B（官方 PyTorch sidecar）**：唯一 100% 功能对齐（含流式、`use_random`、CUDA Graph/torch.compile），
   且有 `T8mars/indextts25-desktop-t8` 这一 Electron 先例可照抄（签名分卷运行时层 + HF 权重按需下载）。
   代价：+5–6 GB Python/torch 运行时、8.3 GB 权重、离线预置与 venv 可写性、CPU 不可交互。
3. **不建议**：C（≈10.9 GiB、**完全没有情感控制**、编排需 ~931 行 TS 移植、`onnxruntime-node` 无 `addInitializer`/IOBinding）、
   D（96 GB 显存）、E（MNN CPU 表现好但同样无情感控制）、F（2.5 无引擎、研究用途）。

工程上两条路的**应用侧改动完全相同**（引擎 id、白名单、IPC、manifest、测试），差异只在 helper 实现。
因此可以先落地应用侧脚手架 + 假 helper 的测试，再根据实验 0/1/2 的结果接入具体运行时，缩短关键路径。

已排查并排除的候选（避免重复调研）：

| 候选                                                 | 结论                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| sherpa-onnx                                          | **完全不支持 IndexTTS**（仅 7 个 TTS 家族；上游 issue/PR 搜索 `indextts` 命中 0）。继续只用于 ASR/VAD                                                                               |
| `ling0322/libwaifu`（Rust，MIT）                     | 全 fp32、1367M 参数，Win/Linux/macOS + CUDA/Vulkan/Metal；但**无 `duration_factor`、无拼音/CMU/假名标注、无 beam search、无流式**，10★、2026-09 新建，过于早期                      |
| `mercallureAI/local-multimodal-infra`（Rust）        | 只是 ONNX Runtime 宿主，本身不含 IndexTTS 实现                                                                                                                                      |
| `8b-is/IndexTTS-Rust` / `ThreadAbort/IndexTTS-Rust`  | 路线图里「完整 GPT + KV cache」未完成，且面向旧版                                                                                                                                   |
| `CrispStrobe/CrispASR`、`cstr/indextts-1.5-GGUF`     | 仅支持 IndexTTS-1.5                                                                                                                                                                 |
| `indextts.cpp` / `index-tts-ggml`                    | 不存在                                                                                                                                                                              |
| MLX / CoreML / OpenVINO                              | Apple 专属 / 无 Node 绑定 / ORT-node 无 OpenVINO EP                                                                                                                                 |
| DirectML                                             | 仅 Windows，且微软已转入 "sustained engineering"，DML 包停在 ORT 1.24.4                                                                                                             |
| DakeQQ `Text-to-Speech-TTS-ONNX`                     | 只是导出器（14 个图，默认 fp32 权重 + fp16 KV），运行期仍需 Python，可用来生产 fp32 ONNX                                                                                            |
| `vra/index-tts-2.5-onnx`                             | 空仓库，权重 URL 404，**勿用**                                                                                                                                                      |
| `openvino-node`（Intel 官方 Node addon，Apache-2.0） | 可作为**第二个 Node 侧 ONNX 运行时**（Win x86 + Linux x86/ARM，直接读 ONNX，自带 Electron e2e 测试）；但**没有任何 IndexTTS 导出在 OpenVINO 上验证过**，仅作为 C 路线的备选执行后端 |
| `RapidAI/RapidSpeech.cpp`                            | 完整的 IndexTTS-2 原生 C++/ggml，Windows/Linux CI 完善；**但只发 q4_k_m、没有 fp32 包，且仓库缺 GGUF 转换器 ⇒ 当前无法产出 fp32**。值得关注（最接近第二个 audio.cpp）               |
| `raoqu/index-tts-25-metal`                           | 8.44 GiB fp32、2.5 功能最全的移植之一、RTF 0.811；**但仅 macOS 且无许可证 ⇒ 不可用**                                                                                                |

### 路线 A 关键证据（audio.cpp，已实测）

- `--family index_tts2`，2.5 由模型 config `version` 字段选择；`--task tts|clon`，离线模式
- 精度可控：`--session-option index_tts2.weight_type=native|f32|f16|bf16|q8_0`（另有 `conv_weight_type`）
- 功能：`--voice-ref`、`--audio`（情感参考）、`emotion_vector`、`--emotion`/`use_emotion_text`（Qwen 情感）、`emotion_alpha`、`duration_factor`、`<文字|发音>`、`num_beams`/采样参数、`interval_silence_ms`、`mem_saver`、speaker/emotion 缓存
- 模型包（来自预编译包内 `model_specs/index_tts2.json`，**实机核对**）：
  `index_tts2_5_q8_0`（默认）/ `index_tts2_5_f16` / `index_tts2_5_orig`，**单文件自包含 GGUF**，下载源 `huggingface_snapshot: audio-cpp/audio.cpp-gguf`
- **`orig` 包已实测解析（HTTP Range 取头部 64 MB + 解析 GGUF 元数据/张量表）**：
  - GGUF v3，3790 张量，`general.architecture=audiocpp`，`audiocpp.weight_type=orig`，`audiocpp.model_spec.family=index_tts2`
  - **精度直方图：F32 × 3357、BF16 × 310、I64 × 123，无任何 F16/Q8 等量化类型**；
    BF16 全部落在 `qwen_emotion/model`（310 个），即原生 BF16 的情感分类分支 —— **与官方 checkpoint 精度完全一致**
  - **11 个 sidecar 已内嵌（16.0 MB）**：`config.yaml`、`multilingual_zh_ja_yue_char_del.tiktoken`(907 KB)、
    `qwen0.6bemo4-merge/{config,generation_config,tokenizer.json(11.4 MB),tokenizer_config,vocab,merges}`、
    `w2v-bert-2.0/{config,preprocessor_config}`、`bigvgan/config.json`
    → **模型包只需这一个文件，无外部 sidecar 依赖**，也不必再单独下发 tiktoken
  - 溯源元数据 `audiocpp.tensor_sources` 记录 10 个源 safetensors（gpt / s2mel / speaker_matrix / emotion_matrix /
    wav2vec2bert(\_stats) / semantic_codec / campplus / bigvgan / qwen_emotion）
  - **国内分发**：ModelScope 镜像 `HereIsMark/audio.cpp-gguf` 的 `index-tts2_5-orig.gguf` 同为 7,885,093,440 B，
    与 HF 侧一致，可直接作为国内下载源
- 质量证据：GGUF 验证矩阵中 **`orig` → "Pass (clean)"**，16-bit → "Pass (drift)"，q8_0 → "Pass (ASR match, drift)"；
  文本正则化有 50+ 例 golden corpus 对照官方 Python 归一化器
- **补丁/集成方式**：audio.cpp **没有 stdio/JSON-lines 协议**。可选：
  (a) 每个请求起一次 `audiocpp_cli`（模型重复加载，不可接受）；
  (b) `audiocpp_server` 长驻 HTTP（OpenAI 兼容 `/v1/audio/speech`，`lazy_load`、`max_loaded_models` LRU）；
  (c) `--request-sequence` 批处理会话；
  (d) **C ABI 动态库**（`libaudiocpp.so` / `audiocpp.dll`，SOVERSION 0，55 个导出符号，需 `-DAUDIOCPP_BUILD_C_API=ON`，
  含 `audiocpp_request_set_emotion`、`_set_option("duration_factor",…)`、流式拉取 API）→ **推荐用它写 `ls101-index-tts-helper`，复用现有 stdio 协议**
- 预编译运行时（v0.9.0，实测下载并核对 sha256）：`audiocpp_cli`(41.5 MB) + `audiocpp_server`(77 MB) + `audiocpp_gguf`(转换器) + `LICENSE` + 101 个 `model_specs/*.json`；CPU 包 47 MB（解压 ~133 MB）
- **Linux 兼容性坑**：CPU 与 CPU-portable 两个包都要求 **glibc ≥ 2.38 / GLIBCXX 3.4.32**（Ubuntu 24.04 构建），
  在 Debian 12（glibc 2.36）直接无法启动。而本仓库现有 CI 用 `ubuntu-22.04`（glibc 2.35）。
  → Linux 侧若要沿用现有基线，需**自行源码构建**（`AUDIOCPP_MODEL_SET=custom --models=index_tts2` 可裁剪）
- 官方 `.pth` 转换脚本：`tools/community_models/convert_index_tts2_5.py`，支持 `--native-dir` 直接产出可加载的 safetensors 目录；C ABI 头为 `include/audiocpp.h`（说明见 `docs/c_api.md`）
- 已声明差距：文本正则化为轻量 C++ 规则（非官方 OpenFst 语法），es 无 NeMo 归一化、ja 无 wakichi/fugashi 分词；官方侧 GPT/codec/S2Mel 在验证样例上 token 级一致

### 路线 B 关键证据（官方 PyTorch sidecar）

自包含 CPython 方案对比：

| 方案                                       | 体积                                         | 离线可用                                                          | 许可                                                         | 维护               |
| ------------------------------------------ | -------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------ | ------------------ |
| **python-build-standalone 前缀树（推荐）** | Python 本体 22–49 MB（stripped/未 stripped） | 构造上离线；CI 期用 `pip --no-index --find-links` 装 wheelhouse   | **MPL-2.0**（随包附 notice，并可提供 Covered Software 源码） | 低                 |
| uv 管理 Python + venv                      | uv 18–20 MB + 同上前缀树                     | 只要运行期不再调用 uv 即可                                        | MIT/Apache                                                   | 中（仅作 CI 工具） |
| PyInstaller one-file/one-dir               | 含 torch 的整棵树                            | one-file 每次启动解压到 `%TEMP%\_MEIxxxx`，多实例重复、崩溃不清理 | GPL-2.0 **含例外**，可商用                                   | 高                 |
| conda-pack                                 | 环境 + torch                                 | 需首次 `conda-unpack` 原地改写二进制                              | Anaconda ToS 风险（建议 conda-forge/miniforge）              | 高                 |
| ~~Nuitka~~                                 | —                                            | —                                                                 | **AGPL-3.0**，闭源产品应避免                                 | —                  |

- torch 安装体积：PyPI `torch 2.8.0` Windows 轮子 **241 MB（CPU-only）**、Linux 轮子 **888 MB（自带 CUDA）**；
  官方 `cu128` 源解析出的 torch+CUDA wheel 合计 **4.80 GB**（去重后 ≈3.9 GB），装完 venv ≈5–6 GB；
  **Windows CUDA 轮子把 CUDA DLL 打进 `torch/lib`**，推理无需系统 CUDA Toolkit
- 官方锁：`torch 2.8.0+cu128`、`transformers 4.52.1`、`tokenizers 0.21.0`、`numpy 2.2.6`、`.python-version`=3.11.13，共 189 个锁定包
- 可直接照抄的**现成先例**：`T8mars/indextts25-desktop-t8`（Electron！）——托管 CPython 3.10 + 整个 venv（torch cu128）作为**独立签名的 `runtime-v*` 层**，切成 <2 GiB 分卷，附 Ed25519 清单 + 每文件 SHA-256 + 回滚；权重不入安装包，按固定 HF revision 断点续传下载；本机 HTTP 服务 + GPU 租约 + 进程树回收
- 其他先例：ComfyUI Desktop（uv venv，装完验证 import，拒绝 OneDrive 路径）、Buzz（PyInstaller onedir + 可选 CUDA 环境）
- 关键坑：`HF_HUB_CACHE` 相对 CWD；`WeTextProcessing` 往 site-packages 写 tagger 缓存；CPU 线程数影响结果（issue #679）；Windows Defender 对冻结 exe 误报；孤儿进程需按进程树 kill；多 GB 卸载残留
- **运行时体积（实测 PyPI 尺寸，CPython 3.11）**：非 torch 依赖闭包压缩后 **Windows 307 MB / Linux 516 MB**，
  安装后约 **646 MB / 1,064 MB**（`unidic-lite` 一个就 260 MB）；再加 torch 轮子 230 MB（win CPU）/ 847 MB（linux CUDA）
  - Linux nvidia-\* 轮子 3–4 GB → **运行时 ZIP 约 0.6 GB(Win CPU) / 1.4 GB(Linux CPU) / 4.5+ GB(Linux CUDA)**
- **Linux glibc 底线抬到 ≥ 2.31**（`soundfile`/`tiktoken`/`sentencepiece`/`kaldifst`/`pynini` 等是 manylinux_2_27/2_28，`tensorboard-data-server` 2_31）
- **Windows 上不可用 `WeTextProcessing`**：它硬钉 `pynini==2.1.6`，而 pynini **没有任何 Windows 轮子** → 必须沿用仓库既有的
  「Linux 用 WeTextProcessing、Windows 用 wetext + kaldifst」分叉
- **首次使用的隐藏联网点**（真正气隙环境会失败）：`g2p-en` → `nltk.download(...)`；`librosa.util.example()` → pooch。
  需预热 `nltk_data` 进载荷，或直接删掉疑似 v1 遗留的 `g2p-en`
- **新增 LGPL 义务**：`soxr`(LGPL-2.1+)、opencv-python 轮子内含 FFmpeg(LGPLv2.1) 与 Qt5(LGPLv3) → 安装器 NOTICE 需覆盖
- 建议设计：`resources/python/python.exe -E -s -m ls101_index_tts_helper --session <cfg>` 长驻 +JSON 行协议 + 二进制 WAV 帧，
  启动握手返回 `{device, precision, modelVersion, auxFiles}`；启动时**强制校验 hf_cache 三件套**，
  置 `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` 并 chdir 到模型根目录，使 `ensure_models_available()` 不可达

**D 路线为何要 96 GB（已核对 vllm-omni 部署配置原文）**：96 GB 是 recipe 验证过的机器规格（1×H20），
不是模型需求 —— 官方 PyTorch 单用户仅需 ~6 GB。膨胀来自 serving 框架本身：
① `gpu_memory_utilization` 是**按卡总量比例预分配**，两个 stage 各 0.4 ⇒ 约 77 GB 的 KV cache 池；
② stage 1 的 `max_model_len: 32768` × `max_num_seqs: 4` ≈ 131k token 的缓存池（约 38 GB）；
③ 两阶段（AR GPT / CFM+vocoder）同卡并存，各有权重副本与编译产物；④ 全是并发取向配置。
另外其 Stage 0 用普通采样而非官方 `num_beams=3`，输出与官方不一致。

## 4. 与现有 airouter 架构的对接（复用 qwen-tts 模板）

必改的 5 处硬编码白名单（漏改会静默拒绝新引擎）：

1. `packages/airouter/src/shared/types.ts:3` — `AIRouterSpeechProviderType` 增加 `'index-tts'`
2. `packages/airouter/src/main/speech-service.ts:469-475`、`502-528` — 校验/类型守卫
3. `packages/airouter/src/main/speech-model-store.ts:649-659` — `isRuntime` 引擎允许列表
4. `packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx` — `providerLabels`、`modelPackageLabels`、本地 Provider 下拉项
5. 资产管线 `scripts/*` + `electron-builder.yml` + `.github/workflows/*` 中的引擎清单

其余新增（可选但推荐，与 qwen 对齐）：

- `packages/airouter/src/main/index-tts.ts`（+ 视实现方式新增 `index-tts-protocol.ts`）实现 `AIRouterLocalSpeechSynthesizer`
- `main/index.ts` 注册 `localSynthesizers['index-tts']`，`will-quit` 释放
- 测试：`__tests__/index-tts.test.ts`、`speech-service.test.ts` 本地分发、`speech-model-store.test.ts` 引擎过滤、`tests/integration/airouter.spec.ts` E2E
- 文档：`docs/engineering/index-tts.md`、`features/ai-router.md`、`thirdparty-licenses/LICENSE.bilibili-index-tts.txt`

零样本音色的建模方式（与 qwen 的 `.spk` 不同）：

- `voices[]` 直接引用**参考音频 wav 资产**（新增 asset kind，如 `voice-reference`；`kind` 字段在 manifest 中本就是自由字符串）
- `models[].parameters.synthesis` 承载：`weightType`、`language`、`emotionAlpha`、`durationFactor`、`numBeams`、`sample`/`temperature`/`topK`/`topP`/`repetitionPenalty`、`maxMelTokens`、`threads`
- manifest 草案：`runtime: { engine: 'index-tts', engineApiVersion: 1, minimumAppVersion: '<发版时按实际版本填写；当前应用版本 0.4.2>' }`

manifest 示例（路线 A：单文件 GGUF + 参考音色；路线 B 仅 `artifacts`/`assets` 的文件清单不同）：

```json
{
  "format": "ls101.tts-model-package",
  "formatVersion": 1,
  "package": {
    "id": "indextts-2.5-orig",
    "version": "1.0.0",
    "name": "IndexTTS 2.5 (f16)",
    "description": "IndexTTS 2.5 零样本克隆，zh/en/ja/es/ar，fp16 权重，CUDA。"
  },
  "runtime": { "engine": "index-tts", "engineApiVersion": 1, "minimumAppVersion": "0.5.0" },
  "assets": [
    {
      "path": "models/index-tts2_5-f16.gguf",
      "kind": "tts-model",
      "size": 4547355072,
      "sha256": "87bed9b82fc8f22119a1a1042332091016c28e37f29b0e93343ccdbfa76ef66a"
    },
    {
      "path": "voices/american-man.wav",
      "kind": "voice-reference",
      "size": 457004,
      "sha256": "1ae5ac5b80ba218a08441f623896368db080af2a47250fe979e7950b08ca7a66"
    },
    {
      "path": "voices/american-woman.wav",
      "kind": "voice-reference",
      "size": 522284,
      "sha256": "d84992242a33494813263e795d1bc401335b79dda96de6c829c3743bc15847ac"
    }
  ],
  "models": [
    {
      "id": "index-tts2.5-f16",
      "name": "IndexTTS 2.5 fp16",
      "languageCodes": ["zh", "en", "ja", "es", "ar"],
      "artifacts": { "tts-model": ["models/index-tts2_5-f16.gguf"] },
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
      "id": "american-man",
      "name": "American English Man",
      "languageCodes": ["en"],
      "files": ["voices/american-man.wav"]
    },
    {
      "id": "american-woman",
      "name": "American English Woman",
      "languageCodes": ["en"],
      "files": ["voices/american-woman.wav"]
    }
  ],
  "extensions": {
    "upstream": {
      "model": "IndexTeam/IndexTTS-2.5",
      "revision": "c39ce5ba981572cb187443877ff559dfb246ce63",
      "converter": "audio-cpp/audio.cpp",
      "converterRevision": "<固定提交>",
      "license": "bilibili-model-license"
    }
  }
}
```

> 参考音频要求：干净人声、≤15 s（官方推理会把参考音频截断到 15 s），建议 5–15 s。
> 与现有 qwen 的 `.spk` 不同，这里必须随包分发**真实音频文件**。
> **已解决**：直接复用 `native/qwen-tts/voice-design/` 里的原始参考音频（当初是用 Qwen3-TTS VoiceDesign 生成的
> **合成音色**，不是真人录音，因此不涉及 DISCLAIMER 2.2(f) 的真人声音授权问题）：
> `american-man.wav` 9.52 s / `american-woman.wav` 10.88 s，均 24 kHz 单声道 PCM16，
> 已复制到 `native/index-tts/voices/` 并附溯源清单（生成器版本、seed、prompt、sha256）。

会话与生命周期约束（沿用 qwen 约定）：同配置长驻单会话、请求串行化、启动超时 180 s、合成超时 600 s、最大文本 64 KiB、`AbortSignal` → `DOMException('Speech synthesis was aborted','AbortError')`、错误信息中文。

**IndexTTS 特有约束（已实现，勿退化）**：助手进程的会话键**只含加载期身份**（模型路径 + backend + `weightType` + `language` + `threads`）；
**参考音色与逐请求合成参数（`emotionAlpha`/`durationFactor`/采样参数/`maxMelTokens`）必须随每次请求传递**，不得放进 argv 或会话键。
原因：试卷生成会在 `man`/`woman` 两个音色间交替（`TemplateExamGeneration.ts`），若音色进会话键就会**每个音色各加载一份模型**
（fp32 7.89 GB × 2 ≈ 16 GB 显存 → 8 GB 显卡必 OOM），改一次 `durationFactor` 也会导致整模型重载。
即：**一个 (模型, backend) 一个进程，音色与参数按请求切换**（参考音频的编码成本远低于模型加载，官方实现本身也带 spk 缓存）。

### 4.1 落地清单（按依赖顺序，A/B 路线通用）

**A. 共享层**

1. `packages/airouter/src/shared/types.ts:3` 联合类型加 `'index-tts'`；如需后端选择再加 `AIRouterIndexTtsBackend`
   （照 `AIRouterQwenTtsBackend` 写），并在 `AIRouterSpeechProviderConfig`(348)/`...ConfigInput`(361) 加字段
2. `shared/types.ts:506-577`（Client）与 `579-650`（Bridge）加探针/附加方法；`shared/index.ts:37-39` 导出
3. `shared/constants.ts:17-30` 加 IPC 频道（命名 `airouter:<kebab-case>`）

**B. 主进程** 4. **新增** `packages/airouter/src/main/index-tts.ts`（+ 若走子进程协议则 `index-tts-protocol.ts`），实现
`AIRouterLocalSpeechSynthesizer`：会话池、请求串行化、超时、abort、WAV 校验 5. `packages/airouter/src/main/index.ts`：import(36)/export(46)/实例化(70)/注册 `localSynthesizers`(76-79)/
`will-quit` 释放(81)/探针 handler(178) 6. `packages/airouter/src/main/speech-service.ts`：`assertProviderConfigInput`(469-475)、`isProviderConfig`(502-528) 7. `packages/airouter/src/main/speech-model-store.ts:649-659`：`isRuntime` 引擎允许列表

**C. 预加载 / 渲染层** 8. `src/preload/index.ts:144-176` 桥接方法（探针在 174-176）9. `packages/airouter/src/renderer/index.ts:35-46` 客户端透传10. `packages/renderer/src/features/airouter/AIRouterApplication.ts:49-65,101-111` 接口 + 工厂 11. `AIRouterSpeechSettingsPage.tsx`：`providerLabels`(70-74)、`modelPackageLabels`(76-80)、本地下拉(483-487)、
后端徽标(299)、kind 默认值(446)、draft(56)、`createDraft`(1056-1070)/`fromConfig`/`toInput`/`isModified`

**D. 测试** 12. **新增** `__tests__/index-tts.test.ts`（照 `qwen-tts.test.ts` 注入假子进程：参数、会话复用、abort、校验）13. `__tests__/speech-service.test.ts:248-302` 本地分发；`speech-model-store.test.ts` 引擎过滤与 `minimumAppVersion`；
`main.integration.test.ts:65-80,199-201,218-222` mock 与 handler 14. `tests/integration/airouter.spec.ts:1546-1652` E2E（导入 ZIP → 选 Provider → 合成 → 断言无运行时写入 userData）

**E. 资产 / 打包 / CI** 15. **新增** `scripts/index-tts/assets.json`（runtime/model 双 release 固定 name+size+sha256）与
`download-release-assets.mjs` / `build-package.mjs` / `prepare-package.mjs` 16. `scripts/setup.js:13-26`、`package.json:40-45`（`yarn index-tts:*`）、`build.js:193-217` 17. `electron-builder.yml:140-150`（extraResources）、`157-161`（licenses）18. **新增** `.github/workflows/index-tts.yml`（runtime/model/both 分派、平台×后端矩阵、资产 <2 GiB 校验、不可变 tag）；
`.github/workflows/ci.yml:78-89,100-109,257-268,278-287` 的缓存路径与 hashFiles 键 19. **新增** `scripts/__tests__/build-index-tts-package.test.js`、`download-index-tts.test.js`；
`thirdparty-licenses/LICENSE.bilibili-index-tts.txt`（+ `LICENSE_ZH` 与 DISCLAIMER）；
**新增** `docs/engineering/index-tts.md`；更新 `features/ai-router.md`、`docs/engineering/licensing-audit.md`

**验收标准（端到端）**

- 设置页可选择 `index-tts`、导入模型包、合成出 22050 Hz 单声道 PCM16 WAV 并试听
- 试卷听力批量生成可跑通（逐段、可中断、失败重试），无网络访问
- 缺少模型包 / 缺少运行时 / 引擎不匹配时给出中文明确报错，且不写入 userData 之外的路径
- 引擎白名单、manifest 校验、`minimumAppVersion` 门控均有单测覆盖

## 5. 资产与分发（已定：GitHub Release 分卷）

### 5.1 打包实现要点（运行时随包后新增）

模型包 = **权重 GGUF（4.55 GB）+ helper（+ CUDA 库）+ 参考音色**，因此打包链路有两个新问题：

1. **>4 GiB ZIP**：`scripts/qwen-tts/build-package.mjs` 的 fflate 路径有 4 GiB 硬上限，本包约 5.4 GB 会直接抛错。
   → 需要 **ZIP64 store-only 写入器**（GGUF 压缩收益极低，store 更快）：逐条目写 local header + 数据 + CRC，
   最后写 central directory 与 ZIP64 EOCD；仅当确需 deflate 时才用 Node `zlib`。
   读取侧无需改动：`speech-model-store` 用的 yauzl 支持 ZIP64，现有单资产 10 GiB / 单包 20 GiB / 归档 24 GiB 上限足够。
2. **分卷**：GitHub Release 单资产上限 2 GiB。
   → 把**同一个 ZIP 按字节切片**为 `part-000`、`part-001`…（不改 ZIP 内部结构），附 `volumes.json`
   （`index`/`name`/`size`/`sha256`/`totalBytes`/`archiveSha256`）；`scripts/download-asset.js` 扩展为
   「多卷下载 → 逐卷校验 → 顺序合并 → 整体 sha256 校验」后落盘。这样应用内导入路径（yauzl 读单个 .zip）完全不变。

### 5.2 发布流程（CI，`.github/workflows/index-tts.yml`）

**两步式**（因为白名单在应用里，第一次必须先把摘要取回来）：

```
① workflow_dispatch: mode=digest
   矩阵（ubuntu-22.04→linux-x64 / windows-2022→win32-x64）× CUDA 12.8.1
   → 只构建 CUDA helper，不下载权重、不出包
   → 把摘要与「要粘贴的白名单代码块」写进 GitHub Step Summary
   → 附件：该平台的 helper 二进制，便于本地实验

② 把摘要提交进 packages/airouter/src/main/index-tts-runtime.ts

③ workflow_dispatch: mode=package [, publish=true]
   → 严格白名单闸门（未命中直接失败，避免发布应用拒绝执行的包）
   → 下载并校验 GGUF（HF 主源 → ModelScope 回退，每次比对 pin）
   → 生成 manifest.json（runtime-helper / runtime-library / tts-model / voice-reference，各带 size+sha256）
   → ZIP64 store-only 打包 → 按 <2 GiB 切片 + volumes.json
   → publish=true 时校验 tag 未被占用并发布 index-tts-model-v<ver>
```

**缓存策略**（首跑慢、复跑快）：

| 层             | 手段                                                          | 说明                                                                                                                            |
| -------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 编译对象       | `mozilla-actions/sccache-action` + `SCCACHE_GHA_ENABLED=true` | 走 GitHub Actions 缓存后端，**跨运行**复用 nvcc/gcc 产物；`build-runtime.mjs` 已把 `SCCACHE_PATH` 接到 C/CXX/CUDA 三个 launcher |
| audio.cpp 检出 | `actions/cache@v4`，键 = pinned revision                      | blobless clone，省一次网络往返                                                                                                  |
| CMake 构建树   | `actions/cache@v4`，键 = OS + revision + CMakeLists/脚本哈希  | 需 `LS101_INDEX_TTS_KEEP_BUILD=1` 才不删构建目录（已作为 workflow 级 env）                                                      |
| 权重 4.5 GB    | **不缓存**                                                    | 每次按 pin 校验下载（分钟级），避免占用仓库 10 GB 缓存配额                                                                      |

> 白名单在应用里是这条设计的固有代价：**白名单变更必须发应用版本**（已知并接受）。

体积 vs 现有上限：

| 限制                                | 值                                      | 影响的候选                                           |
| ----------------------------------- | --------------------------------------- | ---------------------------------------------------- |
| GitHub Release 单资产               | 2 GiB（CI 强制）                        | 所有候选都超                                         |
| `build-package.mjs` fflate 打包上限 | 4 GiB                                   | GGUF orig 7.89 GB / f16 4.55 GB、官方路线 8.29 GB 超 |
| 应用内导入                          | 单资产 10 GiB、单包 20 GiB、归档 24 GiB | 各候选均可导入                                       |

分卷方案要点：

- **单层产物（2026-10-06 决策变更）**：**运行时随模型包分发**，不再作为独立 runtime release。
  包内新增资产类型 `runtime-helper`（`ls101-index-tts-helper-cuda[.exe]`）与 `runtime-library`（CUDA DLL/so），
  通过 `models[].artifacts['runtime-helper']` 按 `<platform>-<arch>` 与 backend 选择。
  **安全边界调整为「白名单摘要」**：应用内置允许的 helper 摘要（`软件里只保存哈希`），
  只有命中的 helper 才执行——包内自述的 sha256 不是安全边界（恶意包可以自洽）。
  **Windows 不要求 Authenticode 签名**（已确认）：代码里硬编码的 sha256 是唯一闸门，且失败关闭
  （白名单为空 / 平台未知 / 摘要不符 => 拒绝 spawn）。代价：**更新运行时必须发应用版本**。
  `features/ai-router.md` 的纯数据约束已加例外说明；pocket-tts/qwen-tts 不受影响。
  包体积因此约 5.2–5.4 GB（权重 4.55 GB + helper + CUDA 库），仍在 10 GiB/资产、20 GiB/包的上限内
- 每卷 <2 GiB，附卷清单（`index`、`name`、`size`、`sha256`、`totalBytes`）；建议照抄
  `T8mars/indextts25-desktop-t8` 的做法：整体 manifest 用 **Ed25519 签名** + 每文件 SHA-256 + 回滚点
- `scripts/download-asset.js` 目前只支持单文件 Range 续传，需扩展为「多卷下载 → 逐卷校验 → 合并 → 整体 sha256/签名校验」
- `build-package.mjs` 需支持流式/分卷产物（当前 4 GiB 直接抛错，提示改用 Q8_0）
- 发布渠道沿用现有 `yarn setup` + GitHub Release；国内镜像可指向 ModelScope（GGUF 已有镜像）
- CUDA 运行时按需下发：与 `TODO-qwen-tts-cuda-runtime.md` 的 bundle 设计合并实现（NVIDIA DLL 签名 + 摘要校验 + 独立搜索路径），主安装包仍只带 CPU
- 若走 B：`runtime` 层含 CPython 前缀树 + wheelhouse 安装结果（CPU 版与 CUDA 版是两个不同 ZIP），
  首次运行需磁盘预检（≈8.3 GB 权重 + 5–6 GB 运行时）、许可/notice 确认页；运行期禁止调用 uv/pip

## 6. 已决策（2026-10-06）

1. **运行时路线 = A（audio.cpp 原生 helper）**：Apache-2.0 运行时、辅助权重内嵌、功能面完整（情感向量 + 文本情感 +
   `duration_factor` + 拼音/CMU/假名）、有 C ABI 与预编译二进制可参照。
2. **精度 = fp16**：`IndexTTS2.5-GGUF/index-tts2_5-f16.gguf`，4,547,355,072 B，
   HF LFS sha256 `87bed9b82fc8f22119a1a1042332091016c28e37f29b0e93343ccdbfa76ef66a`（ModelScope 镜像同尺寸）。
   不发布 fp32/f32 包；int8/int4 永不进入交付选项。
3. **后端 = 仅 CUDA**：CPU 用户不纳入支持范围（8.3 GB 级权重与 RTF≈38 对 CPU 不现实）。helper 仍保留 `--backend cpu`
   以便开发调试，但 UI 默认为 CUDA 并标注 CPU"仅供调试，不受支持"。
4. **分发 = GitHub Release 分卷**（用户已定）：单包 4.55 GB 超过 4 GiB fflate 上限与 2 GiB 单资产上限，
   需分卷 + 卷清单（见 §5）。

由此产生的**待办变化**：

- 不需要 f32/f16 双包自动选择；GPU 探针固定推荐 fp16，仅按显存给出"偏紧"提示（已实现）
- Linux 侧仍需自建（glibc 基线）；Windows 侧预编译包只有 CUDA 12.4（不支持 sm_120）与 CUDA 13.3（需 R580+），
  要同时覆盖 4060(sm_89) 与 5080(sm_120) 且降低驱动门槛 → **自建 CUDA 12.8/12.9 helper**
- 仍需 GPU 探针做驱动/算力门禁（已实现：<7.5 算力或 <R570 驱动直接拒绝）

## 7. 建议的下一步

- **实验 0（阻塞决策）**：在带 NVIDIA GPU 的 Windows 机器上用 audio.cpp v0.9.0 CUDA 二进制 + `index-tts2_5-orig.gguf`，
  以 `weight_type=f32` 跑通中英文各一条，记录 RTF / 峰值显存 / 听感 / 与官方 PyTorch 输出的对比
  （精度与自包含性已在第 3 节用 GGUF 解析核实，无需重复）。
  参考：RTX 5090 长文本 CUDA RTF 0.332（audio.cpp 自家基准）
- **实验 1**：同机 CPU 基线（`--backend cpu`），记录 RTF，判断 CPU-only 是否可接受
- **实验 2**：官方 PyTorch（cu128 / CPU）同文本同参考音频对照，确认 C++ 端文本正则化差异是否可接受
- **实验 3（离线合规）**：在断网环境用预置 `hf_cache/` 三件套启动官方路径，验证 `ensure_models_available()`
  与 `need_proxy()` 均不被触发、且 `amphion/MaskGCT` 未落盘（`find` 校验）
- **实验 4（Linux 基线）**：在 Ubuntu 22.04（glibc 2.35）上确认 audio.cpp 预编译包不可用后，
  用 `AUDIOCPP_MODEL_SET=custom --models=index_tts2` 源码构建并跑通，测量二进制体积与构建时长
- 实验通过后再进入编码：先落 `index-tts.ts` + 白名单 + 测试，再落资产管线与分卷分发
- 许可材料与 `docs/engineering/licensing-audit.md` 更新与实现同步进行（**必须同时分发 `LICENSE` 与 `LICENSE_ZH.txt`**，
  并在安装器/EULA 中传递 bilibili 协议与 DISCLAIMER 的合成语音使用限制）

## 9. 硬件分档与精度差异（面向 5080 / 4060 / CPU 用户）

### 9.1 架构支持矩阵（NVIDIA 官方文档核实）

| 架构                                                                 | 计算能力 | 首个支持的 CUDA | 对应显卡        |
| -------------------------------------------------------------------- | -------- | --------------- | --------------- |
| Blackwell                                                            | 12.0     | **CUDA 12.8**   | RTX 5080 / 5090 |
| Ada                                                                  | 8.9      | CUDA 11.8       | RTX 4060        |
| （CUDA 13.0 起移除 CC<7.5 的离线编译支持：Maxwell / Pascal / Volta） |          |                 |                 |

**直接后果**：audio.cpp 现成的 Windows `cuda12.4` 包**不支持 RTX 5080**（12.4 < 12.8），
只有 `cuda13.3` 包可用（要求 R580+ 驱动）；`cuda12.8/12.9` 自建可同时覆盖 sm_89 + sm_120 且驱动门槛更低（R570+）。
→ **自建 helper 同时解决"5080 兼容"与"Linux glibc 基线"，是最优解**。

### 9.2 硬件分档（决策后：仅 CUDA + fp16）

| 档位   | 硬件           | 组合                                                    | 预期性能                    | 关键约束                                                                                       |
| ------ | -------------- | ------------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------- |
| **T1** | RTX 5080 16 GB | audio.cpp helper + **`f16`(4.55 GB)** + 自建 CUDA ≥12.8 | RTF ≈ 0.2–0.33，显存 ~6 GB  | **必须 CUDA ≥12.8**（预编译 12.4 不支持 sm_120）；驱动 **R570+**                               |
| **T2** | RTX 4060 8 GB  | 同上                                                    | RTF ≈ 0.3–0.4，显存 ~5–6 GB | 4.55 GB 权重 + 激活在 8 GB 内可行；显存 <7 GB 时提示偏紧并自动长文本分段                       |
| —      | CPU-only       | **不支持**                                              | —                           | 模型规模与 RTF（官方路径约 38）决定 CPU 不在支持范围；helper 保留 `--backend cpu` 仅供开发调试 |

配套要求（已实现/待实现）：

- ✅ **GPU 探针**已实现：算力 <7.5 或驱动 <R570 直接判定不可用；可用时**固定推荐 f16**，仅在显存 <7 GB 时提示偏紧
- ✅ 不再需要 f32/f16 双包自动选择；只发布 `f16` 一个模型包
- ⏳ 运行时只发 CUDA；按需 CUDA bundle（`TODO-qwen-tts-cuda-runtime.md`）从"可选"变为**必需**
- ⏳ 自建 helper（CUDA 12.8/12.9）以同时覆盖 sm_89(sm_120) 并降低驱动门槛；Linux 侧同时解决 glibc 基线

### 9.3 精度差异（本项目实测数据）

先区分三件事：**权重存储精度 / 计算精度 / KV cache 精度**。

| 精度                 | 体积           | 实测                                                                                                                                            | 结论                       |
| -------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| fp32                 | 7.89 GB        | 基准；官方 4090 RTF 0.2060                                                                                                                      | 质量上限；本方案口径       |
| bf16                 | ~4.6 GB        | 官方 RTF 0.2065，与 fp32 同速                                                                                                                   | 只省显存；官方推荐         |
| **fp16（仅权重）**   | 4.55 GB        | greedy token 完全复现 73/73、83/83；声码器 mel-SNR 26–29 dB（门限 25 dB）                                                                       | **几乎无损**，可作权重格式 |
| **fp16（参与计算）** | —              | argmax 翻转，token 匹配 **≤7%**                                                                                                                 | **灾难性，禁用**           |
| int8                 | 3.50 GB (q8_0) | ONNX 动态 QInt8：GPT 仅 26% token 匹配；MNN：BigVGAN SNR ≤15 dB（fp32 64.5 dB）、编码器 17%、GPT 35%；ORT int8 MatMulNBits cos 0.985 **且更慢** | 质量崩塌                   |
| int4                 | —              | MNN int4 BigVGAN **−1.4 dB（纯噪声）**                                                                                                          | 不可用                     |
| fp8                  | 无             | 无任何 IndexTTS 2.5 移植提供                                                                                                                    | 不考虑                     |

**TTS 比聊天 LLM 脆的三条机理**：

1. 自回归 + argmax 的**误差累积**：声学 token 翻转一次，后续韵律/发音轨迹整体跑偏
2. 声码器是**生成式上采样**而非分类器：int8 使 SNR 从 64.5 dB 掉到 ≤15 dB，直接可听
3. 情感/音色条件是**小幅连续向量**，int8 偏移足以改变音色与情绪

**交付档位（已决策）**：只发布 **fp16 权重**包。依据是实测——fp16 仅作权重格式时 greedy token 完全复现（73/73、83/83）、
声码器 mel-SNR 26–29 dB（听感门限 25 dB），属于"几乎无损"；而 fp32 包（7.89 GB）对 8 GB 显卡不可用、体积翻倍却无听感收益。
int8/int4 一律不进入交付选项（声码器 SNR ≤15 dB、int4 为 −1.4 dB 纯噪声，GPT token 匹配仅 26–35%）。

## 10. 参考

- 官方仓库：https://github.com/index-tts/index-tts
- 官方许可：https://raw.githubusercontent.com/index-tts/index-tts/main/LICENSE
- 官方权重：https://huggingface.co/IndexTeam/IndexTTS-2.5 ｜ https://modelscope.cn/models/IndexTeam/IndexTTS-2.5
- audio.cpp：https://github.com/0xShug0/audio.cpp ｜ IndexTTS 指南：`docs/models/index_tts.md`
- GGUF 模型：https://huggingface.co/audio-cpp/audio.cpp-gguf ｜ ModelScope 镜像：https://modelscope.cn/models/HereIsMark/audio.cpp-gguf
- MNN fp16/fp32 与量化否决结论：https://huggingface.co/yunfengwang/IndexTTS-2.5-mnn ｜ https://pypi.org/project/index-tts-2.5-mnn/
- ONNX fp32（bit-exact）：https://huggingface.co/yunfengwang/IndexTTS-2.5-onnx
- ONNX fp16：https://huggingface.co/ModaLeap/indextts-2.5-onnx
- vLLM recipe（96 GB 显存，已排除）：https://recipes.vllm.ai/IndexTeam/IndexTTS-2.5
- TensorRT 后端（2.5 无引擎）：https://raw.githubusercontent.com/index-tts/index-tts/v2.5.0/backends/trt/README.md
- 官方许可中文版（§9 以中文为准）：https://raw.githubusercontent.com/index-tts/index-tts/v2.5.0/LICENSE_ZH.txt
- Electron + Python sidecar 先例：https://github.com/T8mars/indextts25-desktop-t8
- 自包含 CPython：https://github.com/astral-sh/python-build-standalone（MPL-2.0）
- 仓库内相关：`packages/airouter/src/main/qwen-tts.ts`、`scripts/qwen-tts/`、`.github/workflows/qwen-tts.yml`、`TODO-qwen-tts-cuda-runtime.md`
