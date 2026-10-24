# TODO: IndexTTS 语速校准（durationFactor）接入产品管线（暂不实现，先讨论）

> 状态：**方案待讨论**（维护者决定，2026-10-19 记录）。讨论定稿后按「实施方案」实现。
> 前置事实全部已验证：helper 协议已支持 `durationFactor`（`15f7f75`，本机重编译后实测
> df=1.5 输出时长 9694 ms / df 缺省 6467 ms，倍率线性误差 <0.1%）；校准系数已定稿
> （`index-tts-eval/E17-final-config-corrected/calibration.json`）；音色池 5 声已入
> `voice-samples/`（出处/许可证见其 README）。

## 背景与目标

- IndexTTS 的语速与韵律**复刻自参考音频**（E 系列实验结论）：5 个入池音色的原生语速
  分布在 106–146 wpm，产品要求统一 **125 wpm**。
- E11/E17 已验证：`durationFactor` 线性缩放输出时长（>1 变慢，<1 变快），每音色一个
  固定系数即可统一到目标语速。
- 定稿系数（E17 `calibration.json`）：
  `annmale 0.90 · greenman 1.01 · brooks 1.07 · alec 1.09 · janelle 1.17`
  （README 表中 greenman 记 1.0，以 calibration.json 为准）。
- 本 TODO 只做「语速校准」这一件事；音色池入产品（voices 资产化）是同一批改动的
  载体，但资产化本身另见 handoff 后续工作 #2，两件事天然一起做。

## 现状（差距）

1. **应用侧无法传 `durationFactor`**：`packages/airouter/src/main/index-tts-model.ts` 的
   `IndexTtsParameters.synthesis` 只有 `language/maxTokens/seed`；
   `index-tts.ts` 的 `dispatch()` 构造 JSON 载荷时也只发这四个（+可选 seed）。
2. **校准系数是 per-voice 的，而 manifest 参数是 per-model 的**：现有 schema
   （`AIRouterSpeechModelPackageModel.parameters`）没有 per-voice 参数位。系数放在哪里
   是本 TODO 的核心设计决策（见下）。
3. **音色池尚未资产化**：5 个入池音色的参考 WAV 还在 `voice-samples/`（评估库），
   未进 `scripts/index-tts/assets.json` / `native/...` / 打包 manifest。
   现行包内只有 Qwen VoiceDesign 合成的 american-{man,woman} 两个音色。

## 待讨论的设计决策（实现前需要定稿）

### D1. durationFactor 放哪一层？（核心）

| 选项 | 做法 | 优 | 劣 |
| --- | --- | --- | --- |
| **A. voice 级**（推荐起点） | manifest 的每个 voice 增加可选 `parameters: { durationFactor }`；synthesizer dispatch 时按 voiceId 取 | 语义正确（语速是音色属性）；系数随包分发，导入即生效；与 E17 的 per-voice 校准一一对应 | 需要扩展 manifest 契约（`isPackageVoice` 校验 + `assertIndexTtsManifest` + 打包器三处） |
| B. model 级 | 放进 `models[].parameters.synthesis.durationFactor` | 改动最小（现有参数位直接加一个字段） | 语义错误：同一模型下 5 个音色需要 5 个系数，放不下 |
| C. 运行时用户可调 | Provider 配置/设置页暴露滑杆，默认值取 voice 级 | 灵活，可微调 | 本期范围膨胀；且 §6.5 说参数随包走，先不引入 UI |

讨论点：是否同时保留一个 **model 级默认**（voice 未标注时回退）？E17 的五音色全部有
系数，回退路径目前用不上，但自定义导入的第三方包（无系数）需要一个缺省行为——
建议缺省 = 不传（引擎 1.0）。

### D2. 校准系数的来源与再校准

- 系数目前来自 E17 的两阶段流程（Stage1 无校准合成 → 测 wpm → 反解系数 → Stage2 验证
  精确 125 wpm）。**这不是 CI 能自动做的事**（要人耳/ASR 测时长）。
- 是否需要把「测时长→反解系数」做成开发脚本（`yarn index-tts:calibrate-voice`）？
  它只是「合成固定文本 + 读 WAV 头换算 wpm + 写出系数 JSON」，不含听感。可以做成
  第 5 个脚本吗——**不行**，§5 规定 `scripts/index-tts/` 严格 5 文件；可作为
  `build-package.mjs` 的子命令或并入 prepare。此点也请讨论。
- 音色参考窗若换（重新剪 12 s 窗），系数要重测。provenance JSON 里应记录系数与
  测量条件（文本/seed/目标 wpm），保证可复现。

### D3. 兼容与范围

- manifest 加可选字段 → 旧包（无系数）必须继续可导入可合成（字段可选 + 缺省不传）。
- `minimumAppVersion` 是否需要 bump？取决于校验是否收紧（若只是可选字段，不必 bump；
  若把「入池音色必须带系数」设为硬校验，需要）。
- 渲染层 §6.5 的参数展示区要不要加一行「语速系数」（读 voice 级）？顺手但非必需。

## 实施方案（D1 选定后的草图，按 A 写）

1. **协议/模型层** `index-tts-model.ts`：
   - `IndexTtsParameters.synthesis` 增加 `durationFactor?: number`（0.1–10，缺省不传）；
   - `assertIndexTtsManifest`：voice 可选 `parameters.durationFactor` 数值范围校验
     （超出 0.1–10 拒绝导入，中文错误）；
   - 导出 voice 级参数读取 helper（`indexTtsVoiceParameters(voice)` 之类）。
2. **合成器** `index-tts.ts` `dispatch()`：载荷构造改为合并
   `voice.parameters?.durationFactor ?? model.parameters.synthesis.durationFactor ?? 引擎缺省`。
3. **打包器** `build-package.mjs`：voices 数据源（assets.json 或 CLI `--voice`）读出
   `durationFactor` 写进 manifest 的 voice 节点；provenance 一并记录。
4. **资产化（与校准同批）**：5 个入池音色 WAV 收进产品音色目录（沿用 Qwen 的
   `native/qwen-tts/voice-design` 形态还是新开 `native/index-tts/voices`？请讨论），
   `scripts/index-tts/assets.json` 的 `voices[]` 换成 5 声 + 每项带 `durationFactor`
   与 provenance；许可证按 `voice-samples/README.md` 逐项登记
   （PD-USGov / PD-LibriVox / 联邦 PD / CC0 —— 注意与 bilibili 模型许可叠加时的
   归档义务）。
5. **测试**：`index-tts-model.test.ts` 加 voice 级 durationFactor 的接受/拒绝矩阵；
   `index-tts.test.ts` 加「载荷包含 voice 级系数 / 无系数时不传字段」两条断言
   （FakeHelper 已捕获 payload，直接断言即可）。
6. **文档**：`docs/engineering/index-tts.md` 增补「语速校准」一节（机制、E11/E17
   结论、系数表、再校准流程）。

## 明确不做（本期）

- 运行时用户可调语速 UI（D1-C）。
- 自动再校准进 CI/CLI（见 D2 的讨论点）。
- temperature/topP/topK 的应用侧暴露（协议已支持，产品无需求；与 qwen 的采样参数
  暴露策略保持一致——qwen 也没把这些做成 UI）。

## 参考

- 实验证据：`index-tts-eval/E11-rate-calibration/`（倍率线性验证）、
  `index-tts-eval/E17-final-config-corrected/`（定稿配置 + calibration.json）、
  `index-tts-eval/E16-final-config/`（情绪路径反面证据，与本 TODO 无关但同批）。
- 工程记录（本容器，gitignored）：`.cache/index-tts-quality-state.md`。
- helper 协议字段与取值范围：`native/index-tts/main.cpp` 头部注释（`15f7f75`）。
