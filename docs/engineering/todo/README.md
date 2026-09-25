<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 未完成工作项

原根目录 `TODO-*.md`，按主题收拢于此。每个文件顶部有 `status: draft` 元数据；
**工作项状态以本表为准**。已完成的工作项删除，结论落到对应的 `features/` / `subsystems/` 文档。

| 文件 | 主题 | 状态 | 说明 |
| --- | --- | --- | --- |
| [`ci-quality-gates.md`](./ci-quality-gates.md) | CI 质量门禁 | 🟡 部分完成 | 所需门禁已在 `ci.yml` 实现；文档中的 product-docs 门禁已落地，剩余为可复用 workflow / 矩阵 / path filter 等 |
| [`logger.md`](./logger.md) | 日志体系 | 🟡 部分完成 | `packages/logger` 已落地；`console.*` 残留、按 IPC 包装、脱敏与诊断导出仍未做 |
| [`qwen-tts-cpu-threading.md`](./qwen-tts-cpu-threading.md) | Qwen TTS CPU 线程数 | 🟡 待办（准确） | `threads: 4` 硬编码，未调用 `ggml_backend_cpu_set_n_threads` |
| [`qwen-tts-cuda-runtime.md`](./qwen-tts-cuda-runtime.md) | Qwen TTS CUDA runtime | 🟡 待办（准确） | CUDA helper 暂未随包发布 |
| [`dependency-upgrade.md`](./dependency-upgrade.md) | 依赖统一升级 | 🟡 待办 | 仅占位说明，尚无统一升级提交 |
| [`dev-container-docker.md`](./dev-container-docker.md) | 开发容器调用宿主 Docker | ⏸ 暂缓 | 暂不考虑开发容器内 canonical runner 的宿主挂载路径适配 |
| [`manual-coverage.md`](./manual-coverage.md) | 产品说明书覆盖面扩展 | 🟡 进行中 | `EP-01` 已贯通评分单元→题型→题组→模板→生成→试卷库；运行、导入作答、评分与结算仍缺，AI 评分被 ASR mock 与资产阻塞 |
| [`renderer-accessibility.md`](./renderer-accessibility.md) | Renderer 可用性与语义 | 🟡 待办 | 承接已归档的组件审查：toast 溢出、`SettingsRow` label 关联、`ResizableSplit` separator 语义、窄窗口与 `AIModelSelect` 失效值 |

规则：

- 工作项完成后：先在对应代码/测试中确认，再更新本表；**已完成的文件可直接删除**。
- 工作项内容涉及产品行为时，同时更新 [`../../ui/`](../../ui/README.md)；涉及实现契约时更新 [`../features/`](../features/README.md)。
