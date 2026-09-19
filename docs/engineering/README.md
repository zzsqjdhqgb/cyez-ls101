<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 工程文档

本目录面向工程师，回答"代码如何实现、契约是什么、边界在哪"。
**代码是唯一事实来源**；本目录只记录 v0.4.1 已经存在的行为。

| 路径 | 内容 |
| --- | --- |
| [`features/`](./features/README.md) | 已实现能力的契约：公共接口、进程/存储边界、数据语义、验证覆盖、已知限制 |
| [`subsystems/`](./subsystems/README.md) | 跨能力子系统：架构、运行时/生命周期、失败与恢复 |
| [`../testing.md`](../testing.md) | 测试分层、命令、诊断产物 |
| [`setup-assets.md`](./setup-assets.md) | 安装期资产校验与恢复 |
| [`qwen-tts.md`](./qwen-tts.md) | Qwen TTS runtime 与模型包 |
| [`airouter-model-catalog.md`](./airouter-model-catalog.md) | AI Router 模型目录快照 |
| [`tooling/prettier-version.md`](./tooling/prettier-version.md) | Prettier 版本锁定策略 |
| [`testing/README.md`](./testing/README.md) | Electron 测试维护约定 |
| [`todo/`](./todo/README.md) | 未完成工作项 |

## 工程特性文档模板

```markdown
<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: <包或模块名>
-->

# <能力名>

## 功能状态

已实现并接入的部分；未接入的部分单独标注。

## 功能边界

支持什么、在哪一层实现、不支持什么。

## 公共接口

类型、函数、IPC 通道；用代码路径指向定义处。

## 进程与存储边界

进程归属、存储位置与格式。

## 数据语义

字段含义、不变量、错误码。

## 验证覆盖

对应的自动化测试位置与覆盖范围。

## 已知限制

当前不覆盖或有意不支持的场景。

## 代码依据

实现与测试的源文件列表。
```

禁写：未实现的规划、别的文档已写过的正文（改为链接）、没有范围的"支持/安全/已接入"。

## 与其它层的关系

- 产品界面语义以 [`../ui/`](../ui/README.md) 为准；本目录只描述实现。
- 历史设计草案在 [`../archive/`](../archive/README.md)，不作为依据。
- 规划中的子系统见 [`subsystems/README.md`](./subsystems/README.md)。
