<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: testing
-->

# 逐屏视觉回归

本目录存放与 [`docs/ui/screens/`](../../docs/ui/screens/README.md) **一一对应**的逐屏视觉回归测试与基线。

**当前状态：测试框架与运行模式已实现，22 个规格在 Docker 外全部通过。canonical 基线尚未生成（需首次在专用容器内运行 `yarn visual:publish`）。**

## 0. 运行模式（Docker 边界）

| 模式 | 触发方式 | 截图去向 | 是否校验像素 |
| --- | --- | --- | --- |
| `preview` | Docker 外，`yarn test:visual` | `test-results/visual-preview/` | **否**，只验证测试通过 |
| `publish` | canonical 容器内，`yarn visual:publish` | `tests/visual/baselines/` | 写入基线 |
| `check` | canonical 容器内，`yarn visual:canonical:check` | 不写文件 | **是**，与已提交基线比较 |

规则：**只有专用渲染容器可以写入或校验视觉基线**；容器外允许运行套件，但不做像素校验。
`LS101_VISUAL_MODE` / `LS101_VISUAL_CANONICAL` 由容器内 runner 设置，外部传入会被拒绝。

## 1. 一一对应

- **屏幕级 1:1**：一个 `UI-<模块>-<序号>` 规格页 ↔ 一个视觉测试文件，文件名即 ID。
- **状态级 1:N**：截图数量由规格页声明，不要求 1:1。

```text
docs/ui/screens/UI-IF-04.md                       ← 手写规格（权威）
tests/visual/interfaces/UI-IF-04.spec.ts          ← 视觉测试
tests/visual/baselines/UI-IF-04/default.png       ← 基线（canonical 生成并提交）
```

规格页在 `## 锚点` 中声明：

```yaml
anchors:
  visual: VR-IF-04        # 或 n/a（原因）
```

## 2. 一致性校验

**规格声明的状态集合 == 测试实际捕获的状态集合 == 磁盘上的基线集合。**

三者任一不等即失败：

- 声明了但未捕获 → 缺锚；
- 捕获了但未声明 → 测试越权定义规格；
- 磁盘存在未声明的基线 → 陈旧基线。

`yarn visual:check` 在本地校验规格 ↔ 测试（无基线时不比较第三项）；容器内的 `check` 模式在此之上比较像素。

## 3. 方向

**规格 → 测试。** 规格页手写并声明状态；测试必须引用该 `UI-*` 并覆盖它声明的状态。
禁止由测试定义状态、再据此生成或改写规格。

## 4. 确定性

- 内容区固定 `1280 × 800`，设备倍率 `1`。
- 复用产品文档的确定性设施：固定时钟、确定性 UUID、`--js-flags=--random-seed=1`。
- 动态内容（姓名、考生号、时间、模型输出、随机摘句）必须固定种子或遮罩。
  例：工作台摘句由 `Math.random()` 选择，依赖上述随机种子保持稳定
  （见 [`UI-WB-01`](../../docs/ui/screens/UI-WB-01.md)）。
- 禁用动画依赖；等待界面稳定后再截图。
- 基线写入与比较只在 `docker/product-docs/` 的共享渲染镜像内进行，不新建第二套渲染环境。

## 5. 例外

系统文件对话框、OS 原生弹窗等无法稳定截屏的界面，在规格中写 `visual: n/a（原因）`。
禁止为凑齐 1:1 编写无法稳定断言的假测试。

## 6. 入口确定性

- 每个套件独立到达目标界面，不依赖其他测试留下的数据或页面状态。
- 沉浸式/专注式界面（考试播放器、结算页）使用准备好的 `.lsexam` 或评分会话夹具
  （见 `support/fixtures.ts`）；沿用"旅程不许用夹具、模块操作允许构造前置"的既有区分。
- 禁止依赖真实用户目录、真实 AI 服务或网络。

## 7. 预算

- 每个界面默认只保留 1 张默认态基线。
- 高风险界面最多再加 2–3 个状态（空、错误、有损确认）。
- 沿用产品文档的"每项操作 ≤ 3 张证据截图"预算。

## 8. 报告

- 索引与锚定状态汇总写入 `docs/ui/coverage.md`（生成）：页面、状态数、视觉锚点、行为锚点。
- 差异图与 trace 写入 `test-results/`，不提交。

## 9. 命令

```bash
yarn test:visual              # Docker 外：运行套件，只验证测试通过，截图写入 test-results/visual-preview
yarn visual:check             # Docker 外：校验 规格 ↔ 测试 ↔ 基线 配对
yarn visual:image             # 构建/复用共享渲染镜像
yarn visual:publish           # canonical 容器内：写入 tests/visual/baselines
yarn visual:canonical:check   # canonical 容器内：校验基线与仓库一致（差异即失败）
```

`visual:publish` / `visual:canonical:check` 会先 `yarn install --immutable`、`yarn build:test`，再在 Xvfb 下运行套件；
`check` 结束后用 `git status --porcelain -- tests/visual/baselines` 断言基线未被改动。
