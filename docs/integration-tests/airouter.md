<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# AIRouter 集成测试路径

源文件：[`tests/integration/airouter.spec.ts`](../../tests/integration/airouter.spec.ts)

本地模拟服务：[`tests/integration/support/mock-ai-server.ts`](../../tests/integration/support/mock-ai-server.ts)

运行命令：

```bash
yarn test:playwright tests/integration/airouter.spec.ts
```

所有路径都使用独立的临时 Electron `userData` 目录。本地模拟服务只监听
`127.0.0.1` 的随机端口，模拟 OpenAI-compatible、Anthropic 和图像生成协议；测试不使用真实 API Key，也不访问公网。

## 设置与初始状态

### AR-01 AI 引擎设置入口与分类导航

测试路径：`工作台 -> 设置 -> AI 引擎 -> 文本/图像/语音合成/语音识别`。

操作流程：从侧栏进入设置，再打开 AI 引擎，依次点击四个分类标签并返回文本生成。

测试内容：设置入口、分类路由、选中状态以及文本 Provider 空状态均能正常显示。

### AR-02 文本空状态与默认手动图像 Provider

测试路径：`AI 引擎/文本生成 -> AI 引擎/图像生成 -> preload 配置列表`。

操作流程：检查全新目录的文本页面，再切到图像页面，并通过 preload 读取两个配置域。

测试内容：文本 Provider 列表为空；图像域自动返回唯一的 `manual` Provider，且两个配置域相互独立。

## 文本 Provider 配置

### AR-03 OpenAI-compatible Provider 创建与重载

测试路径：`文本生成 -> 添加 Provider -> 保存 -> renderer reload -> 文本生成`。

操作流程：通过 UI 填写名称、本地 Base URL、API Key 和手动模型，保存后重载并重新进入 AI 引擎。

测试内容：名称、类型、地址、启用模型和密钥存在状态均恢复；配置摘要不包含密钥明文。

### AR-04 Anthropic Provider 创建与重载

测试路径：`文本生成 -> 添加 Provider -> Anthropic -> 保存 -> reload`。

操作流程：切换 Provider 类型，确认默认 Anthropic 地址，替换为 mock 地址并添加模型后保存和重载。

测试内容：Anthropic 类型、Base URL 和模型独立持久化，编辑时类型保持锁定且未被转为 OpenAI-compatible。

### AR-05 文本 Provider API Key 生命周期

测试路径：`已保存 Provider -> 显示密钥 -> 替换 -> 保存 -> 再次读取 -> 清空 -> 保存`。

操作流程：先通过 preload 建立带密钥配置，再从 UI 按需读取密钥、替换密钥，重新读取后清空。

测试内容：保存状态提示、按需读取、替换和删除均经过真实密钥存储；最终读取结果为 `null`。

### AR-06 文本模型手动管理与启用状态

测试路径：`添加 Provider -> 手动添加 alpha/alpha/beta -> 禁用 beta -> 删除 alpha -> 保存`。

操作流程：重复添加同一模型，再添加第二个模型，修改启用状态并删除第一个模型。

测试内容：重复 ID 被去重，删除生效，禁用状态在持久化配置中保持为 `false`。

### AR-07 文本模型发现与现有配置合并

测试路径：`Provider 草稿 -> 添加现有模型 -> 获取模型列表 -> mock /v1/models`。

操作流程：草稿中先加入已发现模型和自定义模型，再请求 mock 返回的无序、混合格式模型列表。

测试内容：有效模型被规范化并按 ID 排序；已有模型的启用状态和未发现的自定义模型被保留；请求携带草稿 API Key。

### AR-08 OpenAI-compatible 未保存草稿连接测试

测试路径：`未保存草稿 -> 测试连接 -> /v1/chat/completions -> 配置列表`。

操作流程：填写本地地址、草稿密钥和启用模型，直接点击测试连接，不执行保存。

测试内容：固定短请求得到 `OK`，OpenAI Bearer 鉴权正确，测试后持久化 Provider 列表仍为空。

### AR-09 Anthropic 未保存草稿连接测试

测试路径：`Anthropic 草稿 -> 测试连接 -> /v1/messages`。

操作流程：选择 Anthropic，填写草稿地址、密钥和模型后执行连接测试。

测试内容：请求走 Anthropic messages 路由，携带 `x-api-key` 和版本头，不产生 OpenAI chat 请求。

### AR-10 文本 Provider 编辑、删除与密钥清理

测试路径：`两个已保存 Provider -> 编辑目标 -> 保存 -> 删除确认 -> preload 校验`。

操作流程：修改目标名称并添加模型，保存后经确认弹窗删除，再读取配置与密钥。

测试内容：目标配置和密钥同时删除，读取已删除密钥返回“配置不存在”，另一个 Provider 及其密钥不受影响。

## 文本生成运行时

### AR-11 OpenAI-compatible 文本流端到端传递

测试路径：`renderer preload -> IPC -> main AIRouter -> /v1/chat/completions SSE -> renderer`。

操作流程：保存 OpenAI-compatible 配置，从 renderer 启动文本生成并收集事件直到 `done`。

测试内容：两个 output 增量按顺序到达，流正常结束；HTTP 请求包含目标模型、prompt 和 `stream=true`。OpenAI chat 路径不声明 reasoning 增量。

### AR-12 Anthropic 文本流端到端传递

测试路径：`renderer preload -> IPC -> main AIRouter -> /v1/messages SSE -> renderer`。

操作流程：保存 Anthropic reasoning 模型并收集完整流事件。

测试内容：Anthropic thinking block 转为 AIRouter reasoning chunk，text block 转为 output chunk，最后发送统一的 `done` 事件。

### AR-13 文本生成取消与资源释放

测试路径：`renderer start -> mock 延迟响应 -> renderer abort -> HTTP close -> 后续正常生成`。

操作流程：启动慢模型，100 ms 后调用 preload 返回的取消函数，随后发起第二个正常请求。

测试内容：取消后 renderer 不接收迟到事件，底层连接在响应前关闭，后续请求仍能完整结束，证明 active request 和监听器没有污染下一次调用。

### AR-14 文本 Provider 错误与截断反馈

测试路径：`renderer -> HTTP 401 / length finish / content_filter finish -> renderer error`。

操作流程：依次调用 mock 的鉴权失败、长度截断和内容过滤模型。

测试内容：Provider HTTP 错误保留服务端消息；长度和内容过滤转换为稳定的中文 AIRouter 错误，均不以 `done` 冒充成功。

## 图像 Provider 与生成

### AR-15 手动图像生成与剪贴板导入

测试路径：`图像设置 -> 手动生成 -> 测试手动生成 -> 全局导入对话框 -> Electron clipboard`。

操作流程：打开默认手动 Provider，复制提示词，将测试 PNG 放入系统剪贴板，从剪贴板读取并确认；再次打开后执行取消。

测试内容：提示词展示和复制、真实剪贴板图片读取、预览、确认结果、成功反馈和取消关闭均正常；测试结束恢复原剪贴板。

### AR-16 OpenAI-compatible 图像 Provider 配置

测试路径：`图像生成 -> 添加 Provider -> 保存 -> reload -> 图像生成`。

操作流程：通过 UI 填写图像名称、独立 Base URL、图像 API Key 和模型，保存后重载。

测试内容：图像配置和密钥状态正确恢复；同一测试中的文本 Provider 保持在文本配置域，不与图像配置混合。

### AR-17 图像模型发现与连接预览

测试路径：`未保存图像草稿 -> /v1/models -> 启用模型 -> /v1/images/generations -> 预览`。

操作流程：使用草稿地址和密钥发现模型，启用 `mock-image` 后直接执行测试连接。

测试内容：发现数量正确，连接成功反馈与图片预览可见，请求携带草稿密钥，持久化列表仍只有默认手动 Provider。

### AR-18 API 图像生成端到端传递

测试路径：`renderer preload -> IPC -> main AIRouter -> /v1/images/generations -> renderer`。

操作流程：保存 API 图像 Provider，通过 preload 提交提示词和 `256x128` 尺寸并等待 result 事件。

测试内容：请求模型、提示词和尺寸正确；返回媒体类型为 PNG，renderer 收到的字节与 mock 原始 PNG 完全一致。

### AR-19 图像生成错误、取消与结果限制

测试路径：`HTTP 429 / 非图片字节 / 超过 20 MB / 延迟响应取消 -> renderer`。

操作流程：依次调用四种 mock 模型；慢请求在 100 ms 后取消，并观察底层连接状态。

测试内容：HTTP 错误、非图片结果和超限结果返回明确错误；非图片校验基于真实字节签名而非 Provider 声明；取消后无迟到 result，HTTP 连接提前关闭。

### AR-20 图像 Provider 删除与可选择项兜底

测试路径：`API Provider + manual -> 删除 manual -> UI 删除 API -> 自动恢复 manual`。

操作流程：先保存唯一启用的 API Provider并删除默认手动配置，再从 UI 经确认删除 API Provider。

测试内容：API 密钥随配置删除；当不存在手动 Provider 或启用 API 模型时，服务自动恢复无密钥的“手动生成”入口。

## 覆盖边界

- AR-11、AR-12 和 AR-18 从真实 renderer preload bridge 发起，覆盖 HTTP、AI SDK、main、IPC 和 preload，但不绑定某个题型编辑器的业务流程。
- 题型编辑器如何列出、选择和消费 AIRouter 模型，属于题型实例编辑器的独立集成测试路径。
- 本套件不访问公网，不验证第三方服务的实时可用性、计费或限流策略。
