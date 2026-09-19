<!--
status: confirmed
product-version: 0.4.1
audience: engineer
owner: testing
-->

# 逐屏视觉回归

本目录将存放与 [`docs/ui/screens/`](../../docs/ui/screens/README.md) **一一对应**的逐屏视觉回归测试与基线。

**当前状态：测试框架已建立，首个规格在本地通过（工作台默认态）。canonical 基线与规格 ↔ 测试 ↔ 基线配对校验尚未启用。**

## 1. 一一对应

- **屏幕级 1:1**：一个 `UI-<模块>-<序号>` 规格页 ↔ 一个视觉测试文件，文件名即 ID。
- **状态级 1:N**：截图数量由规格页声明，不要求 1:1。

```text
docs/ui/screens/UI-IF-03.md                       ← 手写规格（权威）
tests/visual/interface-library/UI-IF-03.spec.ts   ← 视觉测试
tests/visual/baselines/UI-IF-03/default.png       ← 基线（生成并提交）
tests/visual/baselines/UI-IF-03/validation-error.png
```

规格页在 `## 锚点` 中声明：

```yaml
anchors:
  visual: VR-IF-03        # 或 n/a（原因）
```

## 2. 一致性校验

**规格声明的状态集合 == 测试实际捕获的状态集合 == 磁盘上的基线集合。**

三者任一不等即失败：

- 声明了但未捕获 → 缺锚；
- 捕获了但未声明 → 测试越权定义规格；
- 磁盘存在未声明的基线 → 陈旧基线。

该检查复用产品文档 reporter 已有的"声明步骤 vs 实际执行步骤一致"逻辑。

## 3. 方向

**规格 → 测试。** 规格页手写并声明状态；测试必须引用该 `UI-*` 并覆盖它声明的状态。
禁止由测试定义状态、再据此生成或改写规格。

## 4. 确定性

只有 canonical 渲染容器可以生成或更新基线；本地运行只产生 diff。

- 内容区固定 `1280 × 800`，设备倍率 `1`。
- 复用产品文档的确定性设施：固定时钟、确定性 UUID、`--js-flags=--random-seed=1`。
- 动态内容（姓名、考生号、时间、模型输出、随机摘句）必须固定种子或遮罩。
  例：工作台摘句由 `Math.random()` 选择，依赖上述随机种子保持稳定
  （见 [`UI-WB-01`](../../docs/ui/screens/UI-WB-01.md)）。
- 禁用动画依赖；等待界面稳定后再截图。

## 5. 例外

系统文件对话框、OS 原生弹窗等无法稳定截屏的界面，在规格中写 `visual: n/a（原因）`。
禁止为凑齐 1:1 编写无法稳定断言的假测试。

## 6. 入口确定性

- 每个套件独立到达目标界面，不依赖其他测试留下的数据或页面状态。
- 沉浸式/专注式界面（考试播放器、结算页）使用准备好的 `.lsexam` 或评分会话夹具；
  沿用"旅程不许用夹具、模块操作允许构造前置"的既有区分。
- 禁止依赖真实用户目录、真实 AI 服务或网络。

## 7. 预算

- 每个界面默认只保留 1 张默认态基线。
- 高风险界面最多再加 2–3 个状态（空、错误、有损确认）。
- 沿用产品文档的"每项操作 ≤ 3 张证据截图"预算。

## 8. 报告

- 索引与锚定状态汇总写入 `docs/ui/coverage.md`（生成）：页面、状态数、视觉锚点、行为锚点。
- 差异图与 trace 写入 `test-results/`，不提交。

## 9. 规划命令

```bash
yarn test:visual       # 本地运行逐屏视觉测试，产物写入 test-results/visual-preview（已可用）
yarn visual:check      # 校验 规格 ↔ 测试 ↔ 基线 三方一致（已可用；无基线时校验规格↔测试）
yarn visual:update     # 仅在 canonical 容器内更新基线（规划中）
```

实现时复用 `docker/product-docs/` 的 canonical 镜像与版本标记，不新建第二套渲染环境。
