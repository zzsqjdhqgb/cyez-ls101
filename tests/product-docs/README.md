# 产品文档测试

本目录只存放已经确认的用户可见产品行为。这里的 Playwright 测试通过真实 Electron 界面执行，并在整套测试成功后自动生成 `docs/product/generated/` 下的产品行为文档。

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

- 使用稳定的产品行为编号；
- 通过注解声明功能区域、行为摘要和前置条件；
- 使用 `test.step` 表达用户实际操作路径；
- 只使用用户可见的 role、label 和文本定位界面；
- 为关键状态附加截图；
- 能独立运行，不依赖其他测试留下的数据。

生成目录中的 Markdown 和图片不手工编辑。
