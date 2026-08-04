# AI Router

`@ls101/airouter` 为 Electron main 和 renderer 提供文本生成与图像生成基础设施。文本和图像 Provider 使用完全独立的普通配置、模型列表和加密密钥；AIRouter 不保存业务图片文件。

## 文本生成

文本 Provider 支持 `openai-compatible` 和 `anthropic`。OpenAI Compatible 显式使用 Chat Completions 模型，renderer client 将 main 发送的 `reasoning-delta` 和 `text-delta` 转换为 AIRouter 自身的异步增量流。

文本请求包含 Provider 配置 ID、模型 ID 和 prompt。调用者可以用 `AbortSignal` 取消；renderer 通过请求 ID IPC 通知 main 的 `AbortController`。

## 图像生成

图像 Provider 当前只支持 `openai-compatible`，配置保存在 `config/airouter/image-providers.json`，密钥保存在独立的 `airouter/image-providers` secret scope。它不复用文本 Provider 或文本密钥。

公共结果为：

```typescript
interface AIRouterGeneratedImage {
  data: Uint8Array
  mediaType: string
}
```

API 模式使用 AI SDK `generateImage()` 和 OpenAI image model。一次调用只返回一张图片；prompt 不能为空，可选尺寸范围为 1 到 8192，结果必须是 `image/*` 且不能超过 20 MB。图像通过 IPC 返回 renderer，不创建临时文件。

图像请求使用独立的 start/result/error/abort IPC 通道，因此 renderer 的 `AbortSignal` 可以取消 main 中的远端请求。取消时 client 以 `AbortError` 拒绝 Promise。

## 生成模式

图像生成设置默认是：

```typescript
{
  mode: 'manual'
}
```

用户也可以选择一个已启用的图像 Provider 模型作为默认 API 模型。删除当前 Provider，或在编辑 Provider 时禁用当前默认模型，会自动回退到手动模式。

手动模式由 renderer 的全局请求队列实现。任何页面发起图片生成后，应用根节点显示模态框：

- 展示只读提示词并通过 Electron 剪贴板通道复制。
- 从系统文件对话框导入 PNG、JPEG、GIF 或 WebP。
- 从系统剪贴板读取并编码为 PNG。
- 用户确认后把图片字节作为正常生成结果返回。
- 用户关闭、取消或调用方中止信号时，以 `AbortError` 结束当前请求。
- 同时发生多个请求时按发起顺序逐个展示。

## 设置界面

`设置 → AI 引擎 → 图像生成` 提供：

- 手动生成和 API Provider 模式切换。
- 独立图像 Provider 的 Base URL、API Key 和模型管理。
- `/models` 模型发现和手动模型 ID 添加。
- 默认图像模型选择。
- 实际生成图片的连接测试；该测试可能产生 Provider 费用。

## Interface 集成

Interface 整套 AI 生成先完成文本流和 JSON 校验，再按图片变量逐张调用图像生成器。所有图片成功后，文本值、图片提示词和图片 assets 一次提交给仓储；失败或取消时不保存部分结果。

图片任务以无日志的扁平进度项展示。图片字段还提供单独的“生成图片”操作，结果进入 renderer 的待保存表单状态，用户保存题组后才写入 assets。

## 验证覆盖

自动化测试覆盖独立配置和密钥、默认模式回退、图片二进制返回、IPC 取消、手动请求队列、模态框剪贴板导入、设置页模式切换、Interface 图片进度与原子资源保存。真实远端 Provider 的付费调用未纳入自动化测试。

## 代码依据

- `packages/airouter/src/main/image-service.ts`
- `packages/airouter/src/main/index.ts`
- `packages/airouter/src/shared/types.ts`
- `packages/airouter/src/renderer/index.ts`
- `packages/renderer/src/features/airouter/AIRouterImageSettingsPage.tsx`
- `packages/renderer/src/features/airouter/ManualImageGenerationDialog.tsx`
- `packages/interface-editor/src/application.ts`
