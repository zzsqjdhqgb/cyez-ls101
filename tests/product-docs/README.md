<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: testing
-->

# 产品操作测试

本目录存放按用户任务组织的产品操作测试，通过真实 Electron 界面执行：整套按稳定 key 操作界面，Reporter 汇总每一步的实际结果。

技术实现、IPC、异常边界、组件状态和兼容性回归测试不放在本目录，继续由 `tests/integration/`、`tests/components/` 和各 package 的 Vitest 测试负责。

运行方式：

```bash
yarn test:product-docs
```

该命令只运行预览模式：生成的 Markdown、manifest、截图、trace 和失败证据都保存在
`test-results/product-docs-preview`，不会写入 `docs/manual` 或档案层。

Linux 无桌面环境：

```bash
xvfb-run -a yarn test:product-docs
```

## 与产品说明书的关系（2026-09 起）

**产品说明书已改为手写**，正文在 [`docs/manual/`](../../docs/manual/README.md)，配图由 [`tests/manual/`](../manual/README.md) 独立生成。
因此：

- 本套件**不再生成说明书**，也不再有任何写入 `docs/manual` 的路径；
- 原先的 `yarn docs:manual:local`、`yarn docs:product:publish`、`yarn docs:product:check` 与 CI 的 `canonical_docs` job 均已移除；
- 本套件现在的定位是**产品行为的回归网**：写说明书某一章前，先跑对应模块的用例，确认界面上真实存在的按钮与文案；
- 章节大纲 `support/product-guide.ts` 仍保留，作为用例分组与预览页的结构，不再驱动说明书叙事。

> 遗留：`support/product-docs-reporter.ts` 里仍保留 canonical 分支与 `docs/manual` 的写入代码，但已无入口调用（可执行的入口 `scripts/product-docs/container-runner.mjs` 已停用）。清理属于后续工作。

## 用例约定

- 完整用户旅程使用 `productJourney`，不通过仓储预置旅程中的核心业务对象；
- 模块和流程中的独立用户操作使用 `productTest`，允许构造已声明的前置条件；
- 两类说明都要声明稳定编号、用途、前置条件、完成结果和完整步骤；
- 每个步骤同时声明用户动作和可见结果，测试正文只按 key 执行；
- Reporter 要求全部声明步骤按声明顺序执行，缺少、重复或乱序都会报错；
- 只使用用户可见的 role、label 和文本定位界面；
- 使用 `evidence` 为关键决策、异常或结果状态附加具名截图；
- 使用固定的 1x 设备倍率、`1280×800` 内容区和随机种子，保证跨平台截图具有稳定基线；
- 能独立运行，不依赖其他测试留下的数据。

完整预览使用 `yarn test:product-docs` 或 `yarn test:product-docs:run`。筛选调试使用 `yarn test:product-docs:preview --grep <pattern>`，只会更新 `test-results/product-docs-preview/`。
