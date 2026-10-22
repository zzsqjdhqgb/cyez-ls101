# IndexTTS 接入交付说明

## 1. 改动文件清单

### 新增（IndexTTS 专属）

| 文件 | 说明 |
| --- | --- |
| `scripts/index-tts/assets.json` | 唯一事实源（§3 原样照抄；`runtimeRelease.assets` bootstrap 后回填 cpu helper + manifest） |
| `scripts/index-tts/build-runtime.mjs` | 构建/暂存 helper（含 §4.6 补丁应用、ggml 树哈希校验、无参冒烟、cpu 静态校验；Windows CUDA DLL 闭包由 workflow 硬编码名单暂存，镜像 qwen-tts.yml） |
| `scripts/index-tts/download-release-assets.mjs` | Release 下载 + 分片合并 + HF bootstrap + CUDA 清理（复用 `downloadVerifiedAsset`/`ensureAssetSet`/`assertAssetFile`/`isSafeAssetPath`） |
| `scripts/index-tts/build-package.mjs` | ZIP64 流式模型包打包器（manifest + GGUF + 参考音频；不含可执行文件） |
| `scripts/index-tts/prepare-package.mjs` | 组合根（download → build-package → `dist/`） |
| `native/index-tts/main.cpp` | helper 单文件源（CLI 契约 + JSON 载荷 + 进程协议 + C ABI 接入） |
| `native/index-tts/audio.h` | WAV 解码/编码工具（RIFF 全块遍历、多声道混单声道、44 B–32 MiB、canonical 22050/mono/PCM16 输出） |
| `native/index-tts/CMakeLists.txt` | 构建 `ls101-index-tts-helper`（index_tts2 定制、静态单文件、portable CPU） |
| `native/index-tts/content-addressed-gguf.patch` | 上游三处扩展名判定 → GGUF 魔数判定 |
| `native/index-tts/licenses/{LICENSE.IndexTTS.txt, DISCLAIMER.IndexTTS.txt, LICENSE.audio-cpp.txt}` | 上游许可 |
| `packages/airouter/src/main/index-tts-model.ts` | `INDEX_TTS_LANGUAGES` / `IndexTtsParameters` / `indexTtsParameters` / `assertIndexTtsManifest` |
| `packages/airouter/src/main/index-tts-protocol.ts` | `IndexTtsProtocolDecoder` + `INDEX_TTS_MAX_TEXT_BYTES` / `INDEX_TTS_MAX_REQUEST_BYTES` |
| `packages/airouter/src/main/index-tts.ts` | `IndexTtsSynthesizer`（§6.4 十二条不变量） |
| `packages/airouter/src/__tests__/index-tts.test.ts` | 不变量测试（20 用例） |
| `packages/airouter/src/__tests__/index-tts-protocol.test.ts` | 解码器测试 |
| `packages/airouter/src/__tests__/index-tts-model.test.ts` | 参数/manifest 契约测试 |
| `scripts/__tests__/download-index-tts.test.js` | 下载脚本测试（含分片切分/合并确定性） |
| `scripts/__tests__/build-index-tts-package.test.js` | 打包器测试 |
| `docs/engineering/index-tts.md` | 工程文档（结构对齐 qwen-tts.md） |
| `thirdparty-licenses/{LICENSE.IndexTTS.txt, DISCLAIMER.IndexTTS.txt, LICENSE.audio-cpp.txt, NOTICE.nvidia-cuda.txt}` | 第三方许可 |

### 修改

| 文件 | 说明 |
| --- | --- |
| `packages/airouter/src/shared/types.ts` | `AIRouterSpeechProviderType` / `AIRouterLocalSpeechProviderType` 增加 `'index-tts'` |
| `packages/airouter/src/main/index.ts` | `localSynthesizers` 注册 `'index-tts'`；`will-quit` dispose；删除/导入 IPC 经 `releasePackage`/`releaseAssets` 协调（零新增 IPC 通道） |
| `packages/airouter/src/main/speech-service.ts` | 两个类型校验器接受 `'index-tts'`（其余路径天然透明） |
| `packages/airouter/src/main/speech-model-store.ts` | `isRuntime` 引擎 allowlist 增加 `'index-tts'` |
| `packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx` | IndexTTS provider 选项、标签、CPU 徽标、参数展示区块（threads/language/maxTokens/seed） |
| `packages/renderer/src/features/airouter/AIRouterSettingsPage.module.css` | `.parameterValue` 样式 |
| `electron-builder.yml` | `externals/ai/index-tts/runtime → index-tts` extraResources（含 CUDA 排除过滤器，逐行镜像 qwen 并加 `cufft*.dll`/`libcufft*`/`libnvJitLink*`） |
| `.github/workflows/index-tts.yml` | 整体重写（metadata / build×4 / model / release-runtime / release-model；bootstrap 顺序写入注释） |
| `scripts/setup.js` | tasks 追加 index-tts 下载任务（`assetVerification` + `modelDownload` + productDocs `LS101_INDEX_TTS_RUNTIME_ONLY`） |
| `package.json` | `index-tts:build-runtime` / `index-tts:download` / `index-tts:build-package` / `index-tts:prepare` |
| `scripts/__tests__/setup.test.js` | 更新 setup 任务清单期望 |

## 2. §6.4 十二条不变量 ↔ 测试用例映射

全部位于 `packages/airouter/src/__tests__/index-tts.test.ts`：

| # | 不变量 | 测试用例 |
| --- | --- | --- |
| 1 | 单进程独占（会话键 = `[modelPath, device, threads, lowMemory]`，不含音色） | `serializes requests through one helper process and passes voices per request`（断言 `spawnProcess` 仅 1 次，换音色复用进程） |
| 2 | 串行调度 + 队列上限 | 同上（顺序串行）+ `rejects more than the configured queued requests`（`IndexTTS 等待队列已满`） |
| 3 | 换模型先等旧进程完全退出；SIGTERM→5s→SIGKILL→再 5s→永久故障 | `restarts the process when the model path changes and waits for the old exit`；`escalates to SIGKILL and refuses further loads when a helper will not exit`（`IndexTTS helper 未能退出，已停止后续加载`） |
| 4 | 三类取消 | `rejects a queued request immediately on abort without disturbing the active one`（排队取消）；`aborts a loading session and lets later requests recover`（加载中取消）；`aborts an in-flight request, treats the process as failed, and restarts for the next one`（推理中取消） |
| 5 | 启动/合成超时后可重启恢复 | `recovers from a startup timeout and a synthesis timeout through a restart` |
| 6 | 单请求 ERROR 不杀会话 | `keeps the session alive after a per-request ERROR`（后续请求同进程成功，进程在 dispose 前未 kill） |
| 7 | 协议畸形（未知 requestId、重复 READY、无效 WAV、非零退出）→ 会话失效 + stderr 尾部；迟到事件忽略 | `invalidates the session on protocol malformation and ignores late events`（四段：未知请求→重复 READY→坏 WAV→死后迟到帧不影响新会话）；`invalidates the session when the helper exits non-zero and appends stderr` |
| 8 | `releasePackage` / `releaseAssets` 协调 | `coordinates package deletion and asset updates with synthesis`（排队请求以「模型包正在删除」拒绝、活动推理完成后才删除、删除时进程已释放、资源更新期间观察到进程释放）；`serializes coordinated file operations with each other`（文件操作串行） |
| 9 | 闲置 5 分钟回收 | `releases the process after the idle timeout`（默认 300 s；测试用 `idleTimeoutMs: 1000`） |
| 10 | dispose 幂等 + 永不再 spawn | `rejects queued requests and never spawns again after dispose`（二次 dispose、dispose 后调用拒绝 `IndexTTS 已关闭`、spawn 次数不变） |
| 11 | spawn 前校验 | `validates the request before spawning a helper`（format/文本长度/模型/音色/manifest 契约/abort 前置）；`rejects a missing helper runtime with an actionable message` |
| 12 | 输出 WAV 逐字段校验 | `validates the returned WAV field by field`（RIFF/WAVE、fmt 16B PCM 单声道、byteRate=rate×2、blockAlign=2、16 位、data 长度、durationMs=2000）；畸形路径在 #7 的坏 WAV 用例中覆盖 |

补充：`passes load parameters from the package manifest into the spawn arguments` 验证 manifest 参数（threads/device/lowMemory/language/maxTokens/seed）正确传入 spawn 与 JSON 载荷；`spawns the CPU helper with the documented arguments and private temp dir` 验证 CLI 参数、`windowsHide`、私有 `TMPDIR/TEMP/TMP`、PATH 前置。

## 3. 端到端冒烟数据（本容器，Linux x64，4 线程）

helper：`externals/ai/index-tts/runtime/linux-x64/ls101-index-tts-helper-cpu`（8,197,472 字节，`ldd` 仅 libc/libstdc++/libm/libgcc）
模型：`externals/ai/index-tts/models/index-tts2_5-q8_0.gguf`（3,502,955,328 B，SHA-256 与 §3 一致）
参考音频：`native/qwen-tts/voice-design/american-woman.wav`
命令形态：`node /tmp/index-tts-smoke-e2e.cjs <helper> <model> <voice> gguf|extensionless`（内部 `spawn --backend cpu --model <abs> --threads 4`）

| 路径 | 模型加载到 READY | 合成耗时 | 输出 | 音频时长 | RTF |
| --- | --- | --- | --- | --- | --- |
| 带 `.gguf` 扩展名 | 11.2–12.0 s | 91–105 s | `RESULT smoke001 22050 260652` + 260,652 B WAV → `out/index-tts-smoke-gguf.wav` | 5,909 ms | 15.5–17.7 |
| 无扩展名（symlink 到 `.tmp/<sha256>`，§4.6 回归） | 8.8–11.2 s | 96–109 s | 同上 → `out/index-tts-smoke-extensionless.wav` | 5,909 ms | 16.2–18.4 |

两条路径均在最终重编译（验证补丁重新应用）后的 helper 上各自完成完整合成；无扩展名路径成功即证明 §4.6 补丁生效（补丁存在性另由 `git apply --reverse --check` 与 build 脚本日志确认）。性能与 §9 预期一致（加载 ≈13 s、RTF 24–27 的量级；本机 24 核略快）。

## 4. 验收结果

- `yarn lint` ✅（0 error / 0 warning）
- `yarn typecheck` ✅
- `yarn test:scripts` ✅（95 pass，含新增 20 个）
- `yarn test:vitest` ✅（131 文件 / 1096 用例，含新增 index-tts 三套 49 用例）
- `node scripts/index-tts/build-runtime.mjs --backend cpu` 幂等重跑 ✅（补丁重复应用检测、冒烟、静态链接校验全过）
- `node scripts/index-tts/download-release-assets.mjs`（未发布 + 本地构建分支）✅：校验 `build-cpu.json` 与 pin 一致，输出本地 helper 哈希（`7d68f806…`，供回填参考），模型整包 SHA-256 校验通过
- `node scripts/index-tts/prepare-package.mjs` ✅：产出 `dist/index-tts-2.5-q8_0-0.1.0.zip`（3,503,937,399 B），manifest 与 §6.2 契约逐字段核对（assets/参数/voices/extensions）
- 模型分片哈希实测复现 ✅：对本地 GGUF 按 1 GiB 切分，四片 SHA-256 与 §3 完全一致（Python 独立计算 + 脚本 `modelPartPlan` 双重验证）
- 上游 HF 对账 ✅：`audio-cpp/audio.cpp-gguf@9c78726…/IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf` 的 LFS oid/size 与 assets.json pin 完全一致（API 实测）

## 5. 与提示词的偏离

无方案性偏离。实现层面的三点说明（均为补充而非变更）：

1. **§6.4(8) 的协调接口接入主进程**：`releasePackage`/`releaseAssets` 不止于「提供」，还接入了现有 `deleteSpeechPackage` / `importSpeechPackage` IPC 处理器（复用既有通道，零新增 IPC）。否则协调接口无人调用、删除模型包时无法安全释放进程。对非 IndexTTS 包是透明直通。
2. **`terminateSession` 统一用于所有会话退场**（换模型/闲置回收/维护/dispose），统一走 SIGTERM→`shutdownTimeoutMs`→SIGKILL→5 s→永久故障的阶梯（§6.4(3) 对换模型场景的要求推广到全部退场路径，行为只会更严格）。为此会话新增内部 `spawned` promise（spawn 是异步的，退场需先等子进程句柄就位再等 exit）。
3. **`dispose()` 返回 `Promise<void>`**（qwen 为同步 void）：§6.4(10) 要求「等活跃与进程清理完成」，注册处用 `app.once('will-quit', () => { void …dispose() })` 镜像 qwen 的写法。构造选项名称与默认值与 §6.4 完全一致。

## 6. 未完成项 / 后续（按任务定义不属于本次验收）

- **Windows 与 cuda 构建仅能由 CI 首次运行验证**（本容器无 Windows、无 GPU）。cuda 的实际推理正确性需要有 GPU 的开发机另行抽测。
- **全量 CI / `yarn test:smoke`**：依赖 §5.3/§7 的 bootstrap（发布两个 Release 并回填 assets.json），在 bootstrap 前预期无法通过。维护者按 workflow 注释中的三步顺序执行；回填示例值（本地 cpu helper）：`sha256=7d68f8065726f2de67ed86216820104bfdfbd67f8810041286b90f0fe0b9a956`，`size=8197472`。
- **§9 的两份冒烟 WAV**（`out/index-tts-smoke-{gguf,extensionless}.wav`）在 gitignore 的 `out/` 下，不入库。

## 7. 建议的 git add 命令（不执行）

```bash
git add \
  scripts/index-tts/assets.json \
  scripts/index-tts/build-runtime.mjs \
  scripts/index-tts/download-release-assets.mjs \
  scripts/index-tts/build-package.mjs \
  scripts/index-tts/prepare-package.mjs \
  scripts/__tests__/download-index-tts.test.js \
  scripts/__tests__/build-index-tts-package.test.js \
  scripts/__tests__/setup.test.js \
  scripts/setup.js \
  native/index-tts/CMakeLists.txt \
  native/index-tts/main.cpp \
  native/index-tts/audio.h \
  native/index-tts/content-addressed-gguf.patch \
  native/index-tts/licenses/LICENSE.IndexTTS.txt \
  native/index-tts/licenses/DISCLAIMER.IndexTTS.txt \
  native/index-tts/licenses/LICENSE.audio-cpp.txt \
  packages/airouter/src/main/index-tts.ts \
  packages/airouter/src/main/index-tts-protocol.ts \
  packages/airouter/src/main/index-tts-model.ts \
  packages/airouter/src/main/index.ts \
  packages/airouter/src/main/speech-model-store.ts \
  packages/airouter/src/main/speech-service.ts \
  packages/airouter/src/shared/types.ts \
  packages/airouter/src/__tests__/index-tts.test.ts \
  packages/airouter/src/__tests__/index-tts-protocol.test.ts \
  packages/airouter/src/__tests__/index-tts-model.test.ts \
  packages/renderer/src/features/airouter/AIRouterSpeechSettingsPage.tsx \
  packages/renderer/src/features/airouter/AIRouterSettingsPage.module.css \
  electron-builder.yml \
  .github/workflows/index-tts.yml \
  docs/engineering/index-tts.md \
  thirdparty-licenses/LICENSE.IndexTTS.txt \
  thirdparty-licenses/DISCLAIMER.IndexTTS.txt \
  thirdparty-licenses/LICENSE.audio-cpp.txt \
  thirdparty-licenses/NOTICE.nvidia-cuda.txt \
  package.json
```

（`scripts/index-tts/` 恰为 §5 要求的 5 个文件；无第 6 个脚本。）
