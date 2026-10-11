# IndexTTS CUDA 平台验收

本流程在 Windows x64、Linux x64 分别执行。CI 的编译、链接、依赖检查和启动探针通过后，
还需在有 NVIDIA GPU 的环境完成真实推理与应用验收。验收使用 CI 运行库、固定 Q8_0
模型和仓库内的两份参考 WAV。

## 1. 确认 CI 版本并安装运行库

记录两轮 run 的提交、结论和完整日志。确认 push 后的缓存修复已包含在实际构建提交中，
完整 job 成功，`mmvf.cu` 完成，sccache 统计中的 CUDA 阶段有命中；单独的 C/C++
100% 命中不能说明 CUDA 缓存情况。另行核对 cache write errors，保留实际计数。

Windows PowerShell：

```powershell
$indexTtsRunId = '替换为成功的 run ID'
gh run view $indexTtsRunId -R zzsqjdhqgb/cyez-ls101 --json headSha,headBranch,conclusion
gh run download $indexTtsRunId -R zzsqjdhqgb/cyez-ls101 --name index-tts-win32-x64 --dir "dist/index-tts-artifacts/$indexTtsRunId/win32-x64"
gh run view $indexTtsRunId -R zzsqjdhqgb/cyez-ls101 --json headSha,headBranch,conclusion > "dist/index-tts-artifacts/$indexTtsRunId/run.json"
gh run view $indexTtsRunId -R zzsqjdhqgb/cyez-ls101 --log > "dist/index-tts-artifacts/$indexTtsRunId/actions.log"
yarn index-tts:install-runtime --artifact-dir "dist/index-tts-artifacts/$indexTtsRunId/win32-x64" --target win32-x64
```

Linux Bash：

```bash
INDEX_TTS_RUN_ID=替换为成功的runID
gh run view "$INDEX_TTS_RUN_ID" -R zzsqjdhqgb/cyez-ls101 --json headSha,headBranch,conclusion
gh run download "$INDEX_TTS_RUN_ID" -R zzsqjdhqgb/cyez-ls101 --name index-tts-linux-x64 --dir "dist/index-tts-artifacts/$INDEX_TTS_RUN_ID/linux-x64"
gh run view "$INDEX_TTS_RUN_ID" -R zzsqjdhqgb/cyez-ls101 --json headSha,headBranch,conclusion > "dist/index-tts-artifacts/$INDEX_TTS_RUN_ID/run.json"
gh run view "$INDEX_TTS_RUN_ID" -R zzsqjdhqgb/cyez-ls101 --log > "dist/index-tts-artifacts/$INDEX_TTS_RUN_ID/actions.log"
yarn index-tts:install-runtime --artifact-dir "dist/index-tts-artifacts/$INDEX_TTS_RUN_ID/linux-x64" --target linux-x64
```

安装脚本读取对应平台 manifest，检查固定 audio.cpp 提交、GGML tree、CUDA 架构、
平台及 CUDA 构建配置，逐文件校验大小和 SHA-256，再将平台前缀还原为运行时文件名。
它检查必要的库、CUDA/MSVC 依赖和 CUDA 许可文件。在当前平台调用无模型启动探针，
确认动态库可装载；通过后替换整个 `externals/ai/index-tts/runtime/<target>/`。
校验或探针失败时保留旧目录。跨平台安装只能校验文件，启动探针标记为未执行。

安装不需要编译工具链，不查询或修改 Release。验证过的 manifest 保存在运行库的
`artifact-manifest.json`，供真实推理验收重新核对。manifest 中的 revision 指 audio.cpp
提交；应用分支的构建提交以保存的 GitHub run 元数据为准。

## 2. 准备模型包并运行原生推理

两平台执行相同命令：

```bash
yarn index-tts:prepare
yarn index-tts:test-runtime --backend cuda
yarn index-tts:test-runtime --backend cuda --cycles 5
```

`prepare` 生成 `dist/index-tts-2.5-q8_0-0.1.0.zip`。首次验收先运行默认一轮，
确认基本链路后再运行五轮音色切换，观察资源趋势。CUDA 设备默认 0，可用 `--device 1`
选择其他设备。helper 启动与推理总限时 30 分钟，预检和模型复制另需时间；
`--cycles` 支持 1–20，慢设备应分次验收。

每轮先以同一英文文本和 seed 完成男 → 女 → 男，随后单独生成中文、提交不存在的参考
WAV，再使用女声完成正常请求。全过程使用一个 helper。参考 WAV 和无扩展名的模型
资产都位于含空格及中文的路径中，覆盖真实存储命名和 Unicode 路径。

每次运行生成独立的 `dist/index-tts-validation-cuda/run-测试 <随机串>/`，终端打印路径。
可通过 `--output <目录>` 指定验收输出位置。输出包括：

| 文件或报告字段      | 内容                                                              |
| ------------------- | ----------------------------------------------------------------- |
| `report.json`       | 成败、错误、运行库构建信息及摘要、模型摘要、PID、加载与各请求耗时 |
| `request*.wav`      | 五份正常推理结果；追加循环会增加英文 A→B→A 的结果                 |
| `参考 *.wav`        | 本次使用的参考音频                                                |
| `helper-stderr.log` | helper 的完整诊断；报告另存最后 16 KiB                            |
| `comparisons`       | 每轮前后 A 的固定 seed 摘要比较                                   |
| `resources`         | 约每秒及各请求结束时的进程内存和可取得的进程显存样本              |
| `manualAcceptance`  | 听测、模型加载次数、内存趋势和离线验收的待核对项                  |

预检、启动、协议、推理或超时失败时也保存失败报告，并在进程退出后删除临时模型副本
和上游展开目录。磁盘须额外容纳约 3.3 GiB 的临时模型副本；输入原模型保持不变。

自动检查响应归属、WAV 格式、非静音、不同声线输出差异和错误后继续推理。CPU 下
固定 seed 的前后 A 摘要不同会失败；CUDA 下记录差异并标记 `review`，退出码为 2，
保留后续用例的结果。浮点计算的非确定性需要结合 WAV 听测和诊断判断。
`passed` 表示这些自动检查通过，音质仍需人工验收；`failed` 的退出码为 1。
同一 PID 本身也不能证明库内部没有重载模型，需核对诊断中的加载行为。

Linux 内存来自 `/proc`；Windows 来自进程 working set/peak working set。CUDA 显存
来自 `nvidia-smi` 的进程查询。WDDM 返回 N/A 或查询工具不可用时记录空值或错误，
不能作为显存验收通过；此时另用目标机器可用的 GPU 监控记录。定时样本不能保证捕捉
瞬时峰值，需结合较长循环与设备监控判断。

## 3. 验收打包应用

运行库安装和模型包准备完成后重新打包：

```bash
yarn build:test
```

Windows PowerShell：

```powershell
$env:LS101_TEST_INDEX_TTS_CUDA = '1'
try {
  yarn test:playwright:electron tests/integration/index-tts.spec.ts
} finally {
  Remove-Item Env:LS101_TEST_INDEX_TTS_CUDA
}
```

Linux Bash：

```bash
LS101_TEST_INDEX_TTS_CUDA=1 xvfb-run -a yarn test:playwright:electron tests/integration/index-tts.spec.ts
```

真实 GPU 用例覆盖打包应用中的模型导入、配置、IPC、合成和 A→B→A；启用后缺少模型、
运行库或 GPU 会直接失败。保留 Playwright 报告，并在实际应用完成以下验收：

1. 在语音设置中导入 ZIP，添加 IndexTTS CUDA 提供方，分别试听男女声；检查中文、
   英文及数字、日期、符号的读音，记录输出是否完整、声线是否符合参考音频。
2. 将男女角色路由至同一模型的不同音色，连续生成并检查声线归属、输出格式及播放。
3. 排队时取消一个请求，再取消活动推理；确认无残留 helper，后续另一音色能正常生成。
4. 关闭应用、删除及重新导入模型包，检查进程退出和文件释放，重新导入后正常合成。

若大包导入需要另一数据卷，设置 `LS101_TEST_INDEX_TTS_DATA_ROOT`。目标文件系统须
支持原子 rename 和目录 fsync；测试使用独立数据子目录，退出后清理。

## 4. 离线首次推理与验收记录

下载模型和运行库后，在目标机器禁用网络，确认没有存活的 helper，再执行一次原生
验收以及打包应用的首次合成。原生脚本每次都会创建空的 helper 展开目录，并使用新
进程；它本身不证明网络已禁用，报告中的离线项须由本次实际环境记录确认。

每个平台保存 run ID/提交、安装 manifest、原生报告/WAV/日志、GPU/驱动信息、
Playwright 报告和人工验收结论。记录冷启动、各次推理耗时、内存/显存趋势，以及听测、
离线、路径和取消恢复结果。自动检查通过和人工验收结论分开记录。

两平台实际验收通过后，再将验证过的产物摘要写入资产清单并完成 Release 交付。
Qwen 的逐请求音色迁移在 IndexTTS 验收完成后进行。
