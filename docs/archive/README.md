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

| 路径                                                               | 内容                                                                | 原位置                                  | 状态               |
| ------------------------------------------------------------------ | ------------------------------------------------------------------- | --------------------------------------- | ------------------ |
| [`design/`](./design/)                                             | 0.4 设计期"定稿"设计稿，多数已被代码与 `engineering/features/` 取代 | `design/`                               | superseded / draft |
| [`refactor/`](./refactor/)                                         | 重构前草案与部分仍然准确的内部契约                                  | `refactor/`                             | draft / archived   |
| [`../old/`](../../old/README.md)                                   | 0.3.x 完整旧世界（文档、源码、模板、真题）                          | 原地保留                                | archived           |
| [`product-docs-0.4.1/`](./product-docs-0.4.1/)                     | 上一代产品文档产物（已冻结迁出，仅作迁移期回归参照）                | 原 `docs/product/`                      | deprecated         |
| [`docs-revision-plan.md`](./docs-revision-plan.md)                 | 文档体系重构方案与阶段划分（2026-01 归档）                          | 仓库根目录 `DOCS-REVISION-PLAN.md`      | archived           |
| [`renderer-component-review.md`](./renderer-component-review.md)   | Renderer 组件一次性设计审查（未修项已转入待办）                     | 原 `docs/renderer-component-review.md`  | archived           |
| [`license-activation-options.md`](./license-activation-options.md) | 软件激活方式候选方案（问卷背景，未采纳）                            | 原 `docs/license-activation-options.md` | archived           |

## 迁移前必须保留的唯一价值内容

以下内容原为全仓库唯一记录；迁移去向与仍未迁移的部分记录在下表。

| 内容                                                                | 出处                                                      | 应去向                                                | 状态                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| builtin 只读存储（`registerBuiltinFileStore*`、`builtin-asset://`） | `design/file-store.md` §10-11                             | `engineering/features/file-store.md`                  | 已迁移 → `engineering/features/file-store.md` §内置只读存储；只读 IPC 白名单与启动对账见 `engineering/subsystems/builtin-content.md` §架构                                                                                                                                                                                                        |
| ExamPlayer 内部：编译期 TTS、GET 预检、资源缓存                     | `refactor/exam-player-design.md`                          | `engineering/subsystems/exam-player.md`               | 已迁移 → `engineering/subsystems/exam-player.md` §存储与格式（`loadExam` GET 预检与内存资源缓存）；编译期 TTS 见 `ui/screens/UI-TP-05.md` 与 `engineering/features/template-editor.md`（预览不合成 TTS）                                                                                                                                          |
| `AnswerCapturePlan` / `SubmissionTemplate` 推导契约                 | `refactor/question-type-pipeline-notes.md`                | `engineering/subsystems/exam-package.md`              | 已迁移 → `engineering/subsystems/exam-package.md` §存储与格式（结构与不变量）；该文末仍指向本档案的设计意图                                                                                                                                                                                                                                       |
| 模板编辑器 `@` 变量自动补全交互                                     | `design/template-editor-ui-draft.md` §变量输入            | `ui/screens/` 对应页面                                | 已迁移 → `ui/screens/UI-TP-02.md` §变量输入与自动补全                                                                                                                                                                                                                                                                                             |
| 领域包 / UI 分层规范                                                | `refactor/architecture-overview.md` §领域包与 UI 分层规范 | `engineering/README.md` 或独立规范                    | 已迁移 → `engineering/README.md` §领域包与分层规范（现状），含三处已记录的不一致                                                                                                                                                                                                                                                                  |
| 身份哈希与冲突矩阵决策理由                                          | `design/decisions.md`                                     | `engineering/features/interface-editor.md` 或决策记录 | 已迁移 → `engineering/features/interface-editor.md` §存储与身份 › 身份与冲突的取舍                                                                                                                                                                                                                                                                |
| 上海高考听说评分细则（分档描述）                                    | `old/docs/上海英语高考听说测试评分标准细则.docx`          | `ui/modules/grading-units.md` 或评分单元内容          | 已迁移 → 内置评分单元 `resources/builtin/schema-editor/.text/builtin-schemas.json` 的 `rubricMarkdown`（9 个上海高考评分单元；朗读句子、朗读短文、情景提问、看图说话的分档描述与 docx 一致，快速应答与听短文回答另有更细的分档）；docx 另有的考试结构与得分率、精准解读、备考建议未迁移，属分析材料                                               |
| 2025 浦东一模真题（含逐段时长）                                     | `old/docs/2025浦东一模听说(-annot).docx`                  | 内置题型内容                                          | 未迁移：`resources/builtin/**` 无浦东内容。迁移需从 docx 提取逐段文本、参考答案与逐段时长（含两个 Test 与 Section D 的 8 张内嵌图片），整理为内置试卷模板 document，写入 `resources/builtin/template-editor/.text/builtin-templates.json` 并给出 `version` 与 `releaseHash`，再通过 `BuiltinContentContract` 测试；属内容整理与内置清单工具链工作 |

## 迁移核验记录

旧产品文档与 v0.4.1 代码不一致的结论集中记录在 [`migration-verification.md`](./migration-verification.md)，
迁移模块文档时逐条核对，避免再次把旧结论当作依据。

## 规则

- 档案文件**不接收内容修改**，只允许补充状态头与指向继任文档的链接。
- 任何人引用档案中的结论前，必须先用代码核对。
- 档案中的 `.docx`、`.txt`、模板与示例音频属于源材料，不得删除。
