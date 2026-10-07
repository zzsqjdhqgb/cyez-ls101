# TODO: AIRouter 语音 Provider 系列代码审核问题清单

## 背景

对 dev 上的 `3b906af`（ElevenLabs speech）与 `feat/minimax` 上的 `ecc6d78` / `b8e39b2`
（MiniMax）、`4a5f7fa` / `85496a2`（列表折叠/搜索）五个提交做了代码审核（2026-10）。

总体结论：**无 blocker，功能主体正确**——协议实现与 MiniMax / ElevenLabs 官方文档吻合
（模型枚举、pcm/24000 参数、hex 输出、`base_resp` 错误信封、`get_voice` 解析均核实无误），
测试全过（airouter 106、renderer 266）、typecheck / lint 干净。但存在 4 个可复现的运行时
bug、一组成体系的结构重复、若干健壮性缺口与提交切分错位。计划：**先做功能修改，再回来
修本清单**。

行号以 85496a2 为准，后续代码移动后按内容定位。

## 一、运行时 bug（已复现，优先修）

1. **NoSpeechGeneratedError 死分支**（`packages/airouter/src/main/speech-service.ts:792`）
   `candidate?.name === 'NoSpeechGeneratedError'` 永远不命中：`ai` 7.0.77 中实际 name 为
   `'AI_NoSpeechGeneratedError'`（`ai/dist/index.js:292`）。空音频时英文原文
   "No speech audio generated." 透传到中文 UI。
   修复：`import { NoSpeechGeneratedError } from 'ai'`，用 `NoSpeechGeneratedError.isInstance(error)`。

2. **列表收起状态越过阈值后永久隐身**（`packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx:1163`）
   `showItems = query ? true : !collapsed` 中 `collapsed` 不受 `collapsible` 约束；收起后
   条目跌破 6 → 按钮消失、条目不渲染、空态也不渲染，只剩空白容器。
   修复：`const showItems = query ? true : !(collapsible && collapsed)`；可加 `key={draft.type}`。

3. **搜索框消失后过滤仍在生效，列表锁死**（同文件 :820 渲染条件 vs :868 无条件 `filter={voiceSearch}`）
   搜索态删到总数 <6 → 搜索框与清除按钮一起消失，旧过滤词继续过滤 → 只显示
   「没有匹配的音色。」且无法清除。
   修复：跌破阈值时 `setVoiceSearch('')`，或渲染条件改 `length >= 6 || voiceSearch`。

4. **run() 回调闭包捕获过期 draft，请求期间用户操作被静默回滚**（:783-799 音色、
   :699-715 模型同型；ToggleList 复选框/删除按钮 :1183-1207 无 disabled）
   `setDraft({ ...draft, ... })` 用点击时刻快照整体覆盖；busy 只禁了按钮/输入框。
   修复：改函数式更新 `setDraft((current) => ...)`；给 ToggleList 加 `disabled` prop 传
   `Boolean(busy)`。

## 二、结构问题（"写得糟糕"的核心）

5. **Provider 类型清单硬编码 ≥5 处**：`packages/airouter/src/shared/types.ts:4-16`、
   `speech-service.ts` 的 `assertProviderConfigInput`(:601-611)、`isOnlineSpeechProviderType`
   (:613-622)、`isProviderConfig`(:666-672)、`defaultOnlineBaseUrl`(:628-633)、渲染层
   `AIRouterSpeechSettingsPage.tsx:90-99` 第三份。漏改 `isProviderConfig` 会让所有已存配置
   被 `readDocument` 拒绝，全部语音 Provider 一次性不可用（b8e39b2 为加 minimax-cn 被迫同步
   改 6 处即成本实证）。
   修复：单一来源常量数组 + 派生类型 + `includes()` 谓词；默认 baseUrl 用 `Record<type,string>`。

6. **分发 if/else 链三份 + apiKey 解析重复**：`listModels`(:177)、`listVoices`(:210-217)、
   `synthesizeSingle`(:283-291)；三个 `synthesize*` 各自重复
   `apiKey ?? (await this.secretScope().read(config.id))`（:331/:356/:385）；ElevenLabs 与
   MiniMax 的 PCM→WAV 包装近乎复制。
   修复：`synthesizeSingle` 统一解析一次 apiKey；在线 Provider 收敛为 adapter 查表
   （`Record<type, {listModels?, listVoices?, synthesize}>`）；抽 `wrapPcmAsWav()`。
   注意：MiniMax 已有限流内部重试（`requestMinimaxSpeechPayload` + `MinimaxRateLimitError`，
   见 features/ai-router.md 的 minimax 一节），重构为 adapter 时必须原样保留。

7. **其余重复**：`defaultOnlineBaseUrl` 主进程/渲染层双份 → 挪进 `@ls101/airouter` shared；
   `providerLabels`/`modelPackageLabels` 近重复表（:72-88）→ 一张表派生；设置页单文件
   1318 行、25 个 hooks、编辑器 Modal 全内联 → 抽 `SpeechProviderEditorModal` 与独立的
   `ToggleList`（问题 2/3/4 的状态纠缠正源于此）。

## 三、健壮性 / 输入校验

8. **ElevenLabs PCM 路径不校验响应格式**（`speech-service.ts:364-374`）：OpenAI 路径有
   `mediaType.startsWith('audio/')`，此路径没有；非合规代理忽略 `output_format=pcm_24000`
   返回 mp3 时会被静默包成损坏 WAV。
   修复：复用 `responseMediaType(result)` 校验，不符抛明确错误。

9. **voiceId 未校验直接进 URL 路径**：SDK 裸插值 `/v1/text-to-speech/${voiceId}` +
   `createElevenLabsFetch` 的 `new URL` 规范化——实测 `bad#voice` 会丢 `output_format`、
   `../../admin` 会请求目标主机其他路径。非权限边界但会静默改写请求语义。
   修复：对 elevenlabs 音色 ID 白名单校验（如 `^[A-Za-z0-9_-]+$`）。

10. **MiniMax 缺 `audio_format` 校验且尺寸检查滞后**（`speech-service.ts:902-914`、:410）：
    只读了 `audio_sample_rate`/`audio_channel`；`assertAudioSize` 在 `Buffer.from(hex)` 与
    全串正则之后才执行，超大响应先在主进程完整落地。
    修复：断言 `extra_info.audio_format === 'pcm'`；解码前先查 `audio.length > MAX_AUDIO_BYTES * 2`。

11. **MiniMax 单段 10k 字符上限无客户端守卫**：官方规范 "Must be less than 10,000
    characters"，而 `mergeSegments` 对同角色相邻行无限合并，长文单角色段落会超限被拒。
    修复：合成前按字符数预检/分段。

12. **`synthesizeSingle` 的 `format` 形参是死代码**（:277/:337/:763-768）：两处调用
    （:232/:258）都硬编码 `'wav'`，最终格式由 `transcodeWav` 统一转换；`pcm-s16le` 分支与
    `mediaTypeFor` 的 mp3/opus 分支均不可达（fetch 旧代码遗留被 3b906af 原样搬入）。
    修复：删形参或让 OpenAI 路径真正拿到最终格式。

13. （既有，非本系列引入）`resolveTransientConfig`（:448-459）条件块两分支返回同一对象，
    整段 no-op，只白白多读一次 secret store；顺带修复。

## 四、UX / 一致性

14. **discoveredVoices 不持久**：保存后重开编辑器音色只剩裸 ID（配置 schema 不存 name，
    `AIRouterSpeechVoiceConfig` 见 `types.ts:343`）。应用未发布无迁移负担。
    修复：给 VoiceConfig 加可选 `name` 并在发现合并时写入。

15. **模型列表没有搜索框而文档说有**（`features/ai-router.md:170` 写"模型或音色列表…"；
    实现仅音色有 :820）。openai-compatible 动辄上百模型恰是最需要搜索的列表。
    修复：搜索推广到 Model 列表，或修正文档措辞。

16. **`type="search"` → `"text"` 语义退步**（:828，85496a2 引入）：丢读屏搜索角色与原生
    Esc 清空。修复：改回 `type="search"` 并保留自定义清除按钮（可共存）。

17. **小项**：清除按钮缺 `disabled={Boolean(busy)}`（:832-840）；`.searchInputWrap` 漏加进
    窄屏媒体查询 `width:100%` 组（`AIRouterSettingsPage.module.css:608` 与 ~:964-973）；
    「运行方式」切换不清理 `discoveredVoices`/`voiceSearch` 而「Provider 类型」切换清理了
    （:471-487 vs :499-513）。

18. **baseUrl 约定不一致**：openai-compatible 默认带 `/v1`，ElevenLabs/MiniMax 不带；
    沿用带 `/v1` 的自定义地址会得 `/v1/v1/...` 404。至少在文档/占位符里提示。

## 五、测试缺口

- 空音频响应（可直接抓住问题 1）；
- abort 中止路径（`toSpeechSynthesisError` AbortError 归一化、MiniMax fetch signal 透传）；
- **带路径前缀的自定义 baseUrl**（`https://gw.example.com/eleven` → `.../eleven/v1/...`）——
  `createElevenLabsFetch` 存在的全部意义，现只测裸 host；
- 列表跌破 6 项阈值的行为（补问题 2/3 复现步骤即可让现有代码失败）；
- 模型列表折叠零覆盖；ElevenLabs/MiniMax 用例约 90% 重复可表驱动合并。

## 六、提交卫生（不改代码，只做历史整理）

- `4a5f7fa` 标题只说 collapse 但 diff 含完整搜索；`85496a2` 标题说 search and collapse
  实际只是搜索框 UI 重做——两者 message 与内容互换，revert/bisect 会误导。
  建议 squash 或分别 reword。
- `ecc6d78` → `b8e39b2` 十分钟返工（谓词替换、清单补 cn、测试改 it.each）。

## 修复顺序（功能修改完成后）

1. 问题 1-4（四个运行时 bug，前三个均为一行级）+ 回归测试；
2. 问题 8-10（EL/MiniMax 响应格式校验、voiceId 白名单、hex 先查长度）；
3. 问题 5-7（结构重构：类型清单单一来源、adapter 表、共享常量、拆组件）；
4. 问题 11-18 按需；测试缺口随各步补齐。

## 验收标准

- 上述 1-4 全部修复且各自附带能失败的回归测试（先红后绿）；
- `yarn vitest run packages/airouter packages/renderer` 全绿；`yarn typecheck`、`yarn lint`
  干净；
- 结构重构后新增一个假想 Provider 类型所需的改动点收敛为「shared 常量 + adapter 表」两处；
- 涉及主进程/渲染层行为变更后跑 `xvfb-run -a yarn test:smoke` 通过。
