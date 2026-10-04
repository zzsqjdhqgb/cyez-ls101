# 许可合规排查：eSpeak / GPL 残留

排查对象：分支 `refactor/test/textpa`（本文写于 HEAD `3638ea95`；合并前的最终 HEAD 为 `dba204f`，
第 6 节记录了此后已落地的处置）。第 1 节的 P0 已在 `dev` 分支上定案并落地，见 1.5。
仓库根 `LICENSE` 为「保留所有权利」的专有许可，不是 GPL/AGPL，因此任何 GPL 组件的引入都需要单独评估。

## 结论（先看这里）

1. **是，本分支随包分发的产物里确实含 GPL 的 eSpeak NG 机器码。** 位置是一处，而且不在自有代码里：
   生产依赖 `sherpa-onnx-node@1.13.6` 的预编译库
   `node_modules/sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so`
   **把 eSpeak NG 静态编译了进去**（详见第 1 节）。`electron-builder.yml` 会在 Linux / Windows / macOS
   三个平台把该库打进安装包。
   **该 P0 已处置**：改用上游 `SHERPA_ONNX_ENABLE_TTS=OFF` 的 no-tts 变体，产品内不再含 eSpeak（1.5）。
2. **自有代码和自有资产没有被污染。** 仓库历史中从未出现 eSpeak 的源码、二进制或数据文件；
   自己的模型资产（39 个 CMU/ARPAbet token 的 `vocab.json`）与 eSpeak 无关；产品代码里没有
   `espeak`、`phonemizer`、`piper`、`g2p` 的构建或运行调用。
3. **eSpeak 作为研究工具只存在于 `textpa/`**，经 GPL-3.0 的 Python 包 `phonemizer` 调用系统 `espeak-ng`；
   既不是 vendored 代码，也不进入打包产物。
4. 另外发现两处与 eSpeak 无关、但风险不低于它的许可问题：
   **随包发布的 `ffmpeg-static` 是 GPL-3.0-or-later 且当时未附许可证文本**（第 4 节，许可证与
   carve-out 已补，对应源码仍未闭合），以及**当前发音模型没有任何署名/许可文件**（第 5 节）。
   第 4 节与第 1 节性质不同：FFmpeg 是**独立程序**（仅 CLI 子进程调用），不污染自有代码，
   只需合规打包；eSpeak 是静态链进同一个 `.so`，只能铲除。

## 1. 唯一的 eSpeak 污染点：sherpa-onnx 预编译库

### 1.1 证据

```bash
S=node_modules/sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so     # 5,101,472 B

nm --defined-only "$S" | grep -E 'espeak|Espeak|eSpeak'
#   00000000002e2740 t espeak_Initialize.constprop.0
#   000000000032e830 t espeak_ListVoices.constprop.0.isra.0
#   00000000002adca0 t espeak_SetVoiceByName
#   00000000002d5540 t espeak_TextToPhonemesWithTerminator.constprop.0
#   00000000002ae740 t espeak_ng_PrintStatusCodeMessage
#   00000000002b7cd0 t _ZN5piper16phonemize_eSpeakE...
#   00000000002d5150 t _ZN11sherpa_onnx19CallPhonemizeEspeakE...
#   00000000004111a0 b ...espeak_mutex

nm -u "$S" | grep -i espeak           # 空：没有任何 eSpeak 符号是"外部导入"
readelf -d "$S" | grep NEEDED         # 只有 libpthread/libonnxruntime/libdl/libm/libstdc++/libgcc_s/libc
                                      # 没有 libespeak-ng，也没有 dlopen 目标
```

符号是**已定义的局部符号**（`t`/`b`），且 `NEEDED` 里没有 `libespeak-ng` —— 说明 eSpeak NG 不是链接或
`dlopen` 进来的共享库，而是**编译进了这个 `.so` 的机器码**。库内还有 27～52 条 eSpeak NG 自己的字符串：

```
%s/espeak-ng-data                     Failed to initialize espeak-ng with data dir: %s. Return code is: %d
ESPEAK_DATA_PATH                      The espeak-ng library has not been initialized
/tmp/espeakXXXXX                      Wrong version of espeak-ng-data
Use espeak-ng to handle the OOV: '%s' Failed to phonemize '%s' with espeak-ng voice '%s': %s
```

它被实际加载：`ldd node_modules/sherpa-onnx-linux-x64/sherpa-onnx.node` →
`libsherpa-onnx-c-api.so => /workspace/node_modules/sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so`。

### 1.2 为什么会漏

`strings sherpa-onnx.node | grep -i espeak` 会得到 58 条命中，但全部是
`OfflineSpeakerDiarization` / `SpeakerEmbedding` 里 `...neSpeak...` 的**大小写误报**；同一个目录下的
`libsherpa-onnx-c-api.so` 才是真正含 eSpeak 的文件。只用 `sherpa-onnx.node` 判定会得出错误结论，
必须用 `grep -E 'espeak_|espeak-ng|ESPEAK|libespeak'` 这类严格模式逐个文件扫。

同一类误报在后续核查中又出现过两次：`grep -ci 'tts|espeak|piper'` 会命中
`OfflineSpeakerDiarization`，`grep -i piper` 也会命中 `OfflineSpea**ker**...` 之外的同形子串。
现在的判定改用 `scripts/sherpa-no-tts-assets.json` 里以 `espeak`/`piper` 为核心的 marker，
并要求归一化后仍能区分 `Speaker`（见 `scripts/__tests__/sherpa-no-tts.test.js`）。

### 1.2.1 eSpeak 是怎么进 npm 包的（上游原因）

npm 平台包与 GitHub Release 资产是**两条独立流水线**，产物不同源：

- `sherpa-onnx-node` 本身只有 59,654 B / 19 个文件，是纯 JS；所有原生库都在
  `sherpa-onnx-{linux,win,darwin}-{arch}` 平台包里（linux-x64 解包 32.7 MB）。
- 平台包**没有任何 `install` / `postinstall` 脚本**，安装时不会再去下载任何东西——
  也就是说 `yarn install` 从不访问 GitHub Release。
- 平台包由 `.github/workflows/npm-addon-*.yaml` 构建，其 cmake 命令行
  （Linux 在 `quay.io/pypa/manylinux2014_x86_64` 内）**没有设置 `SHERPA_ONNX_ENABLE_TTS`**，
  于是取 `CMakeLists.txt` 的默认值 `ON`，`include(espeak-ng-for-piper)` 照常执行。
- 官方 Release 另行成套提供 `no-tts` 变体，正是 `SHERPA_ONNX_ENABLE_TTS=OFF` 的产物
  （`include(espeak-ng-for-piper)` 与 `include(piper-phonemize)` 都不会执行）。

这解释了为什么两边二进制不同源：darwin 的 `libonnxruntime.dylib` / `libsherpa-onnx-c-api.dylib`
在 npm 与 Release 间哈希不同；而 **Linux / Windows 的 `libonnxruntime` 恰好逐字节相同**
（`c85f471e…` / `b9f6713c…`），所以这两个平台只换 C API 库一个文件即可。

### 1.3 影响面

`electron-builder.yml` 中与该库有关的打包配置：

```
asarUnpack:  - node_modules/sherpa-onnx-*/**            # :73
linux.files: from node_modules/sherpa-onnx-linux-${arch}  filter: '**/*'   # :129-131
win.files:   from node_modules/sherpa-onnx-win-${arch}    filter: '**/*'   # :85-87
mac.files:   from node_modules/sherpa-onnx-darwin-${arch} filter: '**/*'   # :109-111
```

`packages/airouter/src/main/qwen3-asr-worker.ts` 在运行时 `require` 该依赖，所以平台原生包必然随包发布。
本机只装了 `sherpa-onnx-linux-x64`；Windows / macOS 的同名库当时无法在本机验证，现已按 1.5 的方式
分别核对（Windows x64 已纳入替换并校验；macOS 未纳入，构建入口也不支持 macOS）。

注意：应用只用到 sherpa-onnx 的**语音识别**，eSpeak 属于其 **TTS（piper）前端**，本应用并不调用；
`espeak-ng-data` 数据目录也没有随包发布，所以这段代码在运行时其实跑不起来。
但这不改变许可结论：**分发即触发 GPLv3 义务**，而 `sherpa-onnx-linux-x64/package.json` 只声明了
`Apache-2.0`，`thirdparty-licenses/` 里也没有任何 eSpeak / GPL 通知。

### 1.4 处置选项（含一处此前的误判）

1. **换成不含 TTS 前端的 sherpa-onnx 构建（已采纳）。** 上游成套提供 no-tts 变体，本应用只需要
   ASR，去掉 TTS 即可让 eSpeak NG 完全不出现在产物里。
2. ~~若必须继续使用官方预编译包，则按 GPLv3 履行义务：附 GPL-3.0 文本与源码获取方式。~~
   **这条此前列为可选处置，实际不可行**：仓库根 `LICENSE` 是专有许可，明确禁止他人复制、修改、
   分发与运行，而 GPLv3 要求分发者授予接收方这些权利且不得附加额外限制。二者不可能同时成立，
   随附许可证文本只解决"提供副本"，解决不了"不得附加额外限制"。**对专有项目而言，唯一出路是
   产物里不含 GPL 代码。** 这条对第 4 节的 `ffmpeg-static` 同样成立。
3. 无论选哪条，都应保留一份书面记录（谁在何时核对了哪个版本的构件）。

### 1.5 已落地的处置：替换为上游 no-tts 变体

选 1.4 第 1 条，按平台逐个处理，只覆盖实际会构建的 `win-x64` 与 `linux-x64`
（`build.js` 的 `BUILD_PLATFORMS` 只有 `win`/`linux`，CI 分别在 `windows-latest` 与
`ubuntu-latest` 上出包，两者都是 x64）。

| | 替换前（npm 平台包） | 替换后（上游 no-tts） |
| --- | --- | --- |
| linux-x64 `libsherpa-onnx-c-api.so` | `1cc4d26c…f841d9`，5,101,472 B | `a2950d46…ba13e`，3,606,240 B |
| win-x64 `sherpa-onnx-c-api.dll` | 随平台包分发 | `36fc4bed…a05a07`，3,234,816 B |
| eSpeak 特征串 | 16 条 | **0** |
| eSpeak/piper 符号 | `espeak_Initialize`、`phonemize_eSpeak`、`CallPhonemizeEspeak`、`InitEspeak` 等 | **0** |
| `libonnxruntime` | — | **不改**，与 npm 包逐字节相同 |

替换是安全的，因为两者同为 sherpa-onnx 1.13.6，C API 版本一致；且 no-tts 构建**仍然导出全部
12 个 `SherpaOnnx*OfflineTts*` 入口**（行为变为 "TTS is not enabled. Please rebuild sherpa-onnx"），
所以 `sherpa-onnx.node` 需要的 C API 符号零缺失。运行时已用真实 addon 验证：加载、
构造 Silero VAD、`acceptWaveform` 全部通过。

落地件：

- `thirdparty-libs/sherpa-onnx-no-tts/`：上游 no-tts 变体的 C API 库（未修改的上游构建产物）。
- `scripts/sherpa-no-tts-assets.json`：钉死归档与成员的 size + SHA-256，以及判定用的 marker。
- `scripts/sherpa-no-tts.js`：把仓库内副本原子替换进平台包；不可覆盖的平台包直接报错。
- `scripts/vendor-sherpa-no-tts.js`：升级时重新取件，`--check` 可离线核对仓库内副本。
- `scripts/setup.js`：替换排在任务列表第一位，紧跟依赖安装。
- `build.js`：出包前调用硬闸，未通过则拒绝构建。
- `thirdparty-licenses/LICENSE.sherpa-onnx-no-tts.txt`（Apache-2.0 全文）与
  `thirdparty-licenses/NOTICE.sherpa-onnx.txt`（来源、替换原因、上游版本）。

之所以必须挂在 `yarn install` 之后自动执行：npm 平台包是自包含 tarball，yarn 重新解包会把文件
还原成含 eSpeak 的版本。手工替换活不过下一次安装，因此 `setup.js` 负责修复、`build.js` 负责拦截。

未覆盖的平台（`darwin-*`、`linux-arm64`、`win-ia32`）**故意不静默通过**：只要这样的平台包出现在
`node_modules` 里，`assertNoGplSherpaPackages()` 就会让构建失败，并提示补充清单项或不要在该平台出包。


## 2. 自有代码与资产：干净

- `git grep -il -e espeak HEAD` 的命中全部落在 `textpa/` 研究目录、文档与陈旧路径上；
  `git log --all -S "espeak_Initialize"` / `-S "espeak_Synth"` 为空，
  `-S "espeak_ng"` 只命中 textpa 记录版本号的提交 —— 733 个提交里从未加入过 eSpeak 代码。
- 运行时资产 `externals/ai/pronunciation/model/charsiu-en_w2v2_ctc_libris_and_cv-int8/vocab.json`
  （403 字节）＝ 39 个无重音 CMU/ARPAbet token + `[SIL]`、`[UNK]`、`[PAD]`，与
  `.model-sources/pronunciation/tokenizer/vocab.json` 一致；不再是 eSpeak 的 IPA 词表。
- 其余随包二进制严格扫描均为 0 命中：`ffmpeg-static/ffmpeg`、`onnxruntime_binding.node`、
  `qwen3-tts/runtime/**/ls101-qwen-tts-helper-cpu*`、`resources/tts/ptts_wasm_bg.wasm`。
- 系统层面：本机未安装 `espeak` / `espeak-ng`，也不存在 `espeak-ng-data`、`phondata`、`phonindex` 等文件。
- `externals/` 与 `.cache/` 均被 `.gitignore` 忽略，模型权重从不入库。

## 3. eSpeak 时代的残留（不是 GPL 代码，但应清理）

| 位置 | 性质 |
| --- | --- |
| `packages/grading-engine/src/pronunciation.ts:174-180` | `resolveBlankTokenId` 仍接受 eSpeak 词表的 `<pad>` / `[pad]` 拼写 |
| `packages/grading-engine/src/pronunciation.ts:505-508` | 仍保留「39 个 CMU 音素一一映射到 canonical IPA token」的旧词表模式 |
| `packages/grading-engine/src/__tests__/pronunciation.test.ts`（12、74、120、137、155、208、228 行） | 上述兼容路径的测试 |
| `features/ai-router.md:84` | 文档仍在描述「早期多语言 eSpeak 词表仍被兼容识别」 |
| `.gop-research/run_current_pronunciation.mjs:9`、`.gop-research/exam/filter_pronunciation_feedback.mjs:138` | 硬编码已删除的 `facebook-wav2vec2-lv-60-espeak-cv-ft-int8` 目录 |
| `thirdparty-licenses/LICENSE.facebook-wav2vec2-lv-60-espeak-cv-ft.txt` | 旧模型的许可文件，仍随安装包发布 |
| `pronunciation-report-666666.md:4`、`textpa/SIDE_CONVERSATION_HANDOFF.md` | 历史报告，仍以旧模型描述引擎 |
| `externals/ai/.setup-verification/pronunciation-model.json` | 旧模型的本地校验状态（vocab 4637 B / onnx 317 MB），新流程已不再读它 |

`textpa/` 内的 eSpeak 使用属于研究复现：`textpa/requirements-cpu.txt` 钉住 `phonemizer==3.4.0`，
运行时需要系统 `espeak-ng`（`textpa/src/textpa_repro/doctor.py:21` 会检测）。
`textpa/SIDE_CONVERSATION_HANDOFF.md:71` 已经记录了「eSpeak NG 是 GPL-3.0-or-later，需要按 GPLv3
第 13 节处理」的工程判断 —— 这次排查说明：**产品侧真正引入 GPL eSpeak 的不是那条研究链，而是
sherpa-onnx 的预编译库。**

## 4. ffmpeg-static：随包发布的 GPL-3.0 组件（部分已处置）

### 4.1 性质：与 eSpeak 不是一回事

**FFmpeg 是独立程序，不是衍生作品。** 它只以子进程方式通过标准 CLI 调用
（`packages/airouter/src/main/pronunciation-assessment-service.ts:237`、
`speech-audio-transcoder.ts:16`、`speech-recognition-service.ts:554` 解析路径后交给 Worker 执行），
既不链接也不合并。因此 GPL 的传染性**不蔓延到自有代码**，自有许可与 FFmpeg 的 GPLv3 可以并存。

这与第 1 节的 eSpeak 有本质区别：eSpeak 是**静态编译进** `libsherpa-onnx-c-api.so` 的机器码，
那个 `.so` 本身就是衍生作品，所以只能铲除；FFmpeg 需要的只是**合规打包**。

### 4.2 事实

- `node_modules/ffmpeg-static/package.json`：`"version": "5.3.0"`、`"license": "GPL-3.0-or-later"`；
- 二进制自报：`ffmpeg version 7.0.2-static https://johnvansickle.com/ffmpeg/`，
  `configuration: --enable-gpl --enable-version3 --enable-static ... --enable-libx264 --enable-libx265 ...`；
  `ffmpeg.README` 亦写明 "This static build is licensed under the GNU General Public License version 3."；
- 包**确实提供了**许可证文本：`LICENSE`（在 npm tarball 内）与 `ffmpeg.LICENSE`、`ffmpeg.README`
  （由 `install.js` 从 release 资产一并下载）。两份 GPLv3 仅差 FSF 地址的 http/https。
- 随包发布：`electron-builder.yml:56` 白名单只放行
  `node_modules/ffmpeg-static/{index.js,package.json,ffmpeg,ffmpeg.exe}`，**三份许可证/说明文件全部被挡在
  安装包之外**（已实测 `dist/linux-unpacked` 内只有 `ffmpeg`、`index.js`、`package.json`）。

也就是说，**问题不在上游，而在本仓库的打包白名单**。

### 4.3 已落地的处置

| GPLv3 §6 义务 | 处置 | 状态 |
| --- | --- | --- |
| 随附许可证全文 | `thirdparty-licenses/LICENSE.ffmpeg.txt` + `README.ffmpeg-build.txt`（与 release 资产逐字节校验一致） | ✅ |
| 不得施加额外限制 | 仓库根 `LICENSE` 新增「第三方组件 / Third-party components」一节，明确 FFmpeg 为独立程序、按 GPLv3 授权、不受本许可约束 | ✅ |
| 提供对应源码（Corresponding Source） | 见 4.4 | ❌ **未闭合** |

`thirdparty-licenses/NOTICE.ffmpeg.txt` 记录了版本、完整 configuration、精确的 release 资产 URL、
独立程序声明，以及源码状况。

### 4.4 未闭合项：对应源码

GPLv3 §6 要求接收方能够取得**与该二进制对应**的源码。这一条目前无法诚实声明为已完成：

- **版本对不上**：`ffmpeg-static@5.3.0` 声明 `binary-release-tag: "b6.1.1"`，该 release 标题为
  "ffmpeg 6.1.1 binaries"，但它给 linux-x64 的资产实际是 **FFmpeg 7.0.2**
  （johnvansickle 的构建跟踪一个滚动 release）。实际版本只能从二进制自身读取。
- **上游明确不提供**：`ffmpeg-static` 的 README 写明
  "Please consult the individual build's project site for exact source versions"。
- **构建方也没有**：johnvansickle 的 `release-source/` 与 `git-source/` 最新只到
  **ffmpeg-4.1 / 2018-11-10**，对不上 7.0.2。
- **还叠了一层**：该二进制静态链接 30+ 个第三方库，其中 `libass-git`、`libvpx-git`、`libvidstab-git`
  等连 commit 都未钉死。

因此 §6 只能部分满足（FFmpeg 本体源码可指 `https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz`，
各链接库需回到各自上游），**这是已知的、被记录在案的风险，不是已解决项**。

**收尾办法**：自行从官方源码编译 FFmpeg（只保留实际用到的音频能力），构建脚本入库、源码自持，
§6 即可完全闭合，且体积可小于当前的 79.8 MB（现二进制绝大部分是我们用不到的编解码器）。
在这之前，本仓库不应对外声称 FFmpeg 部分已完全合规。

## 5. 发音模型的许可与署名缺口

- 随包模型 `charsiu/en_w2v2_ctc_libris_and_cv`：Hugging Face 仓库**没有声明 license**
  （`https://huggingface.co/api/models/charsiu/en_w2v2_ctc_libris_and_cv` 无 `cardData.license`、
  无 `license:` 标签）；作者代码仓库 `github.com/lingjzhu/charsiu` 为 MIT；底模
  `facebook/wav2vec2-base` 为 Apache-2.0。
- `thirdparty-licenses/` 与扩展包 ZIP 内**都没有**该模型的任何许可或署名文件。扩展包
  （`scripts/build-pronunciation-extension-package.mjs:19-24`）只打包 `config.json`、
  `preprocessor_config.json`、`vocab.json`、`onnx/model_quantized.onnx` 与 `manifest.json`。
- 反过来，已下线的 `facebook/wav2vec2-lv-60-espeak-cv-ft` 的许可文件仍在随包发布。
- 同类问题还有一批：`sherpa-onnx-node`（Apache-2.0，需 NOTICE）、`onnxruntime-node`（MIT）、
  `source-map`（BSD-3-Clause，仓库里只有其 MIT 包装包的许可文件），以及各独立分发的模型包
  （`build-tts-model-package.mjs`、`build-asr-model-package.mjs`）都不带许可证。

## 6. 本分支整理清单

### 已修改

- **P0：sherpa-onnx 的 eSpeak NG 已从产物中移除**（1.5）。新增 `thirdparty-libs/sherpa-onnx-no-tts/`、
  `scripts/sherpa-no-tts-assets.json`、`scripts/sherpa-no-tts.js`、`scripts/vendor-sherpa-no-tts.js`、
  `thirdparty-licenses/LICENSE.sherpa-onnx-no-tts.txt`、`thirdparty-licenses/NOTICE.sherpa-onnx.txt`；
  修改 `scripts/setup.js`（替换排在任务首位）、`build.js`（出包前硬闸）、`.gitattributes`（`*.so`/`*.dll`
  标记为二进制）、`scripts/__tests__/setup.test.js` 并新增 `scripts/__tests__/sherpa-no-tts.test.js`。
- `thirdparty-licenses` 补齐了 `sherpa-onnx` 的 Apache-2.0 全文与 NOTICE（此前完全缺失）。
- `.github/workflows/ci.yml`：4 处 setup-assets 缓存路径从已删除的
  `externals/ai/pronunciation/model/facebook-wav2vec2-lv-60-espeak-cv-ft-int8` 改为
  `externals/ai/pronunciation/model/charsiu-en_w2v2_ctc_libris_and_cv-int8`。
  原路径自 `3638ea9` 起已不存在，缓存永远不会命中。
- **CI 冷缓存失败（原第 3 条 P0）已解决**：`0612d475` / `284db64` 起改为把导出的 ONNX
  发布到固定 GitHub Release `pronunciation-model-v1.0.0`，安装路径（`scripts/download-pronunciation-model.js`）
  只下载并按 size/SHA-256 校验、不再需要 Python；需要 Python 的导出链路独立放在
  `.github/workflows/pronunciation-model.yml`，该工作流自带 `actions/setup-python@v6`（3.11）
  并按 `scripts/pronunciation-model-requirements.txt` 固定导出工具链。CI 的 4 处缓存路径已同步改名。
- `thirdparty-licenses/NOTICE.charsiu-en_w2v2_ctc_libris_and_cv.txt`：新增，记录随包模型的上游
  revision、导出方式与**未决的许可状态**（见第 5 节）。
- **FFmpeg 的许可证与 carve-out 已补**（4.3）：新增 `thirdparty-licenses/LICENSE.ffmpeg.txt`、
  `README.ffmpeg-build.txt`（均与 `ffmpeg-static` release 资产逐字节一致）、`NOTICE.ffmpeg.txt`；
  仓库根 `LICENSE` 新增「第三方组件」一节，明确 FFmpeg 为独立程序、按 GPLv3 授权、不受本许可约束。
  **§6 对应源码仍未闭合**，见 4.4。
- `textpa/Read_to_Hear_TextPA.pdf`（第三方 arXiv 论文）已从仓库移除，改为在文档中引用 DOI。
- 仓库根新增忽略规则：`*.lssubmission`、`usage.jsonl`、`__pycache__/`、`*.pyc`、`desktop.ini`、`Thumbs.db`。

### 待决定

1. ~~**处置 sherpa-onnx 里的 eSpeak NG（P0）。**~~ 已在 `dev` 分支落地，见 1.5。注意**升级
   `sherpa-onnx-node` 时必须同步重新取件**：新版本的平台包会重新带上 eSpeak，而
   `vendor-sherpa-no-tts.js` 会因哈希不符而拒绝，`build.js` 的硬闸也会拦住出包。
2. **补齐 / 清理 thirdparty-licenses（P0，部分完成）。** 已补发音模型的 NOTICE、sherpa-onnx
   的 Apache-2.0 全文 + NOTICE（1.5）、以及 FFmpeg 的 GPLv3 全文 + 构建说明 + NOTICE 与
   根 `LICENSE` 的第三方组件 carve-out（4.3）；仍需：**自行编译 FFmpeg 以闭合 §6 对应源码**（4.4），
   删除已下线模型的 `LICENSE.facebook-wav2vec2-lv-60-espeak-cv-ft.txt`（它当前仍随安装包发布，
   见 `electron-builder.yml:160-161`）；扩展包 ZIP 内也带一份 NOTICE。
   注意第 5 节的开放问题：上游 HF 仓库未声明许可，需决定是沿用作者仓库的 MIT 结论还是先取得确认。
3. ~~**CI 冷缓存会失败（P0）。**~~ 已解决，见「已修改」第 2 条。
4. **删除产品代码里的 eSpeak 兼容路径（P1）。** 第 3 节表中的前四项；对应测试与
   `features/ai-router.md:84` 一并更新。
5. **修复失联的研究脚本（P2）。** `.gop-research/run_current_pronunciation.mjs`、
   `.gop-research/exam/filter_pronunciation_feedback.mjs` 的模型路径；或明确标注为冻结历史脚本。
   注：前者依赖的 `.gop-research/pronunciation-engine.mjs` 已删除（它与
   `packages/grading-engine/src/pronunciation.ts` 重复，且仅被这一个失效脚本引用），
   脚本现在还缺一个可解析的 `assessCtcPronunciation` 入口。
6. **清理散落文件（P2，部分完成）。** `textpa/Read_to_Hear_TextPA.pdf` 已移除；仓库根
   `666666-2026-08-16T01-27-49Z.lssubmission`（12 MB）与本次会话新出现的
   `作答-2026-09-30T09-18-38Z.lssubmission` 已加入忽略规则（保留在工作区，不入库）。
   `debug.log`、`icon1.png`、`icon2.png`、`output.svg` 属于 `origin/dev` 既有文件，不在本次范围内。
7. **清理本地陈旧校验状态（P3）。** `externals/ai/.setup-verification/pronunciation-model.json`
   （`externals/` 不入库，仅影响本机）。
8. **可选：向上游反馈（P3）。** `npm-addon-*.yaml` 只需加一行 `-DSHERPA_ONNX_ENABLE_TTS=OFF`
   （或为 Node 单独出 no-tts 平台包），npm 包就不再夹带 GPL 的 eSpeak。届时本仓库的替换机制可以整体移除。

> 本文只做工程层面的证据整理，不构成法律意见。
