<!--
status: implemented
product-version: 0.4.1
audience: both
owner: workbench
-->

# 工作台 · UI-WB-01

- 路由：`/`
- 入口：应用启动后的默认页面；一级导航「工作台」
- 对象：只读汇总试卷、作答记录、题型、题组草稿、试卷模板、评分单元

## 布局

单列内容区（`WorkbenchPage.module.css` 的 `.page` / `.inner`），自上而下四个区域：

1. `intro`：左侧产品标题与英语摘句，右侧装饰性波形图（`aria-hidden`，不承载信息）。
2. `quickActions`（`aria-label="快捷操作"`）：三张快捷卡片。
3. `statusBand`（`aria-label="当前状态"`）：五项统计。
4. `contentGrid`：两列，左列「最近工作」，右列「待处理」。

## 控件清单

| 名称 | 类型 | 默认 / 加载 / 禁用 / 错误 | 触发结果 | 快捷键 |
| --- | --- | --- | --- | --- |
| 制作试卷 | 按钮，主操作 | 加载中副标题为「正在汇总」 | 导航 `/templates` | 无 |
| 进入试卷库 | 按钮 | 加载中副标题为「正在汇总」 | 导航 `/exams` | 无 |
| 处理作答记录 | 按钮 | 加载中副标题为「正在汇总」 | 导航 `/submissions` | 无 |
| 最近工作条目（最多 4 条） | 按钮 | 加载中不渲染，改显示「正在汇总最近工作...」 | 导航到对应对象 | 无 |
| 前往试卷模板 | 按钮 | 仅「最近工作」为空时出现 | 导航 `/templates` | 无 |
| 查看作答记录 | 按钮 | 无 | 导航 `/submissions` | 无 |

统计项「试卷 / 待评分 / 题型 / 试卷模板 / 评分单元」为只读文本，加载中显示 `–`，不可点击。

## 文案

固定文本：

- eyebrow：`LS101 · 英语听说工作台`
- 标题：`工作台`
- 快捷卡片：`制作试卷` / `基于模板生成听说试卷`；`进入试卷库` / `${试卷数} 份试卷可以运行`；`处理作答记录` / `${待评分数} 份作答等待评分`
- 统计标签：`试卷`、`待评分`、`题型`、`试卷模板`、`评分单元`
- 最近工作：副标题 `继续上次未完成的内容`；加载中 `正在汇总最近工作...`；空状态 `还没有最近工作`、`创建试卷模板后会显示在这里`、按钮 `前往试卷模板`；条目状态 `可运行`（试卷）、`已结算`/`可结算`/`待评分`（作答）、`模板`
- 待处理：副标题 `作答评分进度`；`份等待评分`；`全部作答`；`已完成`；按钮 `查看作答记录`；`未完成题型`
- 数据不可用时，「最近工作」副标题改为 `部分状态暂不可用`
- 装饰性文本（`aria-hidden`，不可被测试定位）：`LISTEN / SPEAK`、`LS — 101`、`01`、`听力 · 口语 · 语言运用`、`101`

摘句（每次加载显示其中一条，含中文译文与作者）：

| 原文 | 译文 | 作者 |
| --- | --- | --- |
| Language is the dress of thought. | 语言，是思想穿上的衣裳。 | Samuel Johnson |
| The limits of my language mean the limits of my world. | 语言的边界，也标记着世界的边界。 | Ludwig Wittgenstein |
| A different language is a different vision of life. | 换一种语言，也就换一种观看生活的方式。 | Federico Fellini |
| Knowledge of languages is the doorway to wisdom. | 懂得语言，便多了一扇通往智慧的门。 | Roger Bacon |

## 状态与恢复

- **加载中**：`Promise.all` 未完成时，快捷卡片副标题为「正在汇总」，统计值为 `–`，「最近工作」显示「正在汇总最近工作...」，「待处理」数字与百分比为 `–`。
- **数据不可用**：任一仓储查询失败时，仅把「最近工作」副标题改为「部分状态暂不可用」，统计值停留在 0，加载结束。页面不提供页内重试入口；重新进入页面会重新查询。
- **空状态**：「最近工作」为空时显示空状态块与「前往试卷模板」按钮。
- **无写入**：页面不修改任何对象。

「待处理」的百分比 = 已结算数 ÷（待评分 + 已结算）× 100，四舍五入；无作答时为 0%。

## 有损操作

无。工作台不执行删除、覆盖、结算或任何不可逆操作。

## 术语

`工作台`、`试卷`、`作答记录`、`题型`、`试卷模板`、`评分单元`，与 [`../glossary.md`](../glossary.md) 一致。
界面不出现 `Schema`、`Template`、`Interface` 等内部术语。

## 产物

无。所有入口都导航到其他模块，工作台自身不产生业务对象。

## 锚点

```yaml
anchors:
  visual: VR-WB-01（tests/visual/workbench/UI-WB-01.spec.ts）
  visual-states: [default]
  behavior: WB-01, WB-02（tests/product-docs/modules/workbench/navigation.spec.ts，旧套件）
```

**视觉确定性**：摘句由模块加载时的 `Math.random()` 选择（`packages/renderer/src/pages/WorkbenchPage.tsx` 的 `STARTUP_QUOTE`）。
canonical 运行通过 `--js-flags=--random-seed=1`（`tests/integration/support/electron-app.ts:72-73`）固定该随机序列，
因此基线可复现；建立逐屏视觉回归时必须保留该种子，否则需对摘句区域做遮罩。
