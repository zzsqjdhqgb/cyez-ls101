<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: archive
-->

# 历史档案

本目录存放**已废弃或未采纳**的设计与文档，只读，不作为当前行为的依据。
保留它们的唯一理由是：其中一部分内容是全仓库唯一记录，未来迁移或追溯时仍需要。

当前档案：

| 路径 | 内容 | 原位置 | 状态 |
| --- | --- | --- | --- |
| [`design/`](./design/) | 0.4 设计期"定稿"设计稿，多数已被代码与 `engineering/features/` 取代 | `design/` | superseded / draft |
| [`refactor/`](./refactor/) | 重构前草案与部分仍然准确的内部契约 | `refactor/` | draft / archived |
| [`../old/`](../../old/README.md) | 0.3.x 完整旧世界（文档、源码、模板、真题） | 原地保留 | archived |
| `product-docs-0.4.1/` | 上一代产品文档产物（待迁入） | `docs/product/` | deprecated |

## 迁移前必须保留的唯一价值内容

以下内容在别处没有等价记录。归档可以，丢失不行。

| 内容 | 出处 | 应去向 | 状态 |
| --- | --- | --- | --- |
| builtin 只读存储（`registerBuiltinFileStore*`、`builtin-asset://`） | `design/file-store.md` §10-11 | `engineering/features/file-store.md` | 迁移中 |
| ExamPlayer 内部：编译期 TTS、GET 预检、资源缓存 | `refactor/exam-player-design.md` | `engineering/subsystems/exam-player.md` | 已迁移 |
| `AnswerCapturePlan` / `SubmissionTemplate` 推导契约 | `refactor/question-type-pipeline-notes.md` | `engineering/subsystems/exam-package.md` | 已迁移 |
| 模板编辑器 `@` 变量自动补全交互 | `design/template-editor-ui-draft.md` §变量输入 | `ui/screens/` 对应页面 | 待迁移 |
| 领域包 / UI 分层规范 | `refactor/architecture-overview.md` §领域包与 UI 分层规范 | `engineering/README.md` 或独立规范 | 待迁移 |
| 身份哈希与冲突矩阵决策理由 | `design/decisions.md` | `engineering/features/interface-editor.md` 或决策记录 | 待迁移 |
| 上海高考听说评分细则（分档描述） | `old/docs/上海英语高考听说测试评分标准细则.docx` | `ui/modules/grading-units.md` 或评分单元内容 | 待迁移 |
| 2025 浦东一模真题（含逐段时长） | `old/docs/2025浦东一模听说(-annot).docx` | 内置题型内容 | 待迁移 |

## 迁移核验记录

旧产品文档与 v0.4.1 代码不一致的结论集中记录在 [`migration-verification.md`](./migration-verification.md)，
迁移模块文档时逐条核对，避免再次把旧结论当作依据。

## 规则

- 档案文件**不接收内容修改**，只允许补充状态头与指向继任文档的链接。
- 任何人引用档案中的结论前，必须先用代码核对。
- 档案中的 `.docx`、`.txt`、模板与示例音频属于源材料，不得删除。
