# 产品文档测试

本目录只存放已经确认的标准用户旅程和用户可见产品行为，通过真实 Electron 界面执行。`journeys/` 中的测试从用户可理解的起点连续产出并消费核心业务对象；`modules/` 和 `flows/` 中的测试验证局部交互规则与异常边界。整套测试成功后，Reporter 生成对应文档、用户指南和截图证据。

技术实现、IPC、异常边界、组件状态和兼容性回归测试不放在本目录，继续由 `tests/integration/`、`tests/components/` 和各 package 的 Vitest 测试负责。

运行方式：

```bash
yarn test:product-docs
```

Linux 无桌面环境：

```bash
xvfb-run -a yarn test:product-docs
```

产品文档测试共同遵守以下要求：

- 完整用户旅程使用 `productJourney`，不通过仓储预置旅程中的核心业务对象；
- 模块和流程中的局部产品行为使用 `productTest`，允许构造已声明的前置条件；
- 两类测试都要声明稳定编号、归属、能力、行为意图、前置条件和行为保证；
- 使用 `productStep` 表达带稳定 key 的用户实际操作路径；
- 只使用用户可见的 role、label 和文本定位界面；
- 使用 `evidence` 为关键决策、异常或结果状态附加具名截图；
- 能独立运行，不依赖其他测试留下的数据。

产品指南章节由 `tests/product-docs/support/product-guide.ts` 定义。章节提供阶段目标、输入、产物、下一步和明确的未覆盖清单；Reporter 分别展开成功运行的“已验证用户旅程”和“已验证产品行为”。因此指南是产品说明的入口，旅程页和行为页是证据与规格的细节层。

完整生成使用 `yarn test:product-docs` 或 `yarn test:product-docs:run`。筛选调试使用 `yarn test:product-docs:preview --grep <pattern>`，只会更新 `test-results/product-docs-preview/`。

生成的 Markdown、manifest 和图片不手工编辑。
