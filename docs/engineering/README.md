<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 工程文档

本目录面向工程师，回答"代码如何实现、契约是什么、边界在哪"。
**代码是唯一事实来源**；本目录只记录 v0.4.1 已经存在的行为。

| 路径                                                                           | 内容                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [`features/`](./features/README.md)                                            | 已实现能力的契约：公共接口、进程/存储边界、数据语义、验证覆盖、已知限制 |
| [`features/logger.md`](./features/logger.md)                                   | 应用日志：main JSONL 文件与轮转、renderer 转发与限流                    |
| [`features/secret-store.md`](./features/secret-store.md)                       | `safeStorage` 加密的作用域密钥存储及其 Linux 集成测试回退               |
| [`features/license.md`](./features/license.md)                                 | 激活与许可：回执、到期、反激活、本地集成测试覆盖                        |
| [`features/installation-marker.md`](./features/installation-marker.md)         | 安装标记：首次运行、版本升级、发布说明认领                              |
| [`subsystems/`](./subsystems/README.md)                                        | 跨能力子系统：架构、运行时/生命周期、失败与恢复                         |
| [`subsystems/startup-orchestration.md`](./subsystems/startup-orchestration.md) | 启动编排：main/renderer 启动顺序、就绪门禁、失败与恢复                  |
| [`subsystems/builtin-content.md`](./subsystems/builtin-content.md)             | 内置内容：资源分发、启动对账/播种、升级与只读保护                       |
| [`subsystems/legacy-data.md`](./subsystems/legacy-data.md)                     | 旧数据：版本标记检测、归档 ZIP 与 manifest、隔离删除、worker 卸载       |
| [`../testing.md`](../testing.md)                                               | 测试分层、命令、诊断产物                                                |
| [`setup-assets.md`](./setup-assets.md)                                         | 安装期资产校验与恢复                                                    |
| [`qwen-tts.md`](./qwen-tts.md)                                                 | Qwen TTS runtime 与模型包                                               |
| [`airouter-model-catalog.md`](./airouter-model-catalog.md)                     | AI Router 模型目录快照                                                  |
| [`tooling/prettier-version.md`](./tooling/prettier-version.md)                 | Prettier 版本锁定策略                                                   |
| [`testing/README.md`](./testing/README.md)                                     | Electron 测试维护约定                                                   |
| [`todo/`](./todo/README.md)                                                    | 未完成工作项                                                            |

## 领域包与分层规范（现状）

本节按仓库当前代码描述分层与依赖边界，不采用旧稿的目标结构（旧稿见 [`../archive/refactor/architecture-overview.md`](../archive/refactor/architecture-overview.md) §领域包与 UI 分层规范）。

| 层              | 位置                                                                                                                                                                                     | 职责                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Electron 主进程 | `src/main/`                                                                                                                                                                              | 桥接原生能力：文件系统、系统对话框、本地模型推理、配置存储、许可；`src/main/application-services.ts` 注册各 `@ls101/*/main` handler |
| preload 桥      | `src/preload/`                                                                                                                                                                           | 用白名单把主进程能力暴露成 `window.*`                                                                                               |
| 渲染 UI         | `packages/renderer`                                                                                                                                                                      | React 页面、组件、路由与页面状态；在 `features/*/*Runtime.ts` 用真实适配器创建领域应用，再由 `*ApplicationProvider.tsx` 注入组件树  |
| 领域包          | `packages/{file-store,file-dialog,config-store,secret-store,logger,airouter,schema-editor,interface-editor,template-editor,exam-package,exam-library,submission-library,grading-engine}` | 与 UI 框架无关的模型、校验、用例与仓储；多数只声明 `@ls101/core-types`                                                              |
| 共享渲染包      | `packages/page-renderer`、`packages/exam-player`                                                                                                                                         | 编辑器与考试共用的页面渲染原语、考试播放器组件（React）                                                                             |
| 公共契约        | `packages/core-types`                                                                                                                                                                    | 跨模块类型；不依赖其他包                                                                                                            |
| 空壳包          | `packages/editor-kit`、`packages/section-engine`                                                                                                                                         | `src/index.ts` 只有 `export {}`                                                                                                     |

实际依赖方向（`packages/*/package.json` 声明与实际 import）：

```text
packages/renderer          -> 领域包 / 共享渲染包 / core-types
领域包                     -> core-types（个别领域包互相依赖）
exam-player                -> core-types、exam-package
page-renderer              -> 无 workspace 依赖
领域包                     -> 不 import packages/renderer
```

约定：

- 与 React、Electron 和具体存储无关的模型、校验、转换和完整用例放在领域包；只描述页面如何展示、选择和反馈的规则留在 `packages/renderer`。
- 领域状态由领域包定义并维护；选中节点、展开状态、活动标签页、loading/toast 等页面临时状态只存在于 renderer，不写进持久化领域对象。
- 领域包只依赖自己声明的窄端口（仓储、AI、系统文件对话框等）；具体适配器在 renderer 的 `*Runtime.ts` 组合层创建。领域包不接收任意文件系统路径。
- 领域包的根入口只暴露稳定数据契约、用例和工厂；仓储布局、编解码和迁移步骤从子入口提供（例如 `@ls101/interface-editor/adapters`、`@ls101/template-editor/adapters`）。

已知不一致（跟踪在 [`../ui/open-questions.md`](../ui/open-questions.md) 第 5-7 条）：

- `packages/renderer/src/features/submissions/SubmissionGradingPage.tsx`、`SubmissionAIRouterAdapter.ts` import `@ls101/grading-engine`，但 `packages/renderer/package.json` 未声明该依赖；只有 `packages/renderer/tsconfig.json` 的项目引用包含 `../grading-engine`。
- `packages/editor-kit` 与 `packages/section-engine` 的 `src/index.ts` 只有 `export {}`，却被 `packages/renderer` 声明为依赖；`packages/template-editor` 也声明了 `@ls101/section-engine` 但没有 import。
- `packages/grading-engine/package.json` 依赖 `@ls101/submission-library`，而 `submission-library` 是评分对象的存储侧，依赖方向与领域分层相反。

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
