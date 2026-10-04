# 许可合规排查：eSpeak / GPL 残留

排查对象：分支 `refactor/test/textpa`（本文写于 HEAD `3638ea95`；合并前的最终 HEAD 为 `dba204f`，
第 6 节记录了此后已落地的处置）。
仓库根 `LICENSE` 为「保留所有权利」的专有许可，不是 GPL/AGPL，因此任何 GPL 组件的引入都需要单独评估。

## 结论（先看这里）

1. **是，本分支随包分发的产物里确实含 GPL 的 eSpeak NG 机器码。** 位置是一处，而且不在自有代码里：
   生产依赖 `sherpa-onnx-node@1.13.6` 的预编译库
   `node_modules/sherpa-onnx-linux-x64/libsherpa-onnx-c-api.so`
   **把 eSpeak NG 静态编译了进去**（详见第 1 节）。`electron-builder.yml` 会在 Linux / Windows / macOS
   三个平台把该库打进安装包。
2. **自有代码和自有资产没有被污染。** 仓库历史中从未出现 eSpeak 的源码、二进制或数据文件；
   自己的模型资产（39 个 CMU/ARPAbet token 的 `vocab.json`）与 eSpeak 无关；产品代码里没有
   `espeak`、`phonemizer`、`piper`、`g2p` 的构建或运行调用。
3. **eSpeak 作为研究工具只存在于 `textpa/`**，经 GPL-3.0 的 Python 包 `phonemizer` 调用系统 `espeak-ng`；
   既不是 vendored 代码，也不进入打包产物。
4. 另外发现两处与 eSpeak 无关、但风险不低于它的许可问题：
   **随包发布的 `ffmpeg-static` 是 GPL-3.0-or-later 且未附许可证文本**（第 4 节），以及
   **当前发音模型没有任何署名/许可文件**（第 5 节）。

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

### 1.3 影响面

`electron-builder.yml` 中与该库有关的打包配置：

```
asarUnpack:  - node_modules/sherpa-onnx-*/**            # :73
linux.files: from node_modules/sherpa-onnx-linux-${arch}  filter: '**/*'   # :129-131
win.files:   from node_modules/sherpa-onnx-win-${arch}    filter: '**/*'   # :85-87
mac.files:   from node_modules/sherpa-onnx-darwin-${arch} filter: '**/*'   # :109-111
```

`packages/airouter/src/main/qwen3-asr-worker.ts` 在运行时 `require` 该依赖，所以平台原生包必然随包发布。
本机只装了 `sherpa-onnx-linux-x64`，Windows / macOS 的同名库（同一上游 release 构建）无法在本机验证，
但按同样的打包配置会被一并分发，应视为同等暴露。

注意：应用只用到 sherpa-onnx 的**语音识别**，eSpeak 属于其 **TTS（piper）前端**，本应用并不调用；
`espeak-ng-data` 数据目录也没有随包发布，所以这段代码在运行时其实跑不起来。
但这不改变许可结论：**分发即触发 GPLv3 义务**，而 `sherpa-onnx-linux-x64/package.json` 只声明了
`Apache-2.0`，`thirdparty-licenses/` 里也没有任何 eSpeak / GPL 通知。

### 1.4 处置选项

1. **换成不含 TTS 前端的 sherpa-onnx 构建（推荐）。** 上游本身有 no-TTS 的构建变体
   （例如 [`build-ios-no-tts.sh`](https://github.com/k2-fsa/sherpa-onnx/blob/master/build-ios-no-tts.sh)），
   本应用只需要 ASR，去掉 TTS 即可让 eSpeak NG 不再进入产物。
2. 若必须继续使用官方预编译包，则按 GPLv3 履行义务：在 `thirdparty-licenses/` 中附 eSpeak NG 的
   GPL-3.0 文本、版权声明与对应源码的获取方式，并明确该 `.so` 的许可不是 Apache-2.0。
3. 无论选哪条，都应保留一份书面记录（谁在何时核对了哪个版本的构件）。

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

## 4. ffmpeg-static：随包发布的 GPL-3.0 组件

- `node_modules/ffmpeg-static/package.json`：`"version": "5.3.0"`、`"license": "GPL-3.0-or-later"`；
- 二进制自报：`ffmpeg version 7.0.2-static`，`configuration: --enable-gpl --enable-version3 ...`；
  `ffmpeg.README` 亦写明 "This static build is licensed under the GNU General Public License version 3."；
- 随包发布：`electron-builder.yml:56` 包含 `node_modules/ffmpeg-static/{index.js,package.json,ffmpeg,ffmpeg.exe}`，
  `asarUnpack` 也包含 `node_modules/ffmpeg-static/**`；
- **未随包发布**：同目录下的 `ffmpeg.LICENSE`（GPLv3 全文）不在 `files` 白名单中，
  `thirdparty-licenses/` 也没有对应条目。

调用方式为独立进程（`packages/airouter/src/main/pronunciation-assessment-service.ts:237`、
`speech-audio-transcoder.ts:16`、`speech-recognition-service.ts:554` 解析路径后交给 Worker 以子进程执行），
不是动态链接；按通常理解这属于独立程序而非衍生作品。但 GPLv3 对**该二进制自身**的分发义务
（随附许可证文本、提供对应源码获取方式、不得附加额外限制）依然成立。

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
- `textpa/Read_to_Hear_TextPA.pdf`（第三方 arXiv 论文）已从仓库移除，改为在文档中引用 DOI。
- 仓库根新增忽略规则：`*.lssubmission`、`usage.jsonl`、`__pycache__/`、`*.pyc`、`desktop.ini`、`Thumbs.db`。

### 待决定

1. **处置 sherpa-onnx 里的 eSpeak NG（P0）。** 见 1.4：换 no-TTS 构建，或补 GPLv3 义务。这一条同时
   决定"本分支是否被 GPL 的 eSpeak 污染"的最终答案。
2. **补齐 / 清理 thirdparty-licenses（P0，部分完成）。** 已补发音模型的 NOTICE；仍需补
   `ffmpeg-static`（GPLv3 文本 + 源码获取说明）与 `sherpa-onnx` 的 Apache-2.0 NOTICE；
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

> 本文只做工程层面的证据整理，不构成法律意见。
