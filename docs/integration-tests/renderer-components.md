<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# Renderer 组件测试路径

测试源文件为 [`tests/components/renderer-components.spec.tsx`](../../tests/components/renderer-components.spec.tsx)，使用 [`playwright.components.config.ts`](../../playwright.components.config.ts) 启动独立 Vite 页面。每条路径通过 `?component=` 选择一个 story，并在真实 Chromium 中操作 renderer 源码；它不经过 Electron main、preload、IPC 或持久化服务。

## 路径清单

| 编号  | 入口和操作                     | 关键断言                                            |
| ----- | ------------------------------ | --------------------------------------------------- |
| FE-01 | 挂载按钮 story，聚焦并按 Enter | 默认 `type=button`、图标隐藏、键盘触发保存状态      |
| FE-02 | 聚焦图标按钮                   | accessible name 正确，tooltip 可见                  |
| FE-03 | 打开确认框，分别确认和取消     | `dialog`/`aria-modal` 语义正确，两条关闭路径都可用  |
| FE-04 | 聚焦分栏分隔条，用方向键调整   | separator 方向和像素值暴露，宽度受最小/最大边界约束 |
| FE-05 | 选择不同 Provider 模型并刷新   | `optgroup` 分组、选中值和刷新动作反馈正确           |
| FE-06 | 折叠侧边栏，进入专注和沉浸布局 | 折叠后导航仍可访问，布局切换按预期隐藏壳层区域      |
| FE-07 | 将 viewport 设为 `720x720`     | 设置下拉框和 switch 可见且不越过 viewport           |
| FE-08 | 查看页面标题、操作按钮和空状态 | 标题层级和空状态阅读顺序可用                        |

## 未覆盖项

- 组件测试不会替代 Electron 集成测试；窗口控制、preload bridge、IPC、文件、剪贴板和 AI 链路仍由 `tests/integration/` 覆盖。
- 目前没有像素级 snapshot 基线，视觉回归先通过 viewport 边界、可见性和布局几何断言发现。
- 对话框焦点陷阱、Escape 关闭、tooltip 的屏幕阅读器关联、toast 溢出通知查看和组件动态 ID 的问题记录在临时设计审查文档中，待产品交互确认后补行为测试。
