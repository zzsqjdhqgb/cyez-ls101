<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 自动化测试

## 测试分层

项目使用四层自动化测试：

- Vitest：包级单元测试和模块集成测试，覆盖领域逻辑、存储实现、renderer 组件和 IPC handler。
- Playwright 浏览器组件测试：启动独立的 Vite renderer 测试页，直接操作真实浏览器中的 renderer 组件，覆盖语义、键盘、焦点、响应式布局和组件状态。
- Playwright Electron 集成测试：启动构建产物并覆盖 main、sandbox preload、renderer 和持久化存储之间的调用链。
- Playwright 产品文档测试：只覆盖已经确认的用户可见产品行为，并从成功运行的测试步骤和截图生成产品文档。

Vitest 根配置在 `vitest.config.ts`，具体环境由各 workspace 的 `vitest.config.ts` 定义。React 测试使用 jsdom 和 `vitest.setup.ts` 中的 `@testing-library/jest-dom` matcher；Node 模块测试使用 node 环境。

## 运行命令

```bash
yarn test                    # 依次运行 Vitest、技术回归 Playwright 和产品文档测试
yarn test:vitest             # Vitest 单元测试和包级集成测试
yarn test:playwright         # 目录打包当前平台应用，再运行 Electron 和 renderer 组件测试
yarn test:playwright:run     # 复用已有目录打包产物，运行两套 Playwright 测试
yarn test:playwright:electron # 仅运行 Electron 集成测试
yarn test:playwright:components # 仅运行 renderer 组件测试
yarn test:watch              # Vitest 监视模式
yarn test:coverage           # Vitest 覆盖率
```

Linux 无桌面环境需要虚拟显示服务：

```bash
xvfb-run -a yarn test
xvfb-run -a yarn test:playwright
```

产品行为文档测试保持独立配置和运行产物，也可以单独运行：

```bash
yarn test:product-docs
xvfb-run -a yarn test:product-docs
```

只有 `tests/product-docs/` 全部通过时，才会更新各产品模块或流程下的 `behaviors/`、按逻辑顺序组织的 [`docs/product/guide/`](product/guide/README.md) 和 `docs/product/coverage.md`。筛选运行只生成临时预览。
完整的 `yarn test` 会在技术回归测试通过后复用已打包的 Electron 应用运行产品文档测试，不会重复构建应用。

## Renderer 组件测试

配置文件为 `playwright.components.config.ts`，测试位于 `tests/components/`。Playwright 会启动 `tests/components/vite.config.ts` 指向的独立 Vite 页面；测试页直接导入 `packages/renderer/src` 中的组件，不加载 Electron、preload 或真实持久化服务。

组件测试数量、标题和源码入口由[Playwright 技术测试清单](./engineering/testing/inventory.md)自动生成。

## Electron 集成测试

配置文件为 `playwright.config.ts`，测试位于 `tests/integration/`。`yarn test:playwright` 先调用 `build.js --dir --current-platform`，再直接启动 `dist/win-unpacked/CYEZ-LS101.exe` 或 `dist/linux-unpacked/cyez-ls101`。测试断言 `app.isPackaged`，不会使用开发 Electron 或 `out/` 入口。公共生命周期、数据隔离和维护规则参见[工程测试](./engineering/testing/README.md)。

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
