// @ls101/airouter — AI 统一抽象层（LLM / STT / TTS）

// 统一接口 + 多后端实现
//
// TODO(interface-editor): 文本生成 API 需要满足以下需求。
// 消费位置：
// - packages/interface-editor/src/application.ts 的 InterfaceTextGenerator
// - InterfaceInstanceApplication.startAIGeneration()
//
// 1. 接收最终发送给模型的完整 prompt，返回 AIRouter 自己规范的流式文本接口。
// 2. 流中应区分最终 output 与模型可提供的 reasoning/思考增量；Interface 需要
//    累计并分别展示这两类内容。模型不支持 reasoning 时只产生 output 即可。
// 3. 使用 AbortSignal 或 AIRouter 自己的等价取消协议，取消后流应结束或抛出
//    可辨识的取消错误。
// 4. AIRouter 不依赖 @ls101/core-types 的 TaskProgressHandle，也不负责组织 UI 任务列表。
//    Interface 等调用者负责把 AIRouter 流适配成自己的 TaskProgressHandle。
// 5. 流异常应保留可供调用者转换为业务错误的信息，同时不泄漏不必要的供应商细节。
// 6. Interface 的 image 字段还需要“文本提示词 -> 图片资源”的普通异步生成能力。
//    图片生成返回 Promise，不要求流式日志。Interface 会为每张图片建立无日志的
//    TaskProgressItem，在 Promise 开始和结束时更新 running/completed 状态，然后负责
//    将图片写入实例目录并把字段值替换为本地资源引用。
//
// 预期的最小能力形状（仅作需求说明，待 AIRouter 实现时确定正式命名）：
//
// interface TextGenerationRequest {
//   prompt: string
// }
//
// interface TextGenerationChunk {
//   type: 'reasoning' | 'output'
//   delta: string
// }
//
// interface AIRouter {
//   generateText(
//     request: TextGenerationRequest,
//     options: { signal: AbortSignal }
//   ): AsyncIterable<TextGenerationChunk>
//
//   generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>
// }
export {}
