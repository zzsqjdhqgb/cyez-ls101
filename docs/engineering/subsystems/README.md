<!--
status: confirmed
product-version: 0.4.1
audience: engineer
owner: engineering
-->

# 子系统文档

本目录存放跨能力的子系统文档：架构、运行时/生命周期、存储与格式、失败与恢复、运维入口。

| 文档                                                                       | 覆盖内容                                                                                                      | 代码位置                                                                            | 状态               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------ |
| [`exam-package.md`](./exam-package.md)                                     | `.lsexam` / `.lssubmission` ZIP 编解码、manifest 校验、旧格式升级、`AnswerCapturePlan` / `SubmissionTemplate` | `packages/exam-package`                                                             | 已建立             |
| [`exam-library.md`](./exam-library.md)                                     | 试卷库存取、SHA-256 去重、ID 冲突、导出校验                                                                   | `packages/exam-library`                                                             | 已建立             |
| [`exam-player.md`](./exam-player.md)                                       | 播放器运行时、编译期 TTS、GET 预检与资源缓存、作答装配                                                        | `packages/exam-player`                                                              | 已建立             |
| [`submission-workflow.md`](./submission-workflow.md)                       | 作答记录、评分工作区、结算批次、报告导出                                                                      | `packages/submission-library`                                                       | 已建立             |
| [`../features/license.md`](../features/license.md)                         | 邀请码校验、`license.json` 回执、过期、反激活                                                                 | `src/main/license*.ts`                                                              | 已建立（特性文档） |
| [`../features/installation-marker.md`](../features/installation-marker.md) | `.ls101-installation.json` 结构与 release notes 认领                                                          | `src/main/installation-marker.ts`                                                   | 已建立（特性文档） |
| [`startup-orchestration.md`](./startup-orchestration.md)                   | main/renderer 启动顺序、就绪门禁、启动里程碑、失败与恢复                                                      | `src/main/bootstrap.ts`、`src/main/index.ts`、`packages/renderer/src/startup-*.tsx` | 已建立             |
| [`legacy-data.md`](./legacy-data.md)                                       | 旧版本标记检测、归档 ZIP 与 manifest、隔离与删除、worker 卸载                                                 | `src/main/legacy-data*.ts`                                                          | 已建立             |
| [`../features/logger.md`](../features/logger.md)                           | 主进程日志、renderer log gate 校验与限流                                                                      | `packages/logger`                                                                   | 已建立（特性文档） |
| [`../features/secret-store.md`](../features/secret-store.md)               | `safeStorage` 加密、scoped secrets                                                                            | `packages/secret-store`                                                             | 已建立（特性文档） |
| [`builtin-content.md`](./builtin-content.md)                               | 内置评分单元/题型/模板/函数库的加载、对账、升级与只读保护                                                     | `resources/builtin`                                                                 | 已建立             |

写作要求见 [`../README.md`](../README.md)。**代码是唯一事实来源**，不得描述未实现的能力。
