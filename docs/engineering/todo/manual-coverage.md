<!--
status: draft
product-version: 0.4.1
audience: engineer
owner: docs
-->

# 说明书待补内容

`docs/manual/README.md` 是**手写**的单文件说明书，不再由产品操作测试生成。本文件记录还没写的内容，以及写之前需要先解决的事。

## 1. 当前覆盖

- 已写：名词说明、一、运行环境、二、安装与启动、三、界面与基本操作、四、工作台。
- 配图：`tests/manual/figures/**` 的用例捕获，基线在 `tests/manual/baselines/**`；数量以 `yarn manual:figures:check` 输出为准。
- 导出：`yarn manual:pdf` 生成 A4 PDF（默认写到 `test-results/manual-pdf/`）。

## 2. 待写内容

续写时接在「四、工作台」之后，按做事的顺序排：先评分单元、题型、组卷、考试、评分结算，再设置与数据管理，最后常见问题。

| 内容           | 要写什么                                   | 需要的配图界面            |
| -------------- | ------------------------------------------ | ------------------------- |
| 评分单元       | 库页、定义页、新建 / 复制 / 导出           | `UI-GS-01`、`UI-GS-02`    |
| 题型库         | 草稿与发布、题组、导入与导出               | `UI-IF-01`…`UI-IF-06`     |
| 试卷模板       | 模板编辑器、函数库、内置模板、生成试卷     | `UI-TP-01`…`UI-TP-05`     |
| 试卷库         | 导入、运行、导出、删除                     | `UI-EL-01`                |
| 考试运行       | 身份登记、播放、录音、生成作答包           | `UI-EL-02`                |
| 作答记录与评分 | 列表、评分工作台、AI 评分与抽查            | `UI-SR-01`、`UI-SR-02`    |
| 评分结算       | 结算、评分报告、导出结果                   | `UI-SR-03`                |
| 设置           | 存储、外观、许可、关于、AI 引擎            | `UI-ST-01`…`UI-ST-06`     |
| 数据与备份     | 数据目录与迁移（现暂居「二、安装与启动」） | `UI-ST-02`（受阻，见 §3） |
| 常见问题       | 启动失败、麦克风检测、导入失败、AI 不可用  | 视情况                    |

逐屏的控件、文案与状态以 [`docs/ui/screens/`](../../ui/screens/README.md) 为权威来源；写某一章前先读对应规格。

## 3. 写之前要解决的事

1. **配图里的环境痕迹**：「设置 → 存储」会显示数据目录路径，而配图跑在测试环境里，路径是 Linux 下的临时目录，与"只支持 Windows"的说明矛盾，因此该页暂不配图。要用图需要给配图套件加**遮罩**能力（对路径文本区域打码）。
2. **版本号**：配图使用与视觉基线相同的确定性打包版本，界面显示 `0.4.1-local.visual`（第 3 章的「版本说明」图可见）。要让手册显示正式版本号，需要让应用在没有 `-local.` 标记时也能进入测试模式，属代码改动。
3. **夹具与媒体桩**：考试运行、AI 评分、麦克风录音这些界面需要夹具或媒体桩才能稳定截图；现成的夹具在 `tests/visual/support/fixtures.ts`，媒体桩目前只在集成测试里。
4. **章节编号**：章节文件用 `NN-<slug>.md`，插入新章会牵动后续编号，改文件名时同步改正文里的交叉引用。

## 4. 与测试的关系

说明书改为手写后，"测试声明多少操作，说明书就写多少操作"的约束已经取消。`tests/product-docs/**` 仍然保留，作为产品行为的回归网：写一章之前，先跑一遍对应模块的用例，确认界面上真实存在的按钮与文案，再据此写正文。

## 5. 编写与核对纪律

说明书的每一节按模块对待，事实必须可回溯，不凭印象编写。逐章依据：

| 手册章节         | 事实依据                                                                                                                     |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1 运行环境与安装 | `engineering/features/data-directory.md`、`license.md`、`legacy-data.md`、`startup-orchestration.md`；数据目录实测自打包应用 |
| 2 界面与基本操作 | 界面源码与 `tests/integration/electron-app.spec.ts`；应用外壳尚无 UI 规格                                                    |
| 3 工作台         | `ui/screens/UI-WB-01.md`、`ui/modules/workbench.md`                                                                          |
| 4 评分单元       | `ui/screens/UI-GS-01.md`、`UI-GS-02.md`、`ui/modules/grading-units.md`                                                       |
| 5 题型库         | `ui/screens/UI-IF-01.md`…`UI-IF-06.md`、`ui/modules/interface-library.md`                                                    |
| 6 试卷模板       | `ui/screens/UI-TP-01.md`…`UI-TP-05.md`、`ui/modules/template-library.md`                                                     |
| 7 试卷库         | `ui/screens/UI-EL-01.md`、`UI-EL-02.md`、`ui/modules/exam-library.md`                                                        |
| 8 作答记录       | `ui/screens/UI-SR-01.md`…`UI-SR-03.md`、`ui/modules/submission-records.md`                                                   |
| 9 设置           | `ui/screens/UI-ST-01.md`…`UI-ST-06.md`、`ui/modules/settings.md`                                                             |

两条机器门禁保证"不凭印象编写"：

- `yarn manual:copy:check`：正文里用「」引用的界面文字，必须能在规格、界面源码或内置内容中找到；找不到就改手册，或者先补规格。
- `yarn manual:figures:check`：正文引用的每张配图都必须有对应截图用例与基线。

新增或修改章节时：先读上表对应的规格再动笔；需要新界面配图时，先补 `tests/manual/figures/**` 的用例；写完跑 `yarn docs:check && yarn manual:copy:check && yarn manual:figures:check`。
