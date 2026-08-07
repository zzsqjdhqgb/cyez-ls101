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

Linux 容器或无桌面环境：

```bash
xvfb-run -a yarn test:playwright tests/integration/airouter.spec.ts
```

命令先为当前平台执行 `electron-builder --dir`，测试直接启动 unpacked 可执行文件。

所有路径都使用独立的临时 Electron `userData` 目录。本地模拟服务只监听
`127.0.0.1` 的随机端口，模拟 OpenAI-compatible、Anthropic 和图像生成协议；测试不使用真实 API Key，也不访问公网。

## 设置与初始状态

### AR-01 AI 引擎设置入口与分类导航

测试路径：`工作台 -> 设置 -> AI 引擎 -> 文本/图像/语音合成/语音识别`。

操作流程：从侧栏进入设置，再打开 AI 引擎，依次点击四个分类标签并返回文本生成，最后再次切到语音合成和语音识别。

测试内容：设置入口、分类路由和选中状态均正常；语音合成显示真实的 Provider 与 TTS 模型包设置区域，语音识别仍显示占位页；文本 Provider 空状态正常显示。

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

测试内容：Anthropic 类型、Base URL 和模型独立持久化；重载后模型仍启用，类型控件保持禁用且未被转为 OpenAI-compatible。

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

操作流程：启动慢模型，等待 mock 收到请求后调用 preload 返回的取消函数，随后发起第二个正常请求。

测试内容：取消后 renderer 不接收迟到事件，底层连接在响应前关闭，后续请求仍能完整结束，证明 active request 和监听器没有污染下一次调用。

### AR-14 文本 Provider 错误、流失败与截断反馈

测试路径：`renderer -> OpenAI HTTP 401 / Anthropic HTTP 400 / stream error / length / content_filter -> renderer error`。

操作流程：分别使用 OpenAI-compatible 和 Anthropic Provider 触发协议特有 HTTP 错误，再触发流内错误、长度截断和内容过滤。

测试内容：两种 Provider 的 HTTP 错误和流内错误保留服务端消息；长度和内容过滤转换为稳定的中文 AIRouter 错误，所有失败均不以 `done` 冒充成功。

## 图像 Provider 与生成

### AR-15 手动图像生成、文件与剪贴板导入

测试路径：`图像设置 -> 手动生成 -> 全局导入对话框 -> file-dialog IPC / Electron clipboard`。

操作流程：把测试 PNG 写入当前临时目录并让 main 文件对话框返回该路径，经真实 file-dialog IPC 读取并确认；再次打开后复制提示词、从真实剪贴板读取并确认；第三次打开执行取消。

测试内容：真实文件读取、提示词展示和复制、真实剪贴板图片读取、预览、确认结果、成功反馈和取消关闭均正常；测试结束一次性恢复原剪贴板文本和图片并验证恢复结果。

### AR-16 OpenAI-compatible 图像 Provider 配置

测试路径：`图像生成 -> 添加 Provider -> 保存 -> reload -> 图像生成`。

操作流程：通过 UI 填写图像名称、独立 Base URL、图像 API Key 和模型，保存后重载。

测试内容：重载后图像类型锁定，Base URL、模型 ID、启用状态和密钥均精确恢复；再用相同 Provider ID 保存文本配置和不同密钥，两个配置列表与密钥读取结果仍完全独立。

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

操作流程：依次调用四种 mock 模型；慢请求在 mock 收到请求后取消，并观察底层连接状态。

测试内容：HTTP 错误、非图片结果和超限结果返回明确错误；非图片校验基于真实字节签名而非 Provider 声明；取消后无迟到 result，HTTP 连接提前关闭。

### AR-20 图像 Provider 删除与可选择项兜底

测试路径：`API Provider + manual -> 删除 manual -> UI 删除 API -> 自动恢复 manual`。

操作流程：先保存唯一启用的 API Provider并删除默认手动配置，确认不产生多余兜底；再禁用其唯一模型并确认恢复手动 Provider，最后从 UI 经确认删除 API Provider。

测试内容：有可选 API 模型时不额外恢复手动 Provider；API 模型全部禁用或 Provider 被删除时自动恢复无密钥的“手动生成”入口，API 密钥随配置删除。

### AR-21 图像 Provider 编辑、模型管理与密钥生命周期

测试路径：`已保存图像 Provider -> 显示密钥 -> 编辑名称/模型/密钥 -> 保存 -> 清空密钥 -> reload`。

操作流程：读取已保存密钥并替换；重复添加模型、禁用已有模型、删除临时模型并保存；再次读取替换后的密钥，然后清空并重载。

测试内容：图像模型 ID 去重，禁用和删除状态正确持久化；密钥按需读取、替换和删除均经过真实独立 secret scope；重载后名称、启用模型数量和无密钥状态正确恢复。

### AR-22 文本与图像草稿连接失败反馈

测试路径：`未保存文本草稿 -> HTTP 401 -> UI error -> 未保存图像草稿 -> HTTP 429 -> UI error`。

操作流程：分别用文本和图像未保存草稿执行失败的连接测试，观察设置编辑器错误反馈并读取持久化配置。

测试内容：两类连接测试显示 Provider 原始错误消息，失败草稿不会产生文本配置或图像 API 配置。

### AR-23 图像请求输入校验

测试路径：`renderer preload -> IPC -> main validation -> renderer error`。

操作流程：向已保存 API 图像 Provider 依次提交空白提示词、宽度为 `0`、高度为 `8193` 和非整数宽度的请求。

测试内容：空提示词和超出 `1..8192` 整数范围的尺寸返回稳定错误，所有请求都在 main 校验阶段终止，不访问 mock HTTP 服务。

### AR-24 模型发现失败反馈

测试路径：`文本 Provider 草稿 -> mock /v1/models 500 -> 编辑器错误 -> 图像 Provider 草稿 -> mock /v1/models 401 -> 编辑器错误`。

操作流程：先用文本草稿触发模型发现失败，关闭编辑器后切到图像生成，再触发一次图像模型发现失败。

测试内容：两类模型发现失败都展示「获取模型列表失败（HTTP 状态码）」错误反馈，草稿保持打开但均未持久化（文本列表为空、图像列表仍只有默认 manual Provider）。

### AR-25 未保存草稿的关闭路径

测试路径：`添加 Provider -> 填写草稿 -> 取消按钮 / Escape / 遮罩点击`。

操作流程：三次打开并填写同一个未保存草稿，分别用「取消」按钮、Escape 键和编辑器遮罩点击关闭。

测试内容：三种关闭方式都关闭编辑器且不留下任何已保存配置，证明未保存草稿不会意外持久化。

### AR-26 保存与 busy 状态约束

测试路径：`已保存 Provider -> 无修改保存禁用 -> 改名后启用 -> 新草稿 -> 空名称禁用 -> 慢连接测试期间控件禁用 -> 完成后恢复`。

操作流程：先验证已有 Provider 无修改时保存禁用、改名后启用；再验证新草稿空名称时保存禁用，并在慢速连接测试期间输入框和保存按钮全部禁用，测试结束后恢复可用。

测试内容：保存按钮的禁用条件（空名称、无修改、busy）以及 busy 期间编辑器控件的禁用状态符合预期。

### AR-27 流中取消（收到部分输出后）

测试路径：`renderer start -> mock 先发一个 chunk 再延迟 -> 收到 chunk 后 abort -> HTTP close -> 后续正常生成`。

操作流程：启动 `mock-partial-slow` 模型，等待第一个 chunk 到达 renderer 后再调用 preload 取消函数。

测试内容：取消后 renderer 只保留已收到的部分 chunk、不再收到迟到事件，底层连接在响应完成前关闭，后续请求仍能正常结束。

## 语音合成 Provider 与模型包

### AR-28 本地 TTS 模型包与 Provider 生命周期

测试路径：`语音合成 -> 本地 Provider -> 文件对话框 IPC -> ZIP 模型包 -> Provider 保存/删除 -> 模型包删除`。

操作流程：在空状态创建本地 Pocket TTS Provider，确认没有兼容模型包时只显示导入提示；通过测试文件路径注入 ZIP 并经真实 file-dialog IPC 导入一个包含两个模型、两个音色和三个相同资源的轻量模型包，保存 Provider，重载后读取模型/音色列表，再删除 Provider 和模型包。

测试内容：模型包 manifest、模型与音色显示、导入后默认全启用、相同资产的 `storedAssetCount/reusedAssetCount`、本地 Provider 配置持久化、模型包运行时列表、模型包被引用时删除按钮禁用、Provider 删除后资源包可删除，以及模型包删除后的空状态均符合契约。测试包使用合法的 Pocket TTS manifest，但不执行真实模型推理。

### AR-29 在线 TTS Provider 配置与连接测试

测试路径：`语音合成 -> 在线 Provider 草稿 -> /v1/models -> /v1/audio/speech -> API Key secret -> reload`。

操作流程：填写在线 Provider 地址和独立 API Key，从 mock `/v1/models` 获取模型并启用一个模型，手动添加音色，直接执行连接测试，确认播放器结果后保存并重载。

测试内容：在线模型发现、音色配置、OpenAI-compatible 语音请求体、Bearer 鉴权、音频 Blob 播放器、Provider 持久化、独立语音密钥读取和配置摘要不泄漏密钥均经过真实 renderer/main/preload/IPC 往返。

### AR-30 语音角色路由、片段合并与输出格式

测试路径：`renderer preload -> IPC -> main AIRouter -> /v1/audio/speech -> renderer`。

操作流程：保存包含 `default`、`man` 和 `woman` 音色的在线 Provider，通过 preload 提交带 `[Man]:`、`[Woman]:` 标记的多行文本，再提交单片段 MP3 请求。

测试内容：角色标记不传给 Provider；连续相同角色合并为一次请求；未标记文本走 `default`；所有 Provider 片段请求统一使用 `response_format=wav` 并按原顺序合并为 PCM WAV；最终 WAV/MP3 结果的媒体类型和格式符合调用方要求。

### AR-31 语音错误、取消与请求复用

测试路径：`语音 HTTP 401 / 非音频结果 / 慢响应 -> preload abort -> HTTP close -> 后续正常合成`。

操作流程：依次触发 mock 语音鉴权错误和非音频响应；启动慢速语音请求，在 mock 收到请求后调用 preload 返回的取消函数，最后用同一 Provider 发起正常合成。

测试内容：服务端错误消息和音频类型校验错误传递到 renderer；取消不产生迟到事件且 HTTP 响应提前关闭；取消后的 active request、IPC 监听器和 Provider 仍可被后续请求复用。

### AR-32 真实 Pocket TTS 模型包合成

测试路径：`setup TTS 资产 -> ZIP 模型包 -> 语音设置连接测试 -> 保存 Provider -> preload startSpeechSynthesis -> Pocket TTS WASM Worker`。

操作流程：使用 setup 阶段下载的 Pocket TTS 模型权重、tokenizer 和 Alba 音色生成测试模型包，经真实文件对话框导入，在 UI 中执行连接测试并确认音频播放器，再保存 Provider，通过 preload 发起完整语音合成。

测试内容：真实模型包资产校验、模型包加载、WASM Worker 初始化、音频生成、连接测试 IPC 以及合成事件 IPC 均成功返回 24 kHz 单声道 WAV。该路径使用本地资产，不访问公网。

## 覆盖边界

- AR-11、AR-12、AR-18、AR-19、AR-23、AR-30、AR-31 和 AR-32 从真实 renderer preload bridge 发起，覆盖 HTTP 或 main 校验、AI SDK、IPC 和 preload，但不绑定某个题型编辑器的业务流程。
- AR-28 使用轻量合法模型包覆盖模型包/Provider 生命周期；AR-32 使用 setup 下载的真实 Pocket TTS 资产覆盖实际 WASM 推理，因此模型包导入测试和真实推理测试不会互相承担不必要的重量。
- `AIRouterSettingsPage.test.tsx` 继续覆盖 renderer 组件的细粒度分支；Playwright 额外覆盖真实文件读取、语音 Provider 配置、在线连接测试、语音合成路由、取消和 Pocket TTS Worker。
- AR-15 覆盖真实文件读取 IPC，但用测试路径替代交互式系统文件选择窗口；不验证各操作系统原生对话框的视觉与人工选择行为。
- AR-28 和 AR-32 同样用测试路径替代人工选择 ZIP 文件；不验证各操作系统原生文件选择窗口的视觉与人工选择行为。
- 手动图像请求的并发 FIFO 队列和调用方 `AbortSignal` 由 `ManualImageGeneration.test.ts` 覆盖，不在 Playwright 中重复构造并发业务页面。
- 题型编辑器如何列出、选择和消费 AIRouter 模型，属于题型实例编辑器的独立集成测试路径。
- 当前没有 Qwen TTS runtime 实现，未执行 Qwen 模型包推理；也未覆盖未来 Qwen Provider 的具体参数协议。
- 当前不覆盖损坏的 Provider 配置文件、应用退出时仍在进行的请求恢复，以及模型发现接口失败或畸形 SSE 的所有第三方变体。
- 本套件不访问公网，不验证第三方服务的实时可用性、计费或限流策略。
