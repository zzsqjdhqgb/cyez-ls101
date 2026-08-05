<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 自动化测试

## 测试分层

项目使用两层自动化测试：

- Vitest：包级单元测试和模块集成测试，覆盖领域逻辑、存储实现、renderer 组件和 IPC handler。
- Playwright：完整 Electron 集成测试，启动构建产物并覆盖 main、sandbox preload、renderer 和持久化存储之间的调用链。

Vitest 根配置在 `vitest.config.ts`，具体环境由各 workspace 的 `vitest.config.ts` 定义。React 测试使用 jsdom 和 `vitest.setup.ts` 中的 `@testing-library/jest-dom` matcher；Node 模块测试使用 node 环境。

## 运行命令

```bash
yarn test                    # 依次运行 Vitest 和 Playwright 全部测试
yarn test:vitest             # Vitest 单元测试和包级集成测试
yarn test:playwright         # 构建并运行 Playwright Electron 集成测试
yarn test:playwright:headed  # 以可见窗口运行 Playwright Electron 集成测试
yarn test:watch              # Vitest 监视模式
yarn test:coverage           # Vitest 覆盖率
```

Linux 无桌面环境需要虚拟显示服务：

```bash
xvfb-run -a yarn test
xvfb-run -a yarn test:playwright
```

## Electron 集成测试

配置文件为 `playwright.config.ts`，测试位于 `tests/integration/`。测试固定使用单 worker，避免多个 Electron 实例争用系统剪贴板和显示服务。

套件开始前会构建一次应用。每个测试都会：

- 启动真实 Electron 应用。
- 创建独立的临时用户数据目录。
- 收集未处理的 renderer 错误。
- 关闭应用并清理临时数据。

当前场景覆盖：

- BrowserWindow 安全配置与全部 preload bridge。
- File Store、Config Store、Asset Protocol、AI Router、Clipboard 和窗口控制 IPC。
- 工作台、题型、模板和设置主导航。
- 外观设置保存及页面重载恢复。
- 模板创建、编辑、保存及页面重载恢复。
- 自定义标题栏关闭操作。

文件选择器和 AI 网络请求只验证 bridge/handler 可达性。自动化测试不会打开系统对话框，也不会访问真实 AI Provider。

### Linux 密钥存储

集成测试设置 `LS101_INTEGRATION_TEST=1`，让 Electron 在 Linux 临时用户数据目录中使用 `basic_text` 密钥存储后端，从而不依赖 CI 容器中的桌面密钥环。正常应用启动不会启用此模式，测试结束后临时目录会被删除。

## 测试产物

失败时 Playwright 会把截图、trace 和错误上下文写入 `test-results/`，HTML 报告写入 `playwright-report/`。这些目录已加入 `.gitignore`。

查看 trace：

```bash
yarn playwright show-trace test-results/<test-name>/trace.zip
```

## 添加测试

- 纯函数和单个模块行为放在所属 package 的 `src/__tests__/`。
- 多模块但不需要真实 Electron 的流程使用 Vitest 集成测试。
- 依赖 BrowserWindow、preload、真实 IPC 或跨页面持久化的流程放在 `tests/integration/`。
- Electron 集成测试不得访问真实用户目录、真实 AI 服务或留下剪贴板内容。
