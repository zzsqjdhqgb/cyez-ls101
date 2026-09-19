<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 未完成工作项

原根目录 `TODO-*.md`，按主题收拢于此。每个文件顶部有 `status: draft` 元数据；
**工作项状态以本表为准**。

| 文件 | 主题 | 状态 | 说明 |
| --- | --- | --- | --- |
| [`startup-progress.md`](./startup-progress.md) | 启动进度展示 | ✅ 已完成（2026-08-26） | 文件自称 completed；`tests/integration/startup-progress.spec.ts` 存在 |
| [`product-docs-screenshot-docker.md`](./product-docs-screenshot-docker.md) | 专用截图容器 | ✅ 基本完成 | 镜像、runner、preview/publish 分离均已实现；仅"两次运行字节一致"无法从代码树验证 |
| [`airouter-model-catalog-access.md`](./airouter-model-catalog-access.md) | 模型目录访问方式 | ⛔ 已过时 | 现为随包快照 + 离线 `--check`；文档仍描述运行时抓取 |
| [`ci-quality-gates.md`](./ci-quality-gates.md) | CI 质量门禁 | 🟡 部分完成 | 所需门禁已在 `ci.yml` 实现；文档中的 product-docs 门禁已落地，剩余为可复用 workflow / 矩阵 / path filter 等 |
| [`logger.md`](./logger.md) | 日志体系 | 🟡 部分完成 | `packages/logger` 已落地；`console.*` 残留、按 IPC 包装、脱敏与诊断导出仍未做 |
| [`qwen-tts-cpu-threading.md`](./qwen-tts-cpu-threading.md) | Qwen TTS CPU 线程数 | 🟡 待办（准确） | `threads: 4` 硬编码，未调用 `ggml_backend_cpu_set_n_threads` |
| [`qwen-tts-cuda-runtime.md`](./qwen-tts-cuda-runtime.md) | Qwen TTS CUDA runtime | 🟡 待办（准确） | CUDA helper 暂未随包发布 |
| [`dependency-upgrade.md`](./dependency-upgrade.md) | 依赖统一升级 | 🟡 待办 | 仅占位说明，尚无统一升级提交 |

规则：

- 工作项完成后：先在对应代码/测试中确认，再更新本表；**已完成的文件可直接删除**。
- 工作项内容涉及产品行为时，同时更新 [`../../ui/`](../../ui/README.md)；涉及实现契约时更新 [`../features/`](../features/README.md)。
