# 已实现功能文档

本目录是项目的正式功能文档，只记录已经确定并已实现到代码中的能力。文档必须能够独立说明当前系统行为，不能要求读者结合旧文档猜测真实语义。

## 文档规则

- 以当前代码、测试和实际接线为事实来源，不把现有 `design/` 或 `docs/` 内容视为正确前提。
- 旧文档只用于发现待核查的问题，不直接复制其结论；文档与代码冲突时以代码为准，并在新文档中写明实际状态。
- 不记录提案、备选方案或尚未实现的规划。
- 功能行为发生变化时，相关文档必须随代码一起更新。
- 每份文档必须明确说明前置条件、功能边界、公共接口、数据语义、返回值、取消与错误、进程或模块边界、集成状态、验证覆盖和已知限制。
- 避免“支持”“安全”“已接入”等没有范围的结论，必须说明具体支持什么、在哪一层实现、没有覆盖什么。
- 文档中的“已实现”不等同于“已被所有业务 UI 使用”，集成状态必须单独说明。

## 功能索引

| 功能                     | 实现模块                                 | 状态                                                    | 文档                                         |
| ------------------------ | ---------------------------------------- | ------------------------------------------------------- | -------------------------------------------- |
| 应用私有文件存储         | `@ls101/file-store`                      | 基础设施已实现并完成 Electron 注册                      | [file-store.md](file-store.md)               |
| 应用配置存储             | `@ls101/config-store`                    | JSON 后端已实现并完成 Electron 注册，外观模块已接入     | [config-store.md](config-store.md)           |
| 系统文件对话框           | `@ls101/file-dialog`                     | 基础设施已实现并完成 Electron 注册                      | [file-dialog.md](file-dialog.md)             |
| 系统剪贴板图片读取       | `@ls101/clipboard`                       | 图片读取已实现并完成 Electron 注册，Interface 已接入    | [clipboard.md](clipboard.md)                 |
| 通用长耗时任务进度       | `@ls101/core-types`                      | 跨模块契约已实现，Interface 已产生实际句柄              | [task-progress.md](task-progress.md)         |
| AI 文本、图像与语音路由  | `@ls101/airouter`、renderer              | 文本流、图像 Provider、TTS Provider 与模型包设置已接入  | [ai-router.md](ai-router.md)                 |
| Interface 领域与应用 API | `@ls101/interface-editor`                | 领域、仓储和应用门面已实现，renderer 与真实 AI 尚未接线 | [interface-editor.md](interface-editor.md)   |
| Template 核心领域模型    | `@ls101/template-editor`                 | 领域、仓储、应用门面、严格校验和试卷包编译已实现        | [template-editor.md](template-editor.md)     |
| 应用外壳与注册式导航     | `@ls101/renderer`、Electron main/preload | 基础外壳、窗口控制、路由注册和轻量 UI 组件已实现        | [application-shell.md](application-shell.md) |
