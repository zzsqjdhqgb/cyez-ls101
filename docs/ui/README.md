<!--
status: implemented
product-version: 0.4.1
audience: both
owner: ui
-->

# 产品与界面设计

本目录是**产品与界面设计的权威**，手写维护，不从代码或测试生成。
它回答"产品对象是什么"和"每一屏界面具体长什么样"，是 UI 实现与视觉回归的共同依据。

目录：

| 路径 | 内容 |
| --- | --- |
| `modules/<module>.md` | 模块级：对象定位、边界、状态与生命周期、关键交互语义 |
| [`screens/`](./screens/README.md) | 逐屏 UI 规格（索引见该目录 README） |
| [`glossary.md`](./glossary.md) | 用户可见术语 ↔ 代码术语 |
| [`open-questions.md`](./open-questions.md) | 唯一未决清单 |
| `coverage.md` | 生成：索引与锚定状态 |

## 1. 逐屏 UI 规格模板

一屏一篇，编号 `UI-<模块>-<序号>`（模块用一级导航缩写，如 `WB`/`EL`/`SR`/`IF`/`TP`/`GS`/`ST`）。

````markdown
<!--
status: implemented
product-version: 0.4.1
audience: both
owner: interface-library
-->

# 题组内容编辑 · UI-IF-03

- 路由：`/interfaces/:interfaceId/groups/:groupId`
- 入口：题型库详情 → 题组列表 → 点击题组
- 对象：题组、题型

## 布局

区域划分、默认选中、主次层级、可调整尺寸约束。

## 控件清单

| 名称 | 类型 | 默认 / 悬停 / 禁用 / 加载 / 错误 | 触发结果 | 快捷键 |
| --- | --- | --- | --- | --- |

## 文案

标题、按钮、空状态、错误、确认框的**准确文本**（可被测试直接引用）。

## 状态与恢复

空、加载、失败、中断、冲突、未保存离开。

## 有损操作

删除、覆盖、重置、结算的确认措辞与后果，是否可逆。

## 术语

本屏出现的用户可见词，须与 [`glossary.md`](./glossary.md) 一致。

## 产物

完成后的对象与下一步入口。

## 锚点

```yaml
anchors:
  visual: VR-IF-03（tests/visual/interfaces/UI-IF-03.spec.ts）
  visual-states: [default]     # 单行、非空、无重复的 kebab-case 状态名列表
  behavior: unverified        # 产品/集成测试 ID；无则写 unverified
```
````

## 2. 锚定规则

- 每个界面要么被视觉或行为测试锚定，要么显式写 `unverified`。**不允许留空。**
- 视觉锚点与 `tests/visual/` 一一对应：一个 `UI-*` 页面 ↔ 一个视觉测试文件，文件名即 ID。
- 状态级不要求 1:1：一屏可声明多个状态（`default`、`empty`、`validation-error` 等），
  在 `anchors.visual-states` 中手写维护；`unverified` 或 `n/a` 不要求此字段。
  校验规则是**规格声明的状态集合 == 测试实际捕获的状态集合 == 磁盘上的基线集合**。
- 权限：只有 canonical 渲染容器能生成/更新基线，本地运行只产 diff。
  完整约定见 [`../../tests/visual/README.md`](../../tests/visual/README.md)。

## 3. 写作约束

- 只写**可观察、可验证**的内容：控件、状态、文案、后果。
  禁止"以用户为中心""提升体验"这类无法证伪的表述。
- 引用代码或测试时只写 ID 或路径，不在正文展开实现细节。
- 界面行为变化时先改本目录，再改测试，最后让视觉基线更新。
- 与代码冲突：以代码（v0.4.1）为准，并修正本目录。

## 4. 当前状态

逐屏规格已覆盖全部一级模块的主要界面（工作台、试卷库、作答记录、题型库、试卷模板、评分单元、设置与覆盖层），
覆盖清单与状态见 [`screens/README.md`](./screens/README.md)。
视觉回归约定已写入 [`../../tests/visual/README.md`](../../tests/visual/README.md)，实现按
[`../DOCS-REVISION-PLAN.md`](../../DOCS-REVISION-PLAN.md) 阶段 4b 进行。
