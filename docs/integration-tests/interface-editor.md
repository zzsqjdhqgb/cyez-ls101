<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 题型编辑器集成测试路径

源文件：[`tests/integration/interface-editor.spec.ts`](../../tests/integration/interface-editor.spec.ts)

本地模拟服务：[`tests/integration/support/mock-ai-server.ts`](../../tests/integration/support/mock-ai-server.ts)

运行命令：

```bash
yarn test:playwright:electron tests/integration/interface-editor.spec.ts
```

Linux 容器或无桌面环境：

```bash
xvfb-run -a yarn test:playwright:electron tests/integration/interface-editor.spec.ts
```

命令先为当前平台执行 `electron-builder --dir`，测试直接启动 unpacked 可执行文件。

本套件验证题型编辑器的真实用户操作链路和跨包边界：草稿编辑器、发布题型、题组编辑器、内置题型初始化、导入导出、文件和剪贴板图片，以及 `题型实例编辑器 -> InterfaceAIRouterAdapter / ConfiguredImageGenerator -> airouter renderer client -> sandbox preload -> ipcMain -> AIRouterService / AIRouterImageService -> AI SDK -> mock HTTP` 的 AI 文本/图像生成链路。

每条路径都用独立的临时 Electron `userData` 目录。已发布的题型通过 `fileStore` bridge 直接写入 `FileInterfaceRepository` 的存储布局（`interfaces/published/<interfaceId>/interface.json`），interface id 按仓库相同的 canonicalization + SHA-256 规则推导；题组实例由 UI「新建题组」创建，不从外部写入。

## 设置与数据预置

- `textInterface`：两个文本叶子字段（`title`/`answer`），AI 返回 `{"title":"AI 标题","answer":"AI answer"}`。
- `imageInterface`：一个文本叶子（`title`）和一个图片叶子（`picture`），AI 返回 `{"title":"AI 标题","picture":"A green circle icon"}`，图片字段的提示词再经图像 Provider 生成 PNG。
- 资源中的 `shanghai-gaokao-speaking`：验证真实 bundled Interface 首次启动后被安装并出现在题型列表。

## 路径

### IE-01 真实 AI 文本生成端到端

测试路径：`题型列表 -> 题型详情 -> 新建题组 -> AI 生成面板 -> 选模型 -> 开始生成 -> mock /v1/chat/completions -> 实例保存`。

操作流程：预置文本题型和 OpenAI-compatible Provider（`mock-json` 模型），从 UI 新建题组并执行 AI 生成。

测试内容：模型下拉列出已启用模型；任务完成并显示「生成完成」与「AI 生成内容已保存」；两个文本字段的值被填充；HTTP 请求携带目标模型、完整提示词和 `stream=true`；实例已持久化到文件存储。

### IE-02 含图片字段的 AI 生成端到端

测试路径：`新建题组 -> AI 生成面板 -> 选文本模型和图像 Provider -> 开始生成 -> mock 文本流 + mock /v1/images/generations -> 原子保存`。

操作流程：预置含图片字段的题型、文本 Provider（`mock-json-image`）和图像 Provider（`mock-image`），从 UI 同时选择文本模型与图像 Provider 后生成。

测试内容：文本字段填充、图片提示词回填、图片预览可见；文本与图片 HTTP 请求参数正确；持久化实例包含 `imagePrompts` 和一张图片资产。

### IE-03 AI 生成失败与取消

测试路径：`mock-nonjson 非 JSON 输出 -> 校验失败 -> JSON 面板 -> mock-slow 生成 -> 取消生成`。

操作流程：先用返回非 JSON 文本的模型触发校验失败，检查原题组内容未被覆盖并在 JSON 面板看到原始输出与解析错误；再启动慢速生成并在运行中取消。

测试内容：校验失败状态「生成内容未通过校验」、字段错误数量、JSON 面板的原始输出和解析错误均正确；取消后显示「生成已取消」与「已取消 AI 生成」；两种失败路径都不会写入实例数据。

### IE-04～IE-06 草稿生命周期

覆盖草稿创建、基本信息和字段保存后重新打开、空变量名发布校验、发布成功、草稿复制/删除，以及未保存修改离开时的取消和放弃操作。

### IE-07～IE-09 题组生命周期

覆盖题组名称和字段值保存后重新打开、未保存修改离开确认、JSON 合法覆盖、非法 JSON 保留原值，以及删除题组后的文件存储清理。

### IE-10～IE-11 题型复制与交换

覆盖已发布题型复制为草稿，以及包含题组实例的 `.lsinterface` 导出、清空、重新导入和题组恢复。导出文件同时断言 ZIP 文件头，避免只验证 UI toast。

### IE-12 字段树编辑

覆盖字段组、组内字段、图片字段属性、字段重命名、节点删除和保存后重新打开。

### IE-13～IE-15 图片输入与生图

IE-13 通过真实文件选择器、Electron 剪贴板和图片字段 AI 生图验证图片暂存、预览、移除和保存；IE-15 验证独立 AI 生图面板的批量生成、保存、完成和取消。

### IE-16 内置 Interface 首次安装

使用打包应用实际携带的 `resources/builtin/interface-editor`，从全新 `userData` 启动后验证上海高考英语口语题型自动安装、显示「内置」标记、详情页入口和字段内容。

## 覆盖边界

- Provider 配置和测试用已发布题型由测试预置；草稿定义、题组实例和内置题型则通过真实 UI 或应用启动流程创建。
- 图片资产校验、JSON Schema 生成等纯领域逻辑由 `application.integration.test.ts` 覆盖；本套件验证的是真实 renderer/HTTP/IPC 链路与 UI 反馈。
- 不访问公网，不请求真实 AI Provider。
