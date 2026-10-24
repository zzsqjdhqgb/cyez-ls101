# TODO: IndexTTS CPU 合成在 maxTokens 偏大时崩溃（暂不处理）

> 状态：**暂不处理**（维护者决定，2026-10-17 记录，等以后处理本 TODO 时再排查）。
> 当前应用与模型包默认 `synthesis.maxTokens: 1500`，处于已验证的安全区，正常使用不受影响。

## 现象

CPU 后端合成时 helper 进程直接死亡（GGML 断言，不是协议层 ERROR，进程无优雅退出）：

```
ggml_new_object: not enough space in the context's memory pool
(needed 268435760, available 268435456)
external/ggml/src/ggml.c:1847: GGML_ASSERT(obj_new) failed
```

`available` 恰为 256 MiB（2^28），`needed` 仅多出 304 字节。崩溃发生在 READY 之后的推理过程中。

## 协议级复现方式

spawn `externals/ai/index-tts/runtime/linux-x64/ls101-index-tts-helper-cpu --backend cpu --model <index-tts2_5-q8_0.gguf> --threads 4`，读到 `READY 1` 后发送
`SYNTHESIZE <id> <len>\n` + JSON 载荷 `{"text":"…","voicePath":"…","language":"en","maxTokens":4096,"seed":20260918}`。
文本长短均可复现（39 字符与 155 字符都崩）。

## 已验证的事实（2026-10-17，本开发容器实测）

| 实际发送的 maxTokens | 文本 | 结果 |
| --- | --- | --- |
| 1500 | 77 字符（原冒烟文本，两条模型路径各一次） | ✅ 5.9 s 音频 |
| 1500 | 155 字符（考试指令长句） | ✅ 11.49 s 音频 |
| 4096 | 39 字符 | ❌ 崩溃（同一断言） |
| 4096 | 155 字符 | ❌ 崩溃 |
| 8192 | 155 字符 | ❌ 崩溃 |

- 阈值未精确定位，位于 **(1500, 4096]** 区间内。
- 崩溃只随 `maxTokens` 变化；文本长度、参考音频相同时无影响。
- 勘误：曾一度记为 "maxTokens=2048 成功、阈值在 2048 与 4096 之间"。后核实该次运行所用的一次性脚本把
  传入的 2048 参数忽略了、实际发送的是 1500，该数据点作废。上表只保留经磁盘产物核对过的运行。

## 维护者判断（按指示记录，待验证）

- 开发环境是内存较小的容器；问题出现时段**宿主机仅剩约 2.8 GB 可用内存**（维护者观测），
  倾向于认为崩溃与开发环境内存不足有关。
- **生产环境内存充裕，可能不会复现本问题。**
- 分辨方法（以后处理时的第一步）：在内存充裕的机器上用完全相同的参数（`maxTokens=4096`）复测一次，
  复现与否即可区分"内存不足"与"引擎内部固定池上限"两种解释。

## 代码侧线索（未定论，仅供以后排查参考）

- 崩溃池的大小恰好等于上游硬编码常量：`src/models/index_tts2/gpt.cpp:1820` 的
  `ggml_init_params state_params{256ull*1024ull*1024ull, nullptr, true}`（GPT DecodeGraph 状态上下文），
  该值是编译期常量，不随系统内存变化。
- `required_cache_steps = prompt_steps + max_mel_tokens + 1`（`gpt.cpp:2241` 附近），随 `maxTokens`
  增长——与实测触发条件吻合。
- 引擎中确实存在按系统可用内存自适应缩放的池（`include/engine/framework/core/constant_tensor_cache.h`
  的 `fit_constant_context_bytes`，按 MemAvailable/4 预算），但该机制未用于 index_tts2 的 GPT 路径。
- 以上两条解释目前都未定论；除复测外，也可在崩溃时打印失败上下文的归属来定位（本 TODO 未做）。

## 对应用的影响

- `packages/airouter/src/main/index-tts-model.ts` 的 `indexTtsParameters` 允许
  `synthesis.maxTokens` 取 1–8192；`scripts/index-tts/build-package.mjs` 生成的 manifest 固定为 1500（安全）。
- 只有当模型包 manifest 把 `maxTokens` 提高到阈值（>1500，具体未知）以上时，CPU 路径每次合成都会让
  helper 进程崩溃 → 会话失效（应用侧错误信息会附带 stderr 尾部，含该断言文本）→ 可通过重启进程恢复，
  但会持续失败，直到把 `maxTokens` 调回安全值。
- CUDA 路径未验证（本环境无 GPU；CUDA 侧 KV cache 为 F16、体积减半，阈值可能不同）。

## 以后处理的选项（均未实施，处理时择一或组合）

1. 先在大内存机器复测 `maxTokens=4096`，分辨根因（内存不足 vs 硬编码池上限）。
2. 若为池上限：把应用侧 `maxTokens` 上限从 8192 收紧到实测安全值（需先补边界测试），或在
   helper/合成器侧 clamp，并同步 `build-package.mjs` 的 manifest 与 `docs/engineering/index-tts.md`。
3. 若为内存不足：在 `docs/engineering/index-tts.md` 记录最小可用内存要求。
4. 可选：向上游 `0xShug0/audio.cpp` 反馈（附断言输出与协议级复现载荷）。

## 处理时的验收标准

- 大内存机器复测结论被记录（复现/不复现，以及当时的机器内存水位）。
- 应用侧 `maxTokens` 边界与结论一致（收紧上限或文档明确说明限制）。
- 回归：`maxTokens=1500` 的端到端合成仍通过（带 `.gguf` 扩展名与无扩展名两条模型路径）。
