<!--
status: implemented
product-version: 0.4.1
audience: both
owner: ui
-->

# 未决问题

本文件是**唯一**的未决清单。任何"待确认 / 待定 / 可能需要"的内容都应写在这里，
不允许散落在规格、模块文档或档案里冒充结论。

格式：问题、背景、选项、阻塞点、需要谁定、当前决定。

---

## 1. 界面暴露 `Schema` 与产品用词冲突

- **背景**：产品定义要求用户界面统一使用「评分单元」，但 v0.4.1 实际界面存在内部术语。已定位：
  - `Schema`：评分单元库加载文案 `正在加载 Schema...`；草稿库 `返回 Schema`、`正式 Schema`；
    题型详情 `复制 JSON Schema` / `复制 JSON Example`；评分抽查规则 `按 Schema 分组`；
    模板编辑器的「评分 Schema」小节。
  - `Interface`、`Timeline`、`Collector`：模板编辑器面板与编译错误文案。
  - `revision` / `Revision`：模板导入对话框字段名与编辑器副标题。
  - `ID`：题型草稿校验错误 `题型 ID 无效`。
  - `Provider`：题组编辑器 `图像 Provider`、AI 引擎设置。
  - 内部错误码：内置模板禁用「生成试卷」的 tooltip。
- **选项**：(a) 修改界面文案为「评分单元」等用户用词；(b) 在术语表中承认现状，改产品定义。
- **影响**：(a) 属代码变更，会触发相关视觉基线更新，需要与视觉回归同批处理。
- **需要谁定**：产品负责人。
- **当前决定**：**已完成，选项 (a)**。界面文案、主进程错误文案与相关测试已改为术语表用词：
  `Schema`→评分单元、`Interface`→题型、`Instance`（界面上的"实例"）→题组、`Timeline`→时间线、
  `Collector`/收集器→采集器、`revision`/`Revision`→版本、`Provider`→服务商、`ID`→编号、
  `API Key`→API 密钥；`JSON Schema`/`JSON Example` 两个复制按钮改为 `复制题型结构`/`复制示例数据`。
  内置模板禁用「生成试卷」时的 tooltip 由错误码改为人类可读消息。对照表见
  [`glossary.md`](./glossary.md)。视觉基线随本批重建。

## 2. `old/` 是否物理迁入 `docs/archive/legacy/`

- **背景**：档案层的目标是集中历史材料，但 `old/` 含完整旧源码、模板与示例音频。
- **选项**：(a) 原地保留 + `old/README.md` 状态说明；(b) 迁入 `docs/archive/legacy/`。
- **影响**：移动会产生大量 git rename，并需修正对 `old/src/...` 的文字引用。
- **当前决定**：**暂定 (a)，已实施**（见 [`../../old/README.md`](../../old/README.md)）。

## 3. 说明书规格的格式

- **背景**：`docs/manual/` 需要"步骤可绑定可执行验证"的规格格式。
- **选项**：(a) TypeScript（沿用现有 `tests/product-docs/support/product-test.ts` 类型，便于绑定定位器）；
  (b) YAML（更易手写，但绑定需要额外约定）。
- **当前决定**：建议 (a)，待建立 `docs/manual/` 时确认。

## 4. `docs/product` 的冻结与门禁改造

- **背景**：旧产物需要冻结迁出并摘除 CI 新鲜度门禁，但 `scripts/product-docs/**`、
  `playwright.product-docs.config.ts`、`package.json` 与 CI 都指向 `docs/product`。
- **影响**：改动涉及生成脚本与 CI，需要单独验证（Docker canonical 流程）。
- **当前决定**：**已完成**。`docs/product` 迁入 `docs/archive/product-docs-0.4.1/`（只读）；reporter 的归属设计校验改指 `docs/ui/modules/<slug>.md`。
  （2026-09 补充：说明书此后改为手写维护在 `docs/manual/`，canonical 重新生成与比对的路径已退役。）

## 5. 空壳包 `editor-kit` / `section-engine`

- **背景**：两个包 `src/index.ts` 为 `export {}`，却被 `renderer`、`template-editor` 声明为依赖，
  且无任何代码 import。
- **选项**：(a) 删除包与依赖；(b) 保留并补文档说明其为预留。
- **当前决定**：未定；工程文档按现状记录，不描述不存在的能力。

## 6. `renderer` 未声明 `grading-engine` 依赖

- **背景**：`packages/renderer` 源码 import `@ls101/grading-engine`，但 `package.json` 未声明
  （仅 `tsconfig.json` 有 path 引用）。
- **当前决定**：未定；属代码修复，文档中记为已知不一致。

## 7. `grading-engine` 依赖 `submission-library` 的分层倒置

- **背景**：评分引擎依赖它评分对象的存储层，方向与直觉相反。
- **当前决定**：未定；如需调整属代码重构。

## 8. `features/` 的 11 处事实错误修正排期

- **背景**：`application-shell.md` 等与代码冲突（bridge 数量、路由、主题、`ready-to-show`、
  ASR 选项、`updateSchema` 冻结行为、`file-store` baseDir 等）。
- **当前决定**：**已完成**（阶段 2）。逐条修正已落在 `docs/engineering/features/` 各篇。

## 9. `take-exam` 流程的文档归属

- **背景**：产品文档测试 `flows/take-exam/run.spec.ts` 实际声明 `journey/exam-delivery`，
  产出 journey 文档，但目录在 flows 下。
- **当前决定**：待随说明书重建时一并处理。

## 10. 包内英文错误信息直达界面

- **背景**：`packages/schema-editor`、`packages/interface-editor`、`packages/template-editor`、
  `packages/exam-library` 等包在存储损坏、内容校验、ZIP 解析失败时抛出英文 `Error`
  （例如 `Invalid Schema draft library`、`Interface image generator is not configured`）。
  renderer 只对少数错误做中文映射（`schemaUi.ts`、`templateUi.ts`），其余原样显示。
- **影响**：这些消息会出现在界面提示与错误页中，与术语表的中文用词规则冲突；
  翻译属代码变更，且需要逐个包补中文映射与测试。
- **选项**：(a) 在包内改为中文消息；(b) 保留英文，由 renderer 按错误码统一映射。
- **当前决定**：**已完成，(a)+(b) 组合**：
  - 包内错误消息全部改为中文（领域包、主进程、preload 共 350+ 处）。
  - renderer 统一兜底：`packages/renderer/src/components/ui/userMessage.ts` 的 `toUserMessage` 对不含中日韩字符的消息返回中文兜底并写日志，
    所有界面错误出口（`schemaUi`、`templateUi`、`interfaceUi`、`examUi`、`submissionUi` 及各处 `reason.message`）都经过它；
    按错误码判断的通用助手是 `hasErrorCode`（不再依赖消息文本，避免翻译后判定失效）。
  - 门禁：`yarn copy:check`（`scripts/docs/check-user-facing-copy.mjs`）扫描 `packages/**`、`src/**` 的错误构造点，纯英文即失败；
    CI 的 `other-checks` 与本地 `yarn test` 都会运行它。
  - 允许保留的技术缩写：`AI`、`JSON`、`TTS`、`WASM`、`SHA-256`、`OpenAI Compatible`、`Base URL`（见 [`glossary.md`](./glossary.md)）。

## 11. 评分单元草稿库路由在打包应用里没有入口

- **背景**：兼容路由 `/schemas/drafts/:libraryId`（`UI-GS-03`）与 `/schemas/drafts/:libraryId/:draftId`（`UI-GS-04`）在
  `packages/renderer/src/app/register-placeholder-routes.ts` 中只注册了 `path` 与 `layout`，没有声明 `navigation`；
  全仓库对 `/schemas/drafts/...` 的跳转只发生在 `SchemaDraftLibraryPage` 与 `SchemaDraftEditorPage` 之间，
  没有其他界面链接到它们；renderer 使用 MemoryRouter，规格中写的"直接 URL 进入"在打包应用里不成立。
  结果是 v0.4.1 打包应用无法打开这两屏，历史草稿库数据也读不到。
- **选项**：(a) 补入口：在「评分单元」库页检测到历史草稿库数据时给出进入草稿库的入口；
  (b) 确认兼容期结束后删除两条路由、两个页面与两篇规格；(c) 保持现状，把"不可达"记为已知限制。
- **影响**：(a) 属产品与代码变更，需要同步改 UI 规格、补行为测试并重建视觉基线；
  (b) 会让历史草稿库数据彻底无法读取，需要先确认没有用户数据依赖；
  (c) 两篇规格的行为锚点按 [`README.md`](./README.md) §2 的合格线无法达成，只能保持 `unverified`。
- **需要谁定**：产品负责人。
- **当前决定**：未定。
