<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: testing
-->

<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 自动化测试

## 测试分层

项目使用五层自动化测试：

1. Node 脚本测试：`yarn test:scripts` 运行 `node --test scripts/__tests__/*.test.js`，覆盖构建和辅助脚本。
2. Vitest：根配置 `vitest.config.ts` 汇总三个 project 组，分别是 `packages/*/vitest.config.ts`（包级单元测试和模块集成测试）、`tests/main/vitest.config.ts`（main 进程测试）和 `tests/product-docs/vitest.config.ts`（产品文档测试支撑代码）。React 测试使用 jsdom 和 `vitest.setup.ts` 中的 `@testing-library/jest-dom` matcher；Node 模块测试使用 node 环境。
3. Playwright renderer 组件测试：配置为 `playwright.components.config.ts`，测试位于 `tests/components/`。
4. Playwright 打包 Electron 集成测试：配置为 `playwright.config.ts`，测试位于 `tests/integration/`。
5. Playwright 产品文档测试：配置为 `playwright.product-docs.config.ts`，测试位于 `tests/product-docs/`。

## 运行命令

```bash
yarn test                       # 依次运行 scripts、Vitest、Playwright 和产品文档 preview
yarn test:scripts               # node --test scripts/__tests__/*.test.js
yarn test:vitest                # Vitest 单元测试和包级集成测试
yarn test:playwright            # 先 yarn build:test 打包，再运行 Electron 和 renderer 组件测试
yarn test:playwright:run        # 复用已有打包产物，运行两套 Playwright 测试
yarn test:playwright:electron   # 仅运行 Electron 集成测试
yarn test:playwright:components # 仅运行 renderer 组件测试
yarn test:product-docs          # 先 yarn build:test 打包，再运行产品文档 preview
yarn test:product-docs:run      # node scripts/run-product-docs.mjs preview，复用已有打包产物
yarn test:product-docs:preview  # playwright test --config=playwright.product-docs.config.ts
yarn test:watch                 # Vitest 监视模式
yarn test:coverage              # Vitest 覆盖率
```

`yarn test` 对应 `yarn test:scripts && yarn test:vitest && yarn test:playwright && yarn test:product-docs:run`。

`yarn test:playwright` 先执行 `yarn build:test`，即 `node build.js --local --dir --current-platform --skip-model-package`，而不是只传 `--dir --current-platform`。

`yarn test:product-docs` 先执行 `yarn build:test`，再执行 `yarn test:product-docs:run`，后者为 `node scripts/run-product-docs.mjs preview`。该命令只运行 preview，产物写入 `test-results/product-docs-preview/`，不会修改 `docs/manual`。正式生成产品说明书只能通过专用 Docker 流程：`yarn docs:product:publish`；`yarn docs:product:check` 重新生成并检查仓库中的生成结果是否最新。产品说明书也可以不依赖容器直接生成：`yarn docs:manual:local`（需先 `yarn build:test`）。

Linux 无桌面环境需要在 Electron / Playwright 命令前加 `xvfb-run -a`：

```bash
xvfb-run -a yarn test:playwright
xvfb-run -a yarn test:product-docs
```

## Renderer 组件测试

配置文件为 `playwright.components.config.ts`，测试位于 `tests/components/`。Playwright 会启动 `tests/components/vite.config.ts` 指向的独立 Vite 页面；测试页直接导入 `packages/renderer/src` 中的组件，不加载 Electron、preload 或真实持久化服务。

## Electron 集成测试

配置文件为 `playwright.config.ts`，测试位于 `tests/integration/`。`yarn test:playwright` 先调用 `yarn build:test`（`node build.js --local --dir --current-platform --skip-model-package`），再直接启动 `dist/win-unpacked/CYEZ-LS101.exe` 或 `dist/linux-unpacked/cyez-ls101`。测试断言 `app.isPackaged`，不会使用开发 Electron 或 `out/` 入口。公共生命周期、数据隔离和维护规则参见[工程测试](./engineering/testing/README.md)。

## 测试产物

失败时 Playwright 会把截图、trace 和错误上下文写入 `test-results/`，HTML 报告写入 `playwright-report/`。这些目录已加入 `.gitignore`；产品文档 preview 产物位于 `test-results/product-docs-preview/`。

查看 trace：

```bash
yarn playwright show-trace test-results/<test-name>/trace.zip
```

## 添加测试

- 纯函数和单个模块行为放在所属 package 的 `src/__tests__/`。
- main 进程的单元和集成测试放在 `tests/main/`，由 `tests/main/vitest.config.ts` 收集。
- 多模块但不需要真实 Electron 的流程使用 Vitest 集成测试。
- 依赖 BrowserWindow、preload、真实 IPC 或跨页面持久化的流程放在 `tests/integration/`。
- Electron 集成测试不得访问真实用户目录、真实 AI 服务或留下剪贴板内容。
