# 临时 TODO：IndexTTS 的 CI 缓存策略（**不要提交本文件，应当尽早解决**）

> ⚠️ 本文件只是方案记录：**不要 `git add` / 不要提交**；解决后直接删除，不需要留档。
> 状态：**未实施**。`ci.yml` 目前完全没有 IndexTTS 的缓存路径，本文件记录的是待执行的决策。

## 决策（已定，待实施）

1. **只缓存 IndexTTS 的 runtime 构建，不缓存 IndexTTS 的模型。**
2. 之后再把 **Qwen TTS 的模型缓存也去掉**（长期跟进项，见文末）。

## 现状

`.github/workflows/ci.yml` 的 setup-assets 缓存（两个 job：`test_suites` 与
`linux_electron_smoke`，各有 restore + save 两步）**只列了 qwen3-tts 的路径，没有任何
`externals/ai/index-tts/...` 条目**，缓存 key 也只 hash 了
`scripts/qwen-tts/assets.json`，未包含 `scripts/index-tts/assets.json`。

后果：等 §7 的 bootstrap（发布两个 Release 并回填 `assets.json`）完成后，每次 CI 都会重新
下载 3.5 GiB 的 IndexTTS 模型（以及 8 MB 的 helper），并在两个 job 里各做一次完整 SHA-256
校验。公开仓库下载免费，但每次 CI 多出约 30 s 与 3.5 GiB 流量。

## 待实施的改动

在 `.github/workflows/ci.yml` 的 4 处（两个 job × restore/save）：

- 新增（运行时构建，单 OS 约 16 MB）：
  ```yaml
  externals/ai/index-tts/downloads/releases/ls101-index-tts-helper-cpu-<os>
  externals/ai/index-tts/downloads/releases/index-tts-runtime-manifest.json
  externals/ai/index-tts/runtime/<platform>-<arch>
  ```
  （`<os>` / `<platform>-<arch>` 按 job 分别取 `win32-x64` 与 `linux-x64`）
- **不要**加 `externals/ai/index-tts/models`（3.3 GB/OS，见下）。
- 两处缓存 `key` 的 `hashFiles(...)` 追加 `scripts/index-tts/assets.json`，使资产版本变化时
  自然失效重建。

## 为什么只缓存 runtime、不缓存模型

`ci.yml` 现有缓存路径逐项实测（单 OS）：

| 缓存路径                                         | 单 OS                               |
| ------------------------------------------------ | ----------------------------------- |
| `externals/ai/pocket-tts/model`                  | 269 MB                              |
| `externals/ai/stt/downloads/*.tar.bz2`           | 838 MB                              |
| `externals/ai/stt/model/silero_vad.onnx`         | 0.6 MB                              |
| `externals/ai/stt/model/sherpa-onnx-qwen3-asr-…` | 942 MB                              |
| `externals/ai/pronunciation/model/charsiu-…`     | 117 MB                              |
| `externals/ai/qwen3-tts/models`                  | 1.6 GB                              |
| `externals/ai/qwen3-tts/runtime` + release 小件  | ~3 MB                               |
| `assets/file-icons`                              | 7.5 MB                              |
| **现状合计**                                     | **≈ 3.8 GB/OS → 两 OS ≈ 7.6 GB**    |
| 加上 index-tts 的 runtime 小件                   | 两 OS 仍 ≈ 7.6 GB（+32 MB，可忽略） |
| 若再加 index-tts 的模型（3.3 GB）                | 两 OS ≈ 14.2 GB                     |

配额是**每仓库总量**（跨 OS、跨分支合计）**10 GB**：

- 只缓存 runtime：7.6 / 10 GB，安全，余量约 2.4 GB；
- 缓存模型：14.2 / 10 GB，超 4.2 GB → LRU 淘汰（cache thrashing），且 3.3 GiB 的大条目最
  可能被反复挤出，等于白占配额还拖累 stt/qwen 小条目的命中率。

补充事实（已核实自 GitHub 文档）：

- 超出 10 GB **默认不扣费**，而是按 LRU 淘汰；只有把仓库缓存上限调高才按 $0.07/GB-month
  计费（调到 20 GB ≈ $0.70/月）。
- 缓存条目 **7 天未被访问即删除**。
- 3.3 GiB 的 cache restore 与 3.5 GiB 的 Release 下载在 runner 上耗时基本相当（约 30 s），
  缓存模型本身的收益有限。

## 实施后的验证

1. 触发一次完整 CI，确认 `yarn install --immutable`（postinstall 触发的 setup）仍绿。
2. Actions → Caches 页面看实际占用，确认总量 ≤ 10 GB、无频繁淘汰。
3. 记录 `Setup` 阶段耗时增量（预期每次 CI ≈ +30 s/平台），确认可接受。
4. 一切正常后删除本文件。

断言依据：

```bash
du -sh externals/ai/{pocket-tts/model,stt/model,stt/downloads,pronunciation/model,qwen3-tts/models,index-tts/models,index-tts/runtime}
```

参考文档：

- 缓存配额与淘汰策略：https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#usage-limits-and-eviction-policy
- 计费与公开仓库免费：https://docs.github.com/en/billing/concepts/product-billing/github-actions
- 单个 job 6 小时硬上限：https://docs.github.com/en/actions/reference/limits

## 长期跟进项（不在本次实施）

**把 Qwen TTS 的模型缓存也去掉**（`externals/ai/qwen3-tts/models`，1.6 GB/OS，同样 4 处）。
理由与本条一致：模型走 Release 下载即可，缓存只应保留运行时产物。预期把缓存总量从
约 7.6 GB 降到约 4.4 GB。建议在 IndexTTS 缓存改动与 bootstrap 都验证通过后再单独做，且不要
与 `assets.json` 回填放在同一个提交。

## 边界

- 本 TODO 只涉及日常 CI 的缓存策略，不影响 `.github/workflows/index-tts.yml`
  （该构建 workflow 只有 cuda 腿的 sccache，无 `actions/cache`，与 qwen 一致）。
- 不要为了让缓存“看起来命中”而放宽 `ensureAssetSet` 校验或 `assets.json` 的 pin。
- 不要用 `git add -A` / `git add .` 提交，避免把本文件一起带上。
