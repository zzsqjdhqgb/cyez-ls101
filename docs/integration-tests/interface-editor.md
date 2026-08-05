<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 题型编辑器集成测试路径

源文件：[`tests/integration/interface-editor.spec.ts`](../../tests/integration/interface-editor.spec.ts)

本地模拟服务：[`tests/integration/support/mock-ai-server.ts`](../../tests/integration/support/mock-ai-server.ts)

运行命令：

```bash
yarn test:playwright tests/integration/interface-editor.spec.ts
```

Linux 容器或无桌面环境：

```bash
xvfb-run -a yarn test:playwright tests/integration/interface-editor.spec.ts
```

本套件系统性覆盖题型编辑器的全部主要 UI 流程与可点击元素：题型列表/详情页按钮、草稿创建编辑与发布、字段树（字段组/类型/删除节点）、实例创建/编辑/删除、图片字段按钮、JSON 覆盖、AI 生成与独立 AI 生图面板，以及导出导入。其中 AI 生成验证真实跨包链路：`题型实例编辑器 -> InterfaceAIRouterAdapter / ConfiguredImageGenerator -> airouter renderer client -> sandbox preload -> ipcMain -> AIRouterService / AIRouterImageService -> AI SDK -> mock HTTP`。

每条路径都用独立的临时 Electron `userData` 目录。已发布的题型通过 `fileStore` bridge 直接写入 `FileInterfaceRepository` 的存储布局（`interfaces/published/<interfaceId>/interface.json`），interface id 按仓库相同的 canonicalization + SHA-256 规则推导；题组实例由 UI「新建题组」创建，草稿在删除类用例中直接写入 `interfaces/drafts/<draftId>/draft.json` 作为预置。

## 设置与数据预置

- `textInterface`：两个文本叶子字段（`title`/`answer`），AI 返回 `{"title":"AI 标题","answer":"AI answer"}`。
- `imageInterface`：一个文本叶子（`title`）和一个图片叶子（`picture`），AI 返回 `{"title":"AI 标题","picture":"A green circle icon"}`，图片字段的提示词再经图像 Provider 生成 PNG。
- 导出/导入用例通过 `electronApp.evaluate` 替换 `dialog.showSaveDialog`/`showOpenDialog`，指向测试临时目录中的 `.lsinterface` 文件，不显示系统对话框。

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

### IE-04 草稿创建、编辑与持久化

测试路径：`题型草稿 -> 新建草稿 -> 基本信息/提示词 -> 添加字段 -> 节点配置 -> 保存 -> 返回列表 -> 重新打开`。

操作流程：从 UI 新建草稿并填写名称、描述和生成要求，添加一个文本字段并配置字段标识、变量名、描述和示例，保存后返回列表再重新打开。

测试内容：草稿全部内容（基本信息、提示词、字段树与节点配置）在重载后完整保留，证明草稿保存走真实 repository 持久化。

### IE-05 草稿发布与校验

测试路径：`新建草稿 -> 添加字段但变量名为空 -> 发布失败 -> 补齐节点配置 -> 发布成功 -> 题型详情 -> 题型列表`。

操作流程：先以不完整字段发布触发校验，补全字段配置后再次发布。

测试内容：发布前校验错误（「变量名不能为空」）正确展示且不离开编辑器；补齐后发布成功并跳转题型详情页，新题型出现在已发布列表。

### IE-06 草稿删除与未保存修改离开确认

测试路径：`预置草稿 -> 删除确认弹窗 -> 列表为空 -> 新建草稿 -> 编辑后返回 -> 放弃弹窗 -> 取消留在页面 -> 放弃修改离开`。

操作流程：删除预置草稿；再新建草稿修改名称后不保存返回，先取消放弃留在编辑器，再次返回并确认放弃。

测试内容：删除走确认弹窗并持久化移除；「放弃未保存的修改」弹窗的取消与确认两条路径符合预期，未保存的名称修改在放弃后不写入草稿。

### IE-07 实例编辑、保存与离开确认

测试路径：`新建题组 -> 填写题组名称与字段值 -> 保存 -> 返回详情 -> 重开校验 -> 修改后返回 -> 放弃弹窗`。

操作流程：通过 UI 编辑题组并保存，重开后验证值保留；再修改后不保存返回，验证放弃弹窗的取消与确认行为。

测试内容：实例保存走真实 repository；重载后值保留；放弃修改后保留上次保存的内容。

### IE-08 JSON 覆盖

测试路径：`JSON 面板 -> 合法 JSON 覆盖全部值 -> 校验落盘 -> 非法 JSON -> 错误提示且实例不变`。

操作流程：先用合法 JSON 覆盖题组值并验证持久化，再提交非法 JSON。

测试内容：合法 JSON 覆盖更新表单并落盘；非法 JSON 显示解析错误、实例内容保持不变。

### IE-09 实例删除

测试路径：`题型详情 -> 删除题组 -> 确认弹窗 -> 题组列表为空 -> 文件存储校验`。

操作流程：删除新建的题组并确认。

测试内容：删除后详情页显示空状态、toast 反馈正确，文件存储中对应实例目录被移除。

### IE-10 复制为草稿

测试路径：`题型详情 -> 复制为草稿 -> 草稿编辑器 -> 草稿列表`。

操作流程：从已发布题型详情复制为草稿并进入草稿编辑器。

测试内容：复制操作创建同名草稿并正确跳转，草稿列表出现对应条目。

### IE-11 导出与导入往返

测试路径：`题型详情 -> 导出（mock 保存对话框）-> 清空已发布分区 -> 题型列表为空 -> 导入（mock 打开对话框）-> 题型与题组恢复`。

操作流程：导出含题组的题型为 `.lsinterface` 文件并断言文件为 ZIP 且非空；用 `fileStore` 清空已发布分区作为数据预置；再从同一文件导入。

测试内容：导出写入真实文件，导入经真实 file-dialog IPC 读取并解码，题型和题组完整恢复，验证 file-dialog + 交换包 + repository 的跨包链路。

### IE-12 草稿字段树操作（字段组、图片类型、删除节点）

测试路径：`新建草稿 -> 添加字段组 -> 组内添加字段 -> 切换图片类型 -> 配置节点 -> 删除节点 -> 保存并重开`。

操作流程：通过「添加字段组」创建分组并验证组提示，在组内添加字段，切换字段类型为图片，配置变量名等信息后重命名标识，再删除该节点，最后保存并重新打开草稿。

测试内容：字段组与嵌套字段、类型切换、重命名、删除节点均走真实 UI 交互，删除后分组保留，持久化后字段树正确恢复。

### IE-13 实例图片字段按钮端到端

测试路径：`图片字段 -> 填提示词 -> 选 Provider -> 生成图片 -> 保存 -> 选择文件 -> 从剪贴板读取 -> 移除图片`。

操作流程：通过「生成图片」按钮经真实图像 Provider 生成并保存；再通过 mock 打开对话框的「选择文件」导入本地图片、通过真实剪贴板读取图片，最后用「移除图片」清除待导入图片。

测试内容：图片字段的生成/文件导入/剪贴板导入/移除四个按钮全部真实点击并验证预览与持久化；剪贴板在测试结束后恢复原内容。

### IE-14 题型列表与详情页按钮覆盖

测试路径：`题型列表「进入」-> 题组行「编辑」-> 展开题型定义 -> 复制完整提示词 / 复制 JSON Schema -> 剪贴板校验`。

操作流程：分别用「进入」和「编辑」按钮进入详情与实例编辑器，展开题型定义并点击两个复制按钮。

测试内容：列表「进入」、题组行「编辑」、复制按钮的真实点击与 toast 反馈；复制内容经主进程剪贴板读取验证；剪贴板测试后恢复。

### IE-15 独立 AI 生图面板端到端与取消

测试路径：`填写图片提示词 -> 保存 -> AI 生图面板 -> 选 Provider -> 开始生图 -> 完成 -> 再次打开 -> 慢速 Provider -> 取消生图`。

操作流程：先保存提示词解除 dirty 状态，打开「AI 生图」面板执行一次完整生图并完成；再次打开面板用慢速 Provider 启动后取消。

测试内容：AI 生图面板的 Provider 选择、开始生图、进度、完成、取消生图按钮全部真实点击；成功路径生成并保存图片，取消路径不覆盖已有内容。

## 覆盖边界

- Provider 配置由测试预置；草稿创建、字段配置、发布、实例编辑等操作全部走真实 UI。
- 导出/导入用例用测试路径替换系统文件选择对话框，不验证各操作系统原生对话框的视觉行为。
- 图片资产校验、JSON Schema 生成等纯领域逻辑由 `application.integration.test.ts` 覆盖；本套件验证的是真实 renderer/HTTP/IPC 链路与 UI 反馈。
- 不访问公网，不请求真实 AI Provider。
