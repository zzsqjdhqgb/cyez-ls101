# 产品文档测试

本目录存放可以直接生成产品说明书的用户任务和操作，通过真实 Electron 界面执行。产品说明中的步骤是测试与文档共同使用的单一事实来源；测试正文只按稳定 key 执行步骤，整套成功后 Reporter 生成产品说明书和必要的界面截图。

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
- 模块和流程中的独立用户操作使用 `productTest`，允许构造已声明的前置条件；
- 两类说明都要声明稳定编号、说明书位置、用途、前置条件、完成结果和完整步骤；
- 每个步骤同时声明用户动作和可见结果，测试正文只按 key 执行；
- Reporter 要求全部声明步骤按照说明书顺序执行，缺少、重复或乱序都会阻止发布；
- 只使用用户可见的 role、label 和文本定位界面；
- 使用 `evidence` 为关键决策、异常或结果状态附加具名截图；
- 产品文档测试使用固定的 1x 设备倍率、`1280×800` 内容区和随机种子，保证跨平台截图具有稳定基线；
- 能独立运行，不依赖其他测试留下的数据。

产品说明书章节由 `tests/product-docs/support/product-guide.ts` 定义。章节提供阶段目标、输入、产物和下一步，具体任务的动作与可见结果来自同一份可执行产品说明定义。测试统计只进入独立覆盖页，不进入说明书叙事。

完整生成使用 `yarn test:product-docs` 或 `yarn test:product-docs:run`。筛选调试使用 `yarn test:product-docs:preview --grep <pattern>`，只会更新 `test-results/product-docs-preview/`。

生成的 Markdown、manifest 和图片不手工编辑。
