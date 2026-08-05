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
yarn test:watch              # Vitest 监视模式
yarn test:coverage           # Vitest 覆盖率
```

Linux 无桌面环境需要虚拟显示服务：

```bash
xvfb-run -a yarn test
xvfb-run -a yarn test:playwright
```

## Electron 集成测试

配置文件为 `playwright.config.ts`，测试位于 `tests/integration/`。每条测试路径的操作流程、断言、数据隔离和覆盖边界统一维护在 [`docs/integration-tests/`](./integration-tests/README.md)。

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
