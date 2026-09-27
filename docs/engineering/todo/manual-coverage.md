<!--
status: draft
product-version: 0.4.2
audience: engineer
owner: docs
-->

# 说明书待补内容

`docs/manual/README.md` 是**手写**的单文件说明书，不再由产品操作测试生成。本文件记录还没写的内容，以及写之前需要先解决的事。

## 1. 当前覆盖

- 已写：封面与修订记录、一、运行环境与安装、二、界面与基本操作、三、工作台、四、评分单元、五、题型库、六、试卷模板、七、试卷库、八、作答记录、九、设置。
- 配图：`tests/manual/figures/**` 的用例捕获，基线在 `tests/manual/baselines/**`；数量以 `yarn manual:figures:check` 输出为准。
- 导出：`yarn manual:pdf` 生成 A4 PDF（默认写到 `test-results/manual-pdf/`）。

## 2. 还没写的内容

九个章节已成稿，仍缺的是跨章节的收尾内容：

| 内容       | 要写什么                                       | 需要的配图界面                    |
| ---------- | ---------------------------------------------- | --------------------------------- |
| 常见问题   | 启动失败、麦克风检测、导入失败、AI 不可用      | 视情况                            |
| 数据与备份 | 数据目录迁移与备份的完整步骤（现暂居 1.5 节）  | `UI-ST-02`                        |
| 版本说明   | 0.4.2 的版本说明正文（`release-notes/releases/0.4.2.md` 与 `latestReleaseVersion`） | 补好后需重跑配图：`FIG-RELEASE-NOTES`、`FIG-ST-ABOUT` |

逐屏的控件、文案与状态以 [`docs/ui/screens/`](../../ui/screens/README.md) 为权威来源；写某一章前先读对应规格。

## 3. 编写时要用的机制

1. **环境痕迹**：配图前会调用 `normalizeEnvironmentArtifacts()`，把 Linux 测试数据目录替换为 Windows 示例路径、把打包版本号去掉 `-local.` 后缀，因此界面里不会出现测试环境痕迹。「设置 → 存储」的数据目录图即由此可用。
2. **版本号**：配图显示的版本号取自打包版本（去掉 `-local.` 后缀），随 `package.json` 版本变化，不需要手工改图。
3. **夹具与媒体桩**：考试运行、AI 评分这些界面用 `tests/manual/support/manual-fixtures.ts` 里的夹具构造确定性起点；麦克风与音频播放仍靠集成测试里的媒体桩，配图只用静态状态。
4. **新增章节**：手册是单文件，新增小节直接插入 `docs/manual/README.md`，同步图号（图号按正文顺序连续编号）。

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
