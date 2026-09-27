<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: docs
-->

# 说明书配图

本目录为 `docs/manual/`（产品说明书）生成配图，并做与逐屏视觉回归同等级的回归校验。

**与 [`../visual/`](../visual/README.md) 的关系：复用同一套确定性启动、同一个 canonical 渲染镜像与同一套"预览 / 发布 / 校验"纪律，但产物、配置、运行命令与门禁全部独立，配图基线不并入 `tests/visual/baselines`。**

## 目录

```text
tests/manual/
  figures/<主题>.spec.ts                    配图用例（captureFigure 声明图号与状态）
  baselines/<图号>/<状态>.png               配图基线（canonical 生成并提交）
  support/manual-app.ts                     启动、截图、数据目录
playwright.manual.config.ts                 独立 Playwright 配置
```

说明书正文按下述形式引用：

```markdown
![图 5-1 工作台](../../tests/manual/baselines/FIG-WORKBENCH/empty.png)
```

## 图号与状态

- 图号使用 `FIG-<主题>`，主题是稳定的英文短名（如 `FIG-WORKBENCH`、`FIG-SHELL-NAV`、`FIG-ACTIVATION`），**不编码章节号**：章节调整时只改正文的「图 X-Y」编号，不动基线文件名。
- 状态使用不带引号的 kebab-case，同一界面有多个有意义的状态时各自成图（例如 `FIG-SHELL-NAV` 的 `default` 与 `collapsed`）。
- 同一张基线不得在正文里重复使用；确有必要时 `yarn manual:figures:check` 会给出警告。

## 运行模式（Docker 边界）

| 模式      | 触发方式                                                | 截图去向                       | 是否校验像素         |
| --------- | ------------------------------------------------------- | ------------------------------ | -------------------- |
| `preview` | Docker 外，`yarn test:manual-figures`                   | `test-results/manual-preview/` | 否，只验证用例通过   |
| `publish` | canonical 容器内，`yarn manual:figures:publish`         | `tests/manual/baselines/`      | 写入基线             |
| `check`   | canonical 容器内，`yarn manual:figures:canonical:check` | 不写文件                       | 是，与已提交基线比较 |

规则与视觉回归一致：**只有专用渲染容器可以写入或校验配图基线**；容器外允许运行套件，但不做像素校验。
`LS101_MANUAL_MODE` / `LS101_MANUAL_CANONICAL` 由容器内 runner 设置，外部传入会被拒绝。

```bash
yarn test:manual-figures             # Docker 外：运行用例，截图写入 test-results/manual-preview
yarn manual:figures:check            # Docker 外：校验 正文 ↔ 用例 ↔ 基线 三方一致
yarn manual:figures:image            # 构建/复用共享渲染镜像
yarn manual:figures:publish          # canonical 容器内：写入 tests/manual/baselines
yarn manual:figures:canonical:check  # canonical 容器内：校验基线与仓库一致
```

## 确定性

配图使用与视觉基线完全相同的确定性策略（固定时钟、确定性 UUID、固定随机序列、稳定路径的用户数据目录、固定 `1280 × 800` / `1x` 内容区、连续两帧一致后截图、禁用动画），
详见 [`../visual/README.md`](../visual/README.md) §4。canonical 发布同样使用 `build:test:visual` 的固定版本后缀，两套产物在同一渲染环境下像素一致。

改动确定性策略或界面文案后，配图基线同样必须重新发布，否则 `yarn manual:figures:canonical:check` 会失败。

## 三方一致校验

`yarn manual:figures:check` 校验：

1. 说明书正文引用的每张配图都存在于 `tests/manual/baselines/`；
2. 每张基线都被正文引用（无孤儿配图）；
3. 每个 `captureFigure(page, '<图号>'[, '<状态>'])` 声明都有基线（无陈旧基线）。

另有两条纪律：正文引用逐屏视觉基线（`tests/visual/baselines/`）即失败；同一基线被多处引用给出警告。
整个基线目录尚未建立时（尚未做过 canonical 发布）只校验正文与用例的一致性。

## 预算

- 一张图只表达一件事：一个界面状态、一个对话框或一处关键交互结果。
- 不复用同一张图讲两件事，也不为凑数量添加装饰性截图。
- 图必须由本目录的用例生成，禁止手工截图或从其他目录复制。
