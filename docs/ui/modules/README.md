<!--
status: implemented
product-version: 0.4.1
audience: both
owner: ui
-->

# 模块设计文档

本目录为每个一级模块建立一份模块级设计文档，回答"模块拥有什么对象、边界在哪、状态如何流转、界面语义是什么"。
控件级细节写在 [`../screens/`](../screens/README.md)，本目录不重复。

| 模块 | 文档 | 界面规格 |
| --- | --- | --- |
| 工作台 | [`workbench.md`](./workbench.md) | UI-WB-01 |
| 试卷库 | [`exam-library.md`](./exam-library.md) | UI-EL-01、UI-EL-02 |
| 作答记录 | [`submission-records.md`](./submission-records.md) | UI-SR-01…03 |
| 题型库 | [`interface-library.md`](./interface-library.md) | UI-IF-01…06 |
| 试卷模板 | [`template-library.md`](./template-library.md) | UI-TP-01…05 |
| 评分单元 | [`grading-units.md`](./grading-units.md) | UI-GS-01…04 |
| 设置 | [`settings.md`](./settings.md) | UI-ST-01…06 |

## 模块文档模板

```markdown
<!--
status: implemented
product-version: 0.4.1
audience: both
owner: <module>
-->

# <模块名>

## 对象定位
本模块拥有或操作哪些产品对象，以及这些对象在整体对象链中的位置。

## 能力边界
提供什么；不提供什么；与其他模块的依赖关系。不写代码路径与内部实现。

## 状态与生命周期
对象在本模块中的状态、进入方式、离开方式与不可逆操作。

## 关键交互语义
影响用户判断的稳定约定（布局层级、默认视图、批量语义、冲突处理）。
控件清单、准确文案与状态细节写入对应的 UI 规格。

## 术语
本模块使用的用户可见词，须与 ../glossary.md 一致。

## 界面
链接到本模块的 UI 规格。

## 验证
本模块行为由哪些测试锚定；未锚定的部分明确列出。
```

## 写作约束

- 只写 v0.4.1 已实现的行为；未实现的确认设计写入 [`../open-questions.md`](../open-questions.md)，不写入本文。
- 不写代码路径、类名、IPC、存储格式、愿景段落。
- 与代码冲突时以代码为准。
- 不重复 UI 规格中的控件与文案。
