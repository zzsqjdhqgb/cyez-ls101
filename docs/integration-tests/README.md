<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 集成测试维护

本目录记录 Playwright/Electron 集成测试的路径、操作流程、跨进程断言和覆盖边界。测试代码是行为的最终事实来源；新增或修改集成测试时，必须在同一个变更中更新这里对应的文档。

## 测试目录

| 测试源文件                                                                               | 路径数 | 详细文档                                   | 主要范围                                                     |
| ---------------------------------------------------------------------------------------- | -----: | ------------------------------------------ | ------------------------------------------------------------ |
| [`tests/integration/electron-app.spec.ts`](../../tests/integration/electron-app.spec.ts) |      6 | [Electron 应用测试路径](./electron-app.md) | 应用启动、preload、IPC、导航、配置与业务数据持久化、窗口控制 |
| [`tests/integration/airouter.spec.ts`](../../tests/integration/airouter.spec.ts)         |     23 | [AIRouter 集成测试路径](./airouter.md)     | Provider、密钥、模型、文本流、图像生成、错误与取消           |

Playwright 的全局配置位于 [`playwright.config.ts`](../../playwright.config.ts)。当前固定使用单 worker，避免多个 Electron 实例争用系统剪贴板和显示服务。

## 运行方式

```bash
yarn test             # 先运行 Vitest，再运行 Playwright/Electron 集成测试
yarn test:playwright  # 只构建并运行 Playwright/Electron 集成测试
```

Windows 直接运行上述命令，Electron 窗口会正常显示。Linux 无桌面环境需要虚拟显示：

```bash
xvfb-run -a yarn test:playwright
```

## 调用链

```text
Playwright 测试进程
  -> Electron main process
  -> BrowserWindow / React renderer
  -> sandbox preload bridge
  -> ipcMain handler / protocol handler
  -> 配置、文件、密钥或系统能力
```

集成测试应尽量从用户可操作的 renderer 界面进入。只有在验证 BrowserWindow 配置、Electron 系统状态或自定义协议时，才直接通过 `electronApp.evaluate` 进入主进程。

## 公共生命周期

两个 spec 中的每条路径都使用相同的前后置流程；AIRouter spec 还会在套件级启动和关闭本地 mock HTTP 服务，并在每条路径前清空请求记录。

测试前：

1. 在系统临时目录中创建当前 spec 专用的用户数据目录。
2. 使用构建后的项目入口启动真实 Electron。
3. 传入 `--user-data-dir`、`--no-sandbox` 和测试专用环境变量。
4. 等待首个 BrowserWindow 完成 DOM 加载。
5. 确认工作台一级标题可见，应用才被视为启动成功。

测试后：

1. 关闭 Electron 应用；关闭路径本身被测试时允许应用已经退出。
2. 删除本条路径的临时用户数据目录。
3. 断言 renderer 没有未处理的 `pageerror`。

IPC 往返路径会临时写入系统剪贴板，但使用 `finally` 一次性恢复原文本和图片，并断言恢复结果。其他数据只写入测试专用用户目录。

## 数据隔离

Playwright 测试与 `yarn dev` 不共享数据目录。每条测试路径都有独立临时目录，路径结束后自动删除，因此测试之间也不共享配置、模板或文件。

Linux 测试进程设置 `LS101_INTEGRATION_TEST=1`，允许未打包 Electron 在临时目录中使用 `basic_text` 密钥存储后端，从而避免依赖 CI 桌面密钥环。打包应用不会启用此分支。

## 覆盖边界

当前集成测试有意不执行以下外部操作：

- 不请求真实 AI Provider，也不保存真实 API Key。
- 不显示需要人工操作的系统文件选择或保存对话框；需要覆盖文件读取时会在 Electron main 中把对话框结果指向测试专用文件。
- 不依赖开发者已有的配置、模板或用户文件。
- 不测试操作系统窗口管理器对最小化和最大化的视觉表现。

这些边界内的 preload API 会验证是否完整暴露，适合自动化的 handler 会执行真实 IPC 往返。

## 失败产物

失败时 Playwright 将截图、错误上下文和 trace 写入 `test-results/`，HTML 报告写入 `playwright-report/`。两个目录均不会提交到 Git。

```bash
yarn playwright show-trace test-results/<test-name>/trace.zip
```

## 维护规则

- 为每条测试路径分配稳定编号，例如 `EA-07`；测试名称可以优化，但编号不要复用。
- 文档必须列出入口、操作步骤、关键断言和明确未覆盖项。
- UI 路径优先使用 role、label 和可见名称定位，不依赖 CSS module 类名。
- 连续保存同一配置时，先等待前一次持久化完成，避免平台相关竞态。
- 修改 preload bridge 时同步更新 bridge 完整性断言和对应文档。
- 新增外部副作用时必须提供恢复或清理流程。

Vitest 与完整测试命令的总览参见 [`docs/testing.md`](../testing.md)。
