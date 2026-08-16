# 产品文档测试

本目录只存放已经确认的用户可见产品行为。测试目录镜像 `docs/product/modules/` 和 `docs/product/flows/`，通过真实 Electron 界面执行，并在整套测试成功后把行为页和截图生成到所属模块或流程的 `behaviors/` 中；每条行为同时声明自己在 `docs/product/guide/` 的逻辑旅程章节中的位置。

技术实现、IPC、异常边界、组件状态和兼容性回归测试不放在本目录，继续由 `tests/integration/`、`tests/components/` 和各 package 的 Vitest 测试负责。

运行方式：

```bash
yarn test:product-docs
```

Linux 无桌面环境：

```bash
xvfb-run -a yarn test:product-docs
```

每个产品文档测试必须：

- 使用 `productTest` 声明稳定编号、归属、能力、行为意图、前置条件和行为保证；
- 使用 `productStep` 表达带稳定 key 的用户实际操作路径；
- 只使用用户可见的 role、label 和文本定位界面；
- 使用 `evidence` 为关键决策、异常或结果状态附加具名截图；
- 能独立运行，不依赖其他测试留下的数据。

产品指南章节由 `tests/product-docs/support/product-guide.ts` 定义。章节提供阶段目标、输入、产物、下一步和明确的未覆盖清单；Reporter 从成功行为的步骤和保证自动展开“已验证操作”。因此指南是产品说明的入口，行为页是证据和规格的细节层。

完整生成使用 `yarn test:product-docs` 或 `yarn test:product-docs:run`。筛选调试使用 `yarn test:product-docs:preview --grep <pattern>`，只会更新 `test-results/product-docs-preview/`。

生成的 Markdown、manifest 和图片不手工编辑。
