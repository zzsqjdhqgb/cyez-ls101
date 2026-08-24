# 工程测试

本目录记录自动化测试的分层和运行约束。产品行为及其截图证据位于[产品文档](../../product/README.md)，不在这里重复说明。

## 测试分层

- Vitest 覆盖领域逻辑、存储实现、renderer 状态和 IPC handler；
- Playwright Renderer 组件测试覆盖语义、键盘、焦点、响应式布局和组件状态；
- Playwright Electron 集成测试覆盖打包应用中的 main、sandbox preload、renderer、IPC 和持久化调用链；
- Playwright 产品文档测试只覆盖已经确认的完整用户行为，并生成面向产品阅读的行为文档。

## Electron 公共生命周期

每条 Electron 路径使用独立临时用户目录，启动打包后的应用，等待工作台可见，并记录 renderer `pageerror`。测试结束后关闭应用、删除临时数据并确认没有未处理页面错误。

测试不得读写真实用户数据，也不请求真实 AI Provider。系统文件对话框需要指向测试临时目录；剪贴板测试必须在结束时恢复原内容。

## 失败产物

失败截图、错误上下文和 trace 位于 `test-results/`，HTML 报告位于 `playwright-report/`。这些单次运行产物不提交到 Git。

```bash
yarn playwright show-trace test-results/<test-name>/trace.zip
```

## 维护规则

- 技术测试使用稳定编号时不得复用旧编号；
- UI 路径优先使用 role、label 和可见名称，不依赖 CSS module 类名；
- 新增外部副作用时必须提供恢复或清理流程；
- 修改 preload bridge 时同步更新 bridge 完整性断言；
- 用户已经确认的完整主流程应进入产品文档测试，技术测试只补充异常边界和跨层契约。
