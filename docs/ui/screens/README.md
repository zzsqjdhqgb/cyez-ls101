<!--
status: implemented
product-version: 0.4.1
audience: both
owner: ui
-->

# 逐屏 UI 规格索引

本目录为每个用户可见界面建立一份规格（`UI-<模块>-<序号>.md`），依据是 v0.4.1 的**实际路由与界面**。

- 路由来源：`packages/renderer/src/app/register-placeholder-routes.ts`、`packages/renderer/src/app/register-settings.ts`。
- 规格状态：`未建立` 表示尚未编写；`已建立` 表示规格存在；`锚定` 表示同时有视觉/行为测试。下表统一使用 `已建立`，逐屏锚定状态以每篇规格的 `anchors` 块为准。
- 锚定状态汇总由 `yarn visual:check` 与 `yarn docs:check` 输出（当前：视觉锚定 22 / 未验证 5 / n/a 2；行为锚定 24 / 未验证 5）。`docs/ui/coverage.md` 尚未生成，引用时不要指向它。

## 一级导航

|   顺序 | 模块     | 路由           | 组件                    |
| -----: | -------- | -------------- | ----------------------- |
|      0 | 工作台   | `/`            | `WorkbenchPage`         |
|     10 | 试卷库   | `/exams`       | `ExamLibraryPage`       |
|     20 | 作答记录 | `/submissions` | `SubmissionLibraryPage` |
|     30 | 题型库   | `/interfaces`  | `InterfaceListPage`     |
|     40 | 试卷模板 | `/templates`   | `TemplateBrowserPage`   |
|     50 | 评分单元 | `/schemas`     | `SchemaBrowserPage`     |
| footer | 设置     | `/settings`    | `SettingsOverviewPage`  |

## 工作台（WB）

| ID       | 界面   | 路由 | 布局     | 组件            | 规格                    |
| -------- | ------ | ---- | -------- | --------------- | ----------------------- |
| UI-WB-01 | 工作台 | `/`  | standard | `WorkbenchPage` | [已建立](./UI-WB-01.md) |

## 试卷库（EL）

| ID       | 界面       | 路由            | 布局      | 组件              | 规格                    |
| -------- | ---------- | --------------- | --------- | ----------------- | ----------------------- |
| UI-EL-01 | 试卷库列表 | `/exams`        | standard  | `ExamLibraryPage` | [已建立](./UI-EL-01.md) |
| UI-EL-02 | 考试运行   | `/exams/player` | immersive | `ExamSessionPage` | [已建立](./UI-EL-02.md) |

## 作答记录（SR）

| ID       | 界面         | 路由                                                       | 布局     | 组件                       | 规格                    |
| -------- | ------------ | ---------------------------------------------------------- | -------- | -------------------------- | ----------------------- |
| UI-SR-01 | 作答记录列表 | `/submissions`                                             | standard | `SubmissionLibraryPage`    | [已建立](./UI-SR-01.md) |
| UI-SR-02 | 评分工作区   | `/submissions/grading`、`/submissions/:submissionId/grade` | focus    | `SubmissionGradingPage`    | [已建立](./UI-SR-02.md) |
| UI-SR-03 | 评分结算     | `/submissions/settlement`                                  | focus    | `SubmissionSettlementPage` | [已建立](./UI-SR-03.md) |

## 题型库（IF）

| ID       | 界面           | 路由                                             | 布局     | 组件                          | 规格                    |
| -------- | -------------- | ------------------------------------------------ | -------- | ----------------------------- | ----------------------- |
| UI-IF-01 | 题型库列表     | `/interfaces`                                    | standard | `InterfaceListPage`           | [已建立](./UI-IF-01.md) |
| UI-IF-02 | 题型详情       | `/interfaces/:interfaceId`                       | standard | `InterfaceDetailsPage`        | [已建立](./UI-IF-02.md) |
| UI-IF-03 | 题型草稿编辑器 | `/interfaces/drafts/:draftId`                    | focus    | `InterfaceDraftEditorPage`    | [已建立](./UI-IF-03.md) |
| UI-IF-04 | 题组编辑器     | `/interfaces/:interfaceId/instances/:instanceId` | focus    | `InterfaceInstanceEditorPage` | [已建立](./UI-IF-04.md) |
| UI-IF-05 | 题型导出       | `/interfaces/:interfaceId/export`                | focus    | `InterfaceExportPage`         | [已建立](./UI-IF-05.md) |
| UI-IF-06 | 题型导入       | `/interfaces/import`                             | focus    | `InterfaceImportPage`         | [已建立](./UI-IF-06.md) |

## 试卷模板（TP）

| ID       | 界面         | 路由                                                                         | 布局     | 组件                                                              | 规格                    |
| -------- | ------------ | ---------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------- | ----------------------- |
| UI-TP-01 | 模板库列表   | `/templates`                                                                 | standard | `TemplateBrowserPage`                                             | [已建立](./UI-TP-01.md) |
| UI-TP-02 | 模板编辑器   | `/templates/:templateId`                                                     | focus    | `TemplateDocumentPage`                                            | [已建立](./UI-TP-02.md) |
| UI-TP-03 | 内置模板查看 | `/templates/builtin/:templateId`                                             | focus    | `BuiltinTemplateDocumentPage`                                     | [已建立](./UI-TP-03.md) |
| UI-TP-04 | 函数编辑器   | `/templates/libraries/:libraryId/functions/:functionId`                      | focus    | `TemplateFunctionDocumentPage`                                    | [已建立](./UI-TP-04.md) |
| UI-TP-05 | 生成试卷     | `/templates/:templateId/generate`、`/templates/builtin/:templateId/generate` | focus    | `TemplateExamGenerationPage`、`BuiltinTemplateExamGenerationPage` | [已建立](./UI-TP-05.md) |

## 评分单元（GS）

| ID       | 界面               | 路由                                  | 布局     | 组件                     | 规格                    |
| -------- | ------------------ | ------------------------------------- | -------- | ------------------------ | ----------------------- |
| UI-GS-01 | 评分单元库         | `/schemas`                            | standard | `SchemaBrowserPage`      | [已建立](./UI-GS-01.md) |
| UI-GS-02 | 评分单元定义       | `/schemas/:schemaId`                  | focus    | `SchemaDefinitionPage`   | [已建立](./UI-GS-02.md) |
| UI-GS-03 | 评分单元草稿库     | `/schemas/drafts/:libraryId`          | standard | `SchemaDraftLibraryPage` | [已建立](./UI-GS-03.md) |
| UI-GS-04 | 评分单元草稿编辑器 | `/schemas/drafts/:libraryId/:draftId` | focus    | `SchemaDraftEditorPage`  | [已建立](./UI-GS-04.md) |

## 设置（ST）

| ID       | 界面     | 路由                     | 布局     | 组件                     | 规格                    |
| -------- | -------- | ------------------------ | -------- | ------------------------ | ----------------------- |
| UI-ST-01 | 设置总览 | `/settings`              | standard | `SettingsOverviewPage`   | [已建立](./UI-ST-01.md) |
| UI-ST-02 | 存储     | `/settings/storage/*`    | standard | `StorageSettingsPage`    | [已建立](./UI-ST-02.md) |
| UI-ST-03 | 许可     | `/settings/license/*`    | standard | `LicenseSettingsPage`    | [已建立](./UI-ST-03.md) |
| UI-ST-04 | 外观     | `/settings/appearance/*` | standard | `AppearanceSettingsPage` | [已建立](./UI-ST-04.md) |
| UI-ST-05 | 关于     | `/settings/about/*`      | standard | `AboutSettingsPage`      | [已建立](./UI-ST-05.md) |
| UI-ST-06 | AI 引擎  | `/settings/ai-router/*`  | standard | `AIRouterSettingsPage`   | [已建立](./UI-ST-06.md) |

`UI-ST-06` 内部包含文本、图像、语音合成、语音识别、发音评测五个区域，分别对应
`AIRouterImageSettingsPage`、`AIRouterSpeechSettingsPage`、`AIRouterSpeechRecognitionSettingsPage`、
`AIRouterPronunciationSettingsPage`；是否拆分为独立规格在编写时决定。

## 覆盖层（非路由，由运行时触发）

| ID       | 界面       | 组件                      | 规格                    |
| -------- | ---------- | ------------------------- | ----------------------- |
| UI-OV-01 | 许可激活   | `LicenseActivationPage`   | [已建立](./UI-OV-01.md) |
| UI-OV-02 | 旧数据迁移 | `LegacyDataMigrationPage` | [已建立](./UI-OV-02.md) |

## 命名与边界说明

- 规格 ID 使用 `UI-` 前缀，与旧产品文档的操作编号（如 `IF-03`）区分；旧层已冻结在 `docs/archive/product-docs-0.4.1/`。
- `/interfaces/drafts` 是重定向入口（`InterfaceDraftListRedirect`），不单独建立规格。
- `/submissions/:submissionId/grade` 与 `/submissions/grading` 渲染同一组件，共用一份规格。
- 沉浸式（`immersive`）与专注式（`focus`）界面不显示一级导航；规格需说明退出路径。
- v0.4.1 已完成内部术语替换：`Schema`→评分单元、`Interface`→题型、`Instance`→题组、
  `Timeline`→时间线、`Collector`/收集器→采集器、`revision`→版本、`Provider`→服务商、
  `ID`→编号、`API Key`→API 密钥。各规格的 `## 术语` 记录本屏现状，
  对照表与处置说明见 [`../glossary.md`](../glossary.md) 与
  [`../open-questions.md`](../open-questions.md) 第 1 条。
- 规格内容要求、写作约束与锚定规则见 [`../README.md`](../README.md)。
