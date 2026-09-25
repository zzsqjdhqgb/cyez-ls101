<!--
status: implemented
product-version: 0.4.1
audience: both
owner: docs
-->

# LS101 文档总入口

本文件回答三件事：**哪份文档算数**、**文档分成哪几层**、**新增或修改文档时遵循什么规则**。

版本前提：当前文档描述 **v0.4.1**（`dev` 分支）。`dev` 比 `main` 多的提交均为构建/开发环境类改动，不含产品变更。
**代码是唯一事实来源**；任何 `implemented` 文档与代码冲突，一律以代码为准并修正文档。

## 1. 权威地图

| 层 | 位置 | 回答什么 | 读者 | 维护方式 |
| --- | --- | --- | --- | --- |
| 产品说明书 | [`manual/`](./manual/README.md) | 产品承诺什么、用户如何完成一次考试 | 用户、第三方评审 | 生成（`yarn docs:manual:local`；canonical 容器内 `yarn docs:product:publish`） |
| 产品与界面设计 | [`ui/`](./ui/README.md) | 产品对象是什么、每屏界面的布局/控件/状态/文案 | 产品、设计、工程 | 手写 |
| 工程实现 | [`engineering/`](./engineering/README.md) | 代码如何实现、契约、边界、运维 | 工程师 | 手写 |
| 历史档案 | [`archive/`](./archive/README.md)、[`../old/`](../old/README.md) | 已废弃的设计、旧格式、决策理由 | 需要追溯的人 | 只读 |
| 应用资源（非文档） | `./license-activation.html` | 激活方式意见征集问卷页 | 终端用户 | 由应用运行时打开，**勿移动** |

**冲突裁决**：`manual` 与 `ui` 冲突以 `ui` 为准；`ui` 与 `engineering` 冲突以 `engineering` 为准；`engineering` 与代码冲突以代码为准；`archive` 一律不作为当前行为依据。

## 2. 状态词表

每篇手写文档以 HTML 注释块开头，紧随其后才是标题：

```html
<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: template-editor
superseded-by: docs/engineering/features/template-editor.md
-->
```

| 字段 | 必填 | 取值 |
| --- | --- | --- |
| `status` | 是 | `implemented` / `confirmed` / `draft` / `superseded` / `archived` |
| `product-version` | 是 | 描述生效的版本，如 `0.4.1`、`0.3.x` |
| `audience` | 是 | `user` / `engineer` / `both` |
| `owner` | 是 | 责任域，如 `template-editor`、`docs` |
| `superseded-by` | `superseded` 时必填 | 取代它的文档路径 |

含义：

- `implemented`：只描述代码里**当前存在**的行为；不得出现"计划/将来/应当"。
- `confirmed`：已确认但尚未实现；不得混入 `implemented` 文档。
- `draft`：未定稿的讨论或提案。
- `superseded`：已被取代；只保留入口指向，不再接收内容修改。
- `archived`：历史材料，无继任者。

生成文件不带此注释块，而是带各自的生成标记（如 `<!-- 此文件由产品操作测试自动生成，请勿手工编辑。 -->`）。

## 3. 文档体裁与内容契约

| 体裁 | 位置 | 必填 | 禁写 |
| --- | --- | --- | --- |
| 产品说明书章节 | `manual/` | 见该目录 README | 测试术语、内部实现 |
| 模块设计 | `ui/modules/` | 对象定位、边界、状态与生命周期、关键交互语义、术语、已实现/未实现标注 | 代码路径、类名、IPC、愿景段落 |
| 逐屏 UI 规格 | `ui/screens/` | 见 [`ui/README.md`](./ui/README.md) 模板 | 同上 |
| 工程特性 | `engineering/features/` | 功能状态、功能边界、公共接口、进程/存储边界、数据语义、验证覆盖、已知限制、代码依据 | 未实现规划、重复别处正文 |
| 子系统 | `engineering/subsystems/` | 架构、运行时/生命周期、存储与格式、失败与恢复、运维入口 | 重复特性文档 |
| 决策记录 | `ui/open-questions.md` 或档案内 | 决策、背景、备选、后果 | 描述实现 |

通用禁写：

- 没有范围的"支持 / 安全 / 已接入"。
- 同一内容在第二处展开（必须先链接目标）。
- 把提案写成规格。
- 在 `implemented` 文档中使用未来时态。

## 4. 生成物与应用资源

- `docs/archive/product-docs-0.4.1/**` 是上一代由产品操作测试生成的产物，**已冻结弃用**，见
  [`archive/product-docs-0.4.1/README.md`](./archive/product-docs-0.4.1/README.md)。只读，不再重新生成。
- `docs/license-activation.html` 是随应用分发的资源（`electron-builder.yml` 的 `extraResources`），
  由 `src/main/license.ts` 打开。它不是文档，移动或改写会破坏功能。

## 5. 导航

- 产品与界面设计：[`ui/README.md`](./ui/README.md)
- 工程实现：[`engineering/README.md`](./engineering/README.md)
- 历史档案：[`archive/README.md`](./archive/README.md)、[`../old/README.md`](../old/README.md)
- 测试说明：[`testing.md`](./testing.md)
- 术语表：[`ui/glossary.md`](./ui/glossary.md)
- 未决问题：[`ui/open-questions.md`](./ui/open-questions.md)
- 覆盖面待办：[`engineering/todo/manual-coverage.md`](./engineering/todo/manual-coverage.md)

## 6. 门禁

Docker 外（每次改文档或界面后都应跑）：

- `yarn docs:check`：状态注释块与取值、`implemented` 文档中的未来时态、相对链接可达性、索引完备性，并输出视觉 / 行为锚定率。
- `yarn visual:check`：`docs/ui/screens/UI-*.md` 的视觉锚点 ↔ `tests/visual` ↔ `tests/visual/baselines` 三方一致。
- `yarn copy:check`：扫描 `packages/**`、`src/**` 中面向用户的错误消息，纯英文即失败（规则与落地见 [`ui/open-questions.md`](./ui/open-questions.md) 第 10 条）。
- `yarn lint`、`yarn test:vitest`、`xvfb-run -a yarn test:playwright:run`、`xvfb-run -a yarn test:product-docs:run`。

canonical 容器内（只在能访问 Docker 宿主的机器上跑）：

- `yarn docs:product:check`：重新生成 `docs/manual` 并断言与仓库一致。
- `yarn visual:canonical:check`：断言基线与仓库一致；`yarn visual:publish` 才是唯一的基线写入方式。

界面文案变化会让相关视觉基线过期，必须重新发布基线，否则 CI 的 `canonical_visual` 会失败。命令与限制见
[`../tests/visual/README.md`](../tests/visual/README.md)。

## 7. 重构进度

- **阶段 0（约定）** 已完成：目录骨架、权威地图、状态词表、各体裁内容契约。
- **阶段 1（归档与索引）** 已完成：`features/` 迁入 `docs/engineering/features/`，`design/`、`refactor/` 迁入 `docs/archive/`，`TODO-*.md` 收拢到 `docs/engineering/todo/`，历史层与工程层补齐状态头，修正 `docs/testing.md`、`.github/CI.md` 与产品文档命令的过期描述，`yarn docs:check` 门禁上线（0 错误）。
- **阶段 2（工程对齐）已完成**：`features/` 的事实错误逐条修正；`docs/engineering/subsystems/` 的 P0 子系统文档（exam-package、exam-library、exam-player、submission-workflow）已补齐。
- **阶段 3（UI 规格）已完成**：模块设计文档 7 篇、逐屏 UI 规格 29 篇全部建立并接入索引；视觉回归约定写入 [`../tests/visual/README.md`](../tests/visual/README.md)；`yarn docs:check` 会输出视觉 / 行为锚定率。
- **阶段 4b（视觉回归）已完成**：`tests/visual` 框架与 29 个逐屏规格已建立，`yarn test:visual` 在打包应用上全部通过（本地产物写入 `test-results/visual-preview`）；`yarn visual:check` 校验规格 ↔ 测试 ↔ 基线三方一致。29 篇规格中 27 篇视觉锚定、2 篇 `n/a`（无界面入口）、0 篇视觉 `unverified`；行为锚定 24 篇、5 篇 `unverified`。canonical 容器内用 `yarn visual:publish` 写入基线、`yarn visual:canonical:check` 校验；Docker 外只运行测试、不校验像素。基线与共享渲染镜像、版本标记沿用产品文档那一套。
- **阶段 4a（产品说明书）已产出**：`docs/manual/` 由产品操作测试生成（`README.md` + 5 个章节 + manifest，纯文本、无截图、无逐操作页）。本地命令 `xvfb-run -a yarn docs:manual:local`（需先 `yarn build:test`）；canonical 容器命令为 `yarn docs:product:publish`。覆盖面已从旧层的 20 项扩展到 **30 项**：`EP-01` 首次在同一个数据目录内用界面贯通「评分单元 → 题型 → 题组 → 试卷模板绑定 → 生成试卷 → 加入试卷库」；随后补齐试卷库维护（`EL-01`…`EL-05`：重复导入、损坏包重试、空态与查询失败、删除确认、退出考试确认）与作答记录分支（`SR-02`…`SR-05`：行内单条评分入口、评分报告、导出作答包、删除记录）。
- **阶段 4c（旧产物冻结迁出）已完成**：`docs/product` 已迁入 `docs/archive/product-docs-0.4.1/`（只读）；reporter 的归属设计校验改指 `docs/ui/modules/<slug>.md`；canonical publish 只生成 `docs/manual`，`yarn docs:product:check` 只校验 `docs/manual`。
- **阶段 4e（工程缺口补齐）已完成**：新增 `engineering/features/license.md`、`installation-marker.md`、`logger.md`、`secret-store.md` 与 `engineering/subsystems/startup-orchestration.md`、`builtin-content.md`、`legacy-data.md`，`docs/engineering/todo/logger.md` 只保留未实现部分。
- **阶段 4g（质量门禁补齐）已完成**：`yarn typecheck` 从"solution 文件空转"改为真实的 `tsc -b tsconfig.json`（主进程 + 20 个包，0 错误；主进程产物写入 `.tsbuild/`）；`yarn copy:check` 新增用户可见错误文案门禁（包内英文错误一律失败，见 [`ui/open-questions.md`](./ui/open-questions.md) 第 10 条）；`tests/visual` 增加一像素敏感度单元测试与 `yarn visual:verify-determinism`（宿主机连续两次发布比对）。
- **阶段 4f（界面用词对齐，D1）已完成**：界面与主进程面向用户的文案改为术语表用词（`Schema`→评分单元、`Interface`→题型、`Instance`→题组、`Timeline`→时间线、`Collector`→采集器、`revision`→版本、`Provider`→服务商、`ID`→编号、`API Key`→API 密钥，另含 `Template 输入`→`试卷模板输入`、`ChoiceView`→`选择题视图`、`提供商`→`服务商`）；内置模板「生成试卷」的禁用提示由错误码改为人类可读消息。对照表见 [`ui/glossary.md`](./ui/glossary.md)，落地记录见 [`ui/open-questions.md`](./ui/open-questions.md) 第 1 条。视觉基线随本批重建。

**未完成**：

- 阶段 4b 的视觉锚定已全部完成，但仍有 5 篇规格的**行为**锚定为 `unverified`：`UI-GS-03` 评分单元草稿库、`UI-GS-04` 评分单元草稿编辑器、`UI-ST-01` 设置总览、`UI-ST-03` 许可、`UI-ST-05` 关于。集成测试目前只覆盖这些页面的入口与标题可见性，未覆盖页内行为。
- 阶段 4a 的其余覆盖面（生成→运行→导入作答→评分→结算、麦克风录音路径、AI 评分与抽查、设置与 AI 配置）见 [`engineering/todo/manual-coverage.md`](./engineering/todo/manual-coverage.md)。

重构方案已归档：[`archive/docs-revision-plan.md`](./archive/docs-revision-plan.md)。

