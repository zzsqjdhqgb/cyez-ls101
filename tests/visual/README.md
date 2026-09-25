<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: testing
-->

# 逐屏视觉回归

本目录存放与 [`docs/ui/screens/`](../../docs/ui/screens/README.md) **一一对应**的逐屏视觉回归测试与基线。

**当前状态：22 个规格已声明截图状态并配有测试与 canonical 基线；CI 校验规格、测试与基线的状态集合，再由专用容器校验像素。**

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
  visual: VR-IF-04（tests/visual/interfaces/UI-IF-04.spec.ts）
  visual-states: [default]
```

`visual-states` 使用单行列表，状态名使用不带引号的 kebab-case，不可为空或重复。
测试用 `captureState(page, 'UI-IF-04', 'default')` 这样的字符串字面量声明捕获状态。
`visual: unverified` 或 `visual: n/a（原因）` 不要求声明截图状态。

## 2. 一致性校验

**规格声明的状态集合 == 测试实际捕获的状态集合 == 磁盘上的基线集合。**

三者任一不等即失败：

- 声明了但未捕获 → 缺锚；
- 捕获了但未声明 → 测试越权定义规格；
- 磁盘存在未声明的基线 → 陈旧基线。

`yarn visual:check` 始终校验规格 ↔ 测试；整个基线目录尚未建立时不比较第三项。
基线根目录存在后，缺少任何已锚定界面的目录或状态图片都会失败。
CI 在安装依赖前运行文档与视觉配对检查；容器内的 `check` 模式也先校验配对，再比较像素。

## 3. 方向

**规格 → 测试。** 规格页手写并声明状态；测试必须引用该 `UI-*` 并覆盖它声明的状态。
禁止由测试定义状态、再据此生成或改写规格。

## 4. 确定性

基线必须可逐字节复现。`launchVisualApp` 在界面加载后、任何交互之前安装以下确定性来源
（`tests/visual/support/determinism.ts`，与旧产品文档测试的 `prepareProductPage` 同源）：

| 来源 | 处理 |
| --- | --- |
| 时钟与日期文案 | `page.clock.setFixedTime(2026-01-15T08:00:00.000Z)` |
| 对象身份 / 节点 ID | `crypto.randomUUID` 替换为确定性递增序列 `00000000-0000-4000-8000-0000000000NN` |
| 随机摘句与随机顺序 | `Math.random` 替换为确定性 xorshift32（启动参数 `--js-flags=--random-seed=1` 只约束 V8 初始种子，不足以覆盖所有隔离环境） |
| 数据目录路径 | 使用**稳定路径**的用户数据目录（`prepareVisualUserDataDir()` 按规格文件名派生并清空），不使用随机临时目录；否则界面上显示的路径每轮都变 |
| 应用版本号 | canonical 视觉构建使用**固定版本后缀**：`yarn build:test:visual` = `--local ... --version-suffix local.visual`，版本恒为 `0.4.1-local.visual`。注意 `-local.` 标记是必需的：打包测试模式下 `src/main/index.ts` 用它启用明文 safeStorage，`src/main/application-services.ts` 用它接受许可证测试码与固定时钟；去掉它（例如改用正式版 `0.4.1`）会让应用卡在启动或进入激活页。固定的只是后缀，因此版本不随提交变化 |
| 内容区 | 固定 `1280 × 800`，设备倍率 `1` |
| 异步渲染 | 截图前先 settle，再等待**连续两帧字节完全一致**后才写入 |
| 动画 | 禁用动画依赖（`animations: 'disabled'`） |

规则：任何会影响渲染且上面未覆盖的动态内容，都必须**固定种子或遮罩**，不允许放任漂移。
验证方式：连续两次运行套件，比较 `test-results/visual-preview/**/*.png` 的哈希；不一致即视为基线不可复现。

> 注意：改动确定性策略（时钟、UUID、随机数、用户数据目录、稳定帧）后，**已提交的基线必须重新生成**，
> 否则容器内的 `check` 会因为旧基线而失败。
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

- 索引与锚定状态汇总由 `yarn visual:check` 输出（规格数、已锚定 / 未验证 / `n/a`）；当前没有生成 `docs/ui/coverage.md` 的脚本，逐屏状态以 `docs/ui/screens/README.md` 为准。
- 像素比较失败时，实际截图、基线副本和差异图写入 `test-results/visual/`，并作为附件加入 Playwright 报告，不提交。
- 缺少基线时保留实际截图；尺寸不同或基线无法解码时保留两张输入，不生成像素差异图。
- CI 失败时上传上述诊断、已提交基线和 `playwright-report/`，保留 14 天。

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

这两个命令必须在能访问 Docker 宿主的机器上运行。开发容器当前不能代跑：Docker bind mount 的源路径由宿主 daemon 解析，
容器内的仓库路径（`/workspace`）在宿主上不存在。现状与后续方案见
[`../../docs/engineering/todo/dev-container-docker.md`](../../docs/engineering/todo/dev-container-docker.md)。
界面文案变化会让所有相关基线过期，改动文案后必须重新执行 `yarn visual:image && yarn visual:publish` 并提交
`tests/visual/baselines`，否则 `yarn visual:canonical:check` 会失败。

没有自动化覆盖的两条性质（需要时在宿主机上人工核验）：连续两次 `yarn visual:publish` 是否产生字节一致的 PNG，
以及"故意改动一个像素必然导致对应基线出现差异"。`stableScreenshot` 只保证单次运行内取两帧一致。

