# IndexTTS 2.5 runtime 与模型包

IndexTTS 沿用 Qwen 的模型包、AI Router、原生 helper 和资产准备流程。一个
`IndexTtsSynthesizer` 管理一个 helper 和有界串行队列；helper 只固定模型，参考 WAV
随每次请求传入。同一模型的不同提供方和音色共享权重。本轮先实现 IndexTTS，Qwen 的
CPU helper 和固定音色行为保留。

应用目标是 Linux x64、Windows x64 的 NVIDIA CUDA 推理。CPU 构建用于原生开发验证，
应用不会选择 CPU helper。当前运行时发布尚未完成；本容器已完成 Linux CPU 构建、
真实 Q8_0 推理和模型 ZIP 生成，CUDA、Windows、显存与听测验收仍待对应环境完成。

## 固定资产

唯一资产清单是 [`scripts/index-tts/assets.json`](../../scripts/index-tts/assets.json)。
它固定 audio.cpp 提交、vendored GGML tree、模型 revision、GGUF 大小和 SHA-256，
以及参考音频、来源记录和摘要。

| 资产                     | 固定版本                                                           |
| ------------------------ | ------------------------------------------------------------------ |
| audio.cpp                | `c7f5743f037d588049c63aa75e9b4fdb279cfe01`                         |
| vendored GGML tree       | `5191d4c73bdae6762f0b8df17904c144d6525b07`                         |
| IndexTeam/IndexTTS-2.5   | `c39ce5ba981572cb187443877ff559dfb246ce63`                         |
| audio-cpp/audio.cpp-gguf | `9c78726d0d2cf7ee8511e68ef003490c1251062f`                         |
| GGUF                     | `index-tts2_5-q8_0.gguf`，3,502,955,328 字节                       |
| GGUF SHA-256             | `5e827b2072042e4a1b21ccf24a5cb4f71cb1011403067a0a9b039311d8b38628` |

默认男、女参考音频来自清理后 Qwen 的 VoiceDesign 素材，文件和来源记录仍位于
`native/qwen-tts/voice-design/`。IndexTTS 包保存 WAV、来源 JSON 和许可信息，
不包含 Qwen 模型或 speaker embedding。素材目前标为英文；中文、英文推理已经生成
有效 WAV，参考音色与发音质量需要听测。

## 构建原生运行时

需要 Git、CMake 3.20 或以上、Ninja、C++17 编译器和 Node.js 22 或以上。CUDA 构建
另需 CUDA Toolkit；CI 选择 CUDA 12.8.1、Ubuntu 22.04 和 Windows Server 2022/MSVC。
源码构建目录为 `externals/ai/index-tts/downloads/`。脚本检查固定提交和 GGML tree，
只接受仓库内的上游补丁；有其他源码修改时拒绝构建。

CUDA CI 沿用 Qwen 的 sccache，将 C、C++、CUDA 编译器产物写入 GitHub Actions
缓存。每个可缓存的编译单元完成后即写入，不依赖整个 job 成功；后续测试或打包失败
不会撤销已经写入的条目。job 的 post 步骤显示缓存命中、写入及写入错误统计。首次
构建仍需编译；缓存服务限流或写入失败可能减少后续可复用的条目。此缓存不包含
CUDA Toolkit 安装包或完整运行时发布资产。本地设置 `SCCACHE_PATH` 可启用同一
编译器 launcher；未设置时直接使用编译器。

Windows CI 固定 sccache 0.18.0，包含 [nvcc 转义引号解析修复](https://github.com/mozilla/sccache/pull/2811)，
用于处理上游 `engine_runtime` 的字符串宏；Linux CI 使用 0.17.0。CI 设置
`SCCACHE_IDLE_TIMEOUT=0`，避免超过默认 10 分钟的 CUDA 编译导致服务退出、丢失
当前统计和正在处理的编译请求。

Linux CUDA 构建示例：

```bash
export INDEX_TTS_CUDA_REDIST_DIR=/usr/local/cuda-12.8/lib64
export INDEX_TTS_CUDA_LICENSE_FILE=/usr/local/cuda-12.8/EULA.txt
yarn index-tts:build-runtime --backend cuda
```

Windows 在 x64 Visual Studio Developer 环境中执行同一 Yarn 命令，设置
`INDEX_TTS_CUDA_REDIST_DIR` 为 Toolkit 的 `bin`。脚本从 `VCToolsRedistDir` 解析
`x64/Microsoft.VC143.CRT`；也可显式设置 `INDEX_TTS_MSVC_REDIST_DIR`。
`INDEX_TTS_CUDA_LICENSE_FILE` 可指向对应版本的 NVIDIA EULA 文本或 HTML。

CUDA helper、`audiocpp`、cuBLAS/cuBLASLt、CUDA runtime、cuFFT、nvJitLink、许可证和
构建元数据写入 `externals/ai/index-tts/runtime/<platform>-x64/`。实际目标文件由
CMake 提供，避免复制旧构建留下的库。完成构建和依赖暂存后再替换整个平台目录，
失败时保留先前的运行库。主进程为 Linux helper 设置相邻库目录的搜索路径；Windows
使用相邻 DLL 和 PATH。NVIDIA 驱动由目标系统提供。

原生 CPU 验证：

```bash
yarn index-tts:build-runtime --backend cpu
```

CPU 产物位于独立的 `externals/ai/index-tts/runtime-cpu/<platform>-x64/`，不会覆盖
CUDA 共享库，也不会进入应用资源。两种构建均执行 CTest 的 WAV 编解码检查。
`build-<backend>.json` 记录源码、GGML、实际编译器、CMake、CUDA 架构和构建选项。

## 下载、打包和导入

显式准备模型包：

```bash
yarn index-tts:prepare
```

它下载固定 revision 的 GGUF，校验大小和摘要，然后流式生成
`dist/index-tts-2.5-q8_0-0.1.0.zip`。已有模型可直接打包：

```bash
yarn index-tts:build-package
yarn index-tts:download --models-only --verify
```

`--verify` 强制重算摘要，`--verify-upstream` 另外查询发布/Hugging Face 元数据。
普通 setup 使用固定清单和已验证缓存，下载工具支持断点续传。模型包使用现有
`ls101.tts-model-package` v1，保存一份 GGUF、多份参考 WAV、来源记录和许可证，
不包含可执行文件。生成器在写入前检查 ZIP 的 4 GiB 限制；F16 超过此限制，当前
交付选择 Q8_0。

GitHub Release 单文件必须小于 2 GiB。模型发布脚本将 GGUF 切为 1 GiB 的有序分片，
记录各片和整模型摘要；下载逐片校验，再按顺序流式重组、校验整模型并原子替换。
导入 ZIP 内始终是一份完整 GGUF。生成发布产物：

```bash
node scripts/index-tts/model-release.mjs --output dist/index-tts-model-release
```

输出目录必须尚不存在，以免覆盖先前发布资产。当前清单已经记录本地分片实测的
`modelRelease.parts` 大小和 SHA-256；真正上传 Release 后，先核对每个远程资产与
这些值一致，再设置 `modelRelease.published=true`。启用前仍从固定 Hugging Face
revision 下载完整 GGUF。

在应用的“设置 → AI 引擎 → 语音合成”中添加本地 Provider，选择
“IndexTTS 2.5 (CUDA)”，导入 ZIP、启用模型和音色，然后测试合成。男女角色路由、
试听、格式转换和取消使用已有语音入口。导入存储所在磁盘需要约 3.8 GiB 可用空间，
生成 ZIP 所在磁盘另需约 3.3 GiB；二者可以在不同磁盘。

运行库随应用位于 `resources/index-tts/<platform>-x64/`，模型和 WAV 由现有内容寻址
存储安装到数据目录。`content-addressed-gguf.patch` 让固定上游按 GGUF 文件头识别
无扩展名的资产，而非只依据 `.gguf` 扩展名。

## helper 和请求生命周期

helper 直接链接 audio.cpp C API，启动时创建 registry、model 和 session。
启动参数包括模型路径、后端、设备、线程和 low-memory；每次请求创建新的 request，
解码参考 WAV 后设置 voice audio，输出音频并释放 request/result。
speaker、emotion、emotion-text 缓存各限制为一个槽位。

主进程复用标识为模型资产实际路径、设备、线程和 low-memory，不包含音色、提供方、
语言、seed 或 maxTokens。同一模型的 A → B → A 请求保持同一进程；加载配置或模型
变化时，先确认旧 helper 退出再启动新的 helper。默认最多 32 个排队请求，空闲
5 分钟后释放进程；模型加载、推理和退出等待分别有上限。

排队取消只移除该请求；活动请求或加载取消会结束 helper 并等待退出。正常请求错误
保留已加载模型，协议错误、无效输出、崩溃和超时使会话失效。旧 helper 未能退出时
拒绝后续加载，避免同时占用两个模型。

模型包删除暂停队列并取消该包的请求，确认 helper 退出后删除文件。模型导入可能
覆盖已安装版本，因此每次语音模型导入会暂停并取消 IndexTTS 请求、释放 helper，
然后更新存储。多个更新串行执行，失败后恢复队列。应用退出拒绝新请求、取消排队
和活动请求，并等待文件更新及 helper 清理完成。

协议为有界 stdio，stdout 只承载协议，诊断写 stderr：

```text
READY 1\n
SYNTHESIZE <id> <jsonBytes>\n<UTF-8 JSON>
RESULT <id> <sampleRate> <wavBytes>\n<mono PCM16 WAV>
ERROR <id> <messageBytes>\n<UTF-8 message>
```

JSON 包含 `text`、`voicePath`、`language`、`maxTokens` 和可选 `seed`。参考 WAV
支持 PCM16/24/32 或 float32、单/双声道、8–192 kHz，最多 30 秒和 32 MiB。
文本上限 64 KiB、JSON 512 KiB、协议头 4 KiB、结果 100 MiB、stderr 缓冲 16 KiB。
Windows 使用二进制 stdio 和 UTF-8/Unicode 路径。

模型 parameters 可设置 `load.{device,threads,lowMemory}` 和
`synthesis.{language,maxTokens,seed}`。语言允许 `auto/zh/en/ja/es/ar`，默认 auto。
当前包只声明中文、英文；其他语言以及情绪/语速控制需要单独验收或后续接入。

## 验证与发布状态

原生真实验证：

```bash
yarn index-tts:test-runtime --backend cpu
# 在有 CUDA 运行库和 NVIDIA GPU 的环境中：
yarn index-tts:test-runtime --backend cuda
```

脚本使用同一 PID 完成男 → 女 → 男，以固定 seed 检查前后男声结果摘要一致，
保存 WAV、启动时间、推理时间和 Linux RSS 到
`dist/index-tts-validation-<backend>/`。输入 GGUF 复制为无扩展名的 SHA-256 文件名，
覆盖应用真实资产命名方式。helper 使用独立 OS 临时目录，退出后删除上游展开的
tokenizer/config。

2026-10-09 重启后 Linux CPU 实测：模型就绪 9.7 秒，三次短句分别约 57、64、54 秒；
输出 22050 Hz，RSS 约 2.8 GiB，峰值约 3.4 GiB。两个固定 seed 男声 WAV
完全相同。CPU 结果说明模型与协议链路可运行；GPU/显存、长时间多音色切换、两平台
离线首次推理、Windows 中文路径和音质尚未完成验收。

应用和脚本检查：

```bash
yarn typecheck
yarn vitest run --config packages/airouter/vitest.config.ts
yarn test:scripts
xvfb-run -a yarn test:smoke
xvfb-run -a yarn test:playwright:electron --workers=1
```

2026-10-09 本容器的最终结果：

| 检查                                     | 结果                                             |
| ---------------------------------------- | ------------------------------------------------ |
| TypeScript、改动文件的 ESLint 与格式检查 | 通过                                             |
| AI Router Vitest                         | 18 个文件、119 项通过                            |
| 脚本测试                                 | 85 项通过                                        |
| Linux CPU helper 构建与 CTest            | 通过                                             |
| Electron smoke                           | 14 项通过                                        |
| 完整 Electron 回归                       | 85 项通过；真实 IndexTTS 大包、CUDA 用例默认跳过 |
| 真实 Q8_0 ZIP 的 Electron 导入与删除     | 单独启用导入用例，1 项通过；CUDA 用例跳过        |
| 真实 GGUF 分片与流式重组                 | 大小与整模型 SHA-256 一致                        |

原生三次真实推理的 WAV 和机器可读结果保存在
[`dist/index-tts-validation-cpu/report.json`](../../dist/index-tts-validation-cpu/report.json)。
模型 ZIP 为 3,503,965,197 字节；大包导入在 OS 临时 profile 和默认模型数据目录中
通过，之后已删除测试所拥有的模型数据。

真实 CUDA Electron 验证需先构建 CUDA 运行库、生成模型包并执行 `yarn build:test`，
然后运行：

```bash
LS101_TEST_INDEX_TTS_CUDA=1 xvfb-run -a yarn test:playwright:electron tests/integration/index-tts.spec.ts
```

只验证真实大文件包导入与删除、不执行推理：

```bash
LS101_TEST_INDEX_TTS_IMPORT=1 \
LS101_TEST_INDEX_TTS_DATA_ROOT=/path/to/fsync-capable-volume \
  xvfb-run -a yarn test:playwright:electron tests/integration/index-tts.spec.ts
```

`LS101_TEST_INDEX_TTS_DATA_ROOT` 同样适用于 CUDA 测试；它只指定独立模型数据目录，
Electron profile 仍使用 OS 临时目录。模型数据路径必须位于支持原子 rename 和目录
fsync 的文件系统；每个测试创建并清理自己拥有的子目录。本容器的 `/workspace`
共享挂载在大文件导入时不支持所需的 `fsync`，因此实际导入验证使用 OS 临时目录。

此测试通过打包应用的真实 UI/IPC/存储/合成入口生成 A → B → A。未显式启用时跳过；
启用后缺少模型、运行库或 GPU 会失败。进程与权重复用由原生验证和适配器测试覆盖，
WAV 听测需要人工完成。磁盘充足且支持 symlink 的目录可通过 `LS101_TEST_TEMP_ROOT`
指定；它必须同时满足 Electron profile 的 SingletonLock 要求。

[IndexTTS Assets workflow](../../.github/workflows/index-tts.yml) 支持分别构建 runtime、
model 或两者，默认只上传构建产物。发布选择创建独立、未使用过的 prerelease 标签。
平台 manifest 记录每个文件的大小和 SHA-256，Linux 检查共享库依赖，Windows 检查
DLL 依赖。

目前 `runtimeRelease.published=false`、`assets=[]`，没有填写未经构建的运行库摘要；
`modelRelease.published=false`，但四个分片的本地 SHA-256 已固定。普通 setup 保留
本地运行库并报告尚未发布；自动完整构建暂不生成 IndexTTS ZIP，显式
`index-tts:prepare` 可执行。完成两平台 CUDA 验收并上传实际产物后，将平台 manifest
和 Release 分片摘要写入资产清单，再启用对应的 `published`。运行库、模型发布和本地
模型包版本各自独立。当前未触发远程 workflow 或发布资产。

完整的设计约束见 [重写方案](index-tts-rewrite-plan.md)。
