# AI Router

`@ls101/airouter` 为 Electron main 和 renderer 提供文本生成与图像生成基础设施。文本和图像 Provider 使用完全独立的普通配置、模型列表和加密密钥；AIRouter 不保存业务图片文件。

## 文本生成

文本 Provider 支持 `openai-compatible` 和 `anthropic`。OpenAI Compatible 显式使用 Chat Completions 模型，renderer client 将 main 发送的 `reasoning-delta` 和 `text-delta` 转换为 AIRouter 自身的异步增量流。

文本请求包含 Provider 配置 ID、模型 ID 和 prompt。调用者可以用 `AbortSignal` 取消；renderer 通过请求 ID IPC 通知 main 的 `AbortController`。

## 图像生成

图像 Provider 支持 `manual` 和 `openai-compatible`。配置保存在 `config/airouter/image-providers.json`，API 密钥保存在独立的 `airouter/image-providers` secret scope。它不复用文本 Provider 或文本密钥。

公共结果为：

```typescript
interface AIRouterGeneratedImage {
  data: Uint8Array
  mediaType: string
}
```

`openai-compatible` Provider 使用 AI SDK `generateImage()` 和 OpenAI image model。一次调用只返回一张图片；prompt 不能为空，可选尺寸范围为 1 到 8192，结果必须是 `image/*` 且不能超过 20 MB。图像通过 IPC 返回 renderer，不创建临时文件。

图像请求使用独立的 start/result/error/abort IPC 通道，因此 renderer 的 `AbortSignal` 可以取消 main 中的远端请求。取消时 client 以 `AbortError` 拒绝 Promise。

## 语音合成（设计）

语音合成暂不考虑音频流式传输。AIRouter 将语音合成分为 Provider、模型包和角色路由三层：

```text
TTS Provider
  ├── 在线 Provider：openai-compatible
  └── 离线 Provider：pocket-tts、qwen-tts 等本地运行时

模型包
  ├── 一个或多个模型
  ├── 模型所需的权重、tokenizer 和其他资源
  └── 对包内全部模型可用的一组音色

角色路由
  ├── default -> Provider + Model + Voice
  ├── man     -> Provider + Model + Voice
  └── woman   -> Provider + Model + Voice
```

Provider 表示实际的后端或本地运行时。在线 Provider 当前只支持 OpenAI Compatible 格式；离线 Provider 当前支持 Pocket TTS WASM，后续可以增加 Qwen TTS 等本地运行时。一次语音调用的具体目标由 Provider、模型和音色共同决定：

```typescript
interface AIRouterSpeechTarget {
  providerConfigId: string
  modelId: string
  voiceId: string
}
```

用户不直接以单个 Provider 发起合成，而是提交带角色标记的文本，并为 `default`、`man` 和 `woman` 分别选择一个 `AIRouterSpeechTarget`。没有角色标记的行使用 `default`；`[Man]:` 和 `[Woman]:` 只作为路由控制信息，不传给 Provider：

```text
Welcome to the test.
[Man]: Please answer the following question.
[Woman]: Thank you.
```

文本会先按行解析为角色片段，再按顺序调用对应目标并拼接完整音频。连续且目标相同的片段可以合并以减少调用次数。`man` 或 `woman` 没有单独配置时，建议回退到 `default`。内部统一让各 Provider 生成 PCM WAV，完成片段拼接后再一次性转换为调用方要求的 `wav`、`mp3`、`opus` 或 `pcm-s16le`，避免直接拼接压缩音频容器造成无效结果。

### Provider 配置

语音 Provider 使用独立的配置和密钥范围，不复用文本或图像 Provider：

```text
配置：config/airouter/speech-providers.json
密钥：airouter/speech-providers/{providerId}
```

建议区分 Provider 的通用类别和具体运行时：

```typescript
interface AIRouterSpeechProviderConfig {
  id: string
  name: string
  kind: 'online' | 'local'
  type: 'openai-compatible' | 'pocket-tts' | 'qwen-tts'
  baseUrl?: string
  modelPackageId?: string
  models: AIRouterModelConfig[]
  voices: AIRouterVoiceConfig[]
}
```

在线 Provider 配置 Base URL、API Key 和可用模型。离线 Provider 不需要 Base URL 或 API Key，而是选择一个兼容的模型包，然后勾选启用的模型和音色。同一个模型包可以被多个离线 Provider 配置引用，以支持不同的模型或音色组合。

### 设置页面

语音合成设置页面分为两个区域：

- Provider 区域：创建、选择和删除在线或离线 Provider。
- 模型包与模型区域：根据当前 Provider 类型展示模型包、模型和音色配置。

选择本地 Provider 后，只展示与该运行时兼容的模型包：

- 没有任何可用模型包时，隐藏模型和音色配置，展示“请先导入模型包”的空状态和导入按钮；未来可以在此增加模型包下载链接。
- 已导入至少一个可用模型包时，先选择模型包，再勾选该包中启用的模型和音色。
- Pocket TTS 模型包不会显示在 Qwen TTS Provider 下；兼容性由 manifest 中的运行时标识和 API 版本判断。
- `minimumAppVersion` 高于当前应用版本的模型包拒绝导入；应用降级后，已安装但不再兼容的模型包不出现在可选列表中，也不能被 Provider 加载。

### 模型包格式

当前模型包使用普通 ZIP，manifest 固定位于压缩包根目录：

```text
pocket-tts-en-1.0.0.zip
├── manifest.json
├── model/
├── tokenizer/
├── voices/
├── LICENSE
└── README.md
```

模型包只携带模型数据，不携带可执行 JS、WASM 或原生代码。运行时由软件本体提供；发布安装包不再默认内置 TTS 模型包，发布流程同时产出独立模型包文件。现有 Pocket TTS 的 WASM runtime 可以继续作为软件运行时资源，模型权重、tokenizer 和 voice embedding 改由模型包提供。

manifest v1 采用以下结构：

```json
{
  "format": "ls101.tts-model-package",
  "formatVersion": 1,
  "package": {
    "id": "pocket-tts-en",
    "version": "1.0.0",
    "name": "Pocket TTS English"
  },
  "runtime": {
    "engine": "pocket-tts",
    "engineApiVersion": 1,
    "minimumAppVersion": "0.4.0"
  },
  "assets": [
    {
      "path": "model/tts_b6369a24.safetensors",
      "kind": "model-weights",
      "size": 235738732,
      "sha256": "..."
    },
    {
      "path": "tokenizer/tokenizer.model",
      "kind": "tokenizer",
      "size": 59339,
      "sha256": "..."
    },
    {
      "path": "voices/alba.safetensors",
      "kind": "voice",
      "size": 6148328,
      "sha256": "..."
    }
  ],
  "models": [
    {
      "id": "pocket-tts-en-v1",
      "name": "Pocket TTS English v1",
      "languageCodes": ["en", "en-US"],
      "artifacts": {
        "weights": ["model/tts_b6369a24.safetensors"],
        "tokenizer": ["tokenizer/tokenizer.model"]
      },
      "parameters": {
        "load": {
          "quantization": "f32"
        },
        "audio": {
          "sampleRate": 24000,
          "channels": 1,
          "encoding": "pcm_s16le",
          "defaultFormat": "wav"
        },
        "synthesis": {
          "maxTokensPerChunk": 50,
          "silenceBetweenChunksMs": 200,
          "temperature": 0.7
        }
      }
    }
  ],
  "voices": [
    {
      "id": "alba",
      "name": "Alba",
      "languageCodes": ["en", "en-US"],
      "files": ["voices/alba.safetensors"]
    }
  ],
  "extensions": {}
}
```

`assets` 是模型包的完整资产索引，模型和音色通过相对路径引用其中的资产。所有资产必须声明 `size` 和 `sha256`，导入时仍然重新计算实际文件哈希并校验内容；路径必须是使用 `/` 的安全相对路径，不得包含绝对路径、`..`、反斜杠或空字节。

模型包 v1 对音色有强制约束：`voices` 位于模型包顶层，包内每个模型都必须支持完整的 `voices` 集合。manifest 不为单个模型声明不同的音色子集。如果两个模型的音色集合不同，必须拆分为两个模型包，以保持 Provider 配置和角色路由的简单性。

`parameters.load` 描述模型加载所需参数，`parameters.audio` 描述输出音频格式，`parameters.synthesis` 描述合成默认值。当前 Provider 层只选择模型包、模型和音色，不额外暴露参数覆盖；参数由对应的本地运行时和模型包解释。

`runtime.minimumAppVersion` 使用 SemVer 格式。导入模型包和加载已安装模型包时都必须与 Electron 应用当前版本比较，不能只校验字段类型。

### 模型文件去重

模型文件保存接口不提供类似 `deduplicate: true` 的特殊参数。模型包通过 `assets` 列表声明需要保存的文件，导入程序对每个列表项对应的文件计算 SHA-256，并将文件保存为 Blob 或链接到已有 Blob。相同内容的模型权重、tokenizer 或音色文件只保存一份。

本地存储可以采用以下布局：

```text
{userData}/models/tts/
├── blobs/sha256/<前两位>/<完整哈希>
└── packages/<packageId>/<packageVersion>/
    ├── manifest.json
    └── assets.json
```

安装记录中的 `assets.json` 保存模型包资产相对路径到 Blob 的映射：

```json
[
  {
    "path": "model/tts_b6369a24.safetensors",
    "kind": "model-weights",
    "size": 235738732,
    "sha256": "...",
    "blob": "sha256:..."
  }
]
```

导入某个资产时，如果 `blobs` 中已经存在相同哈希的文件，安装记录直接链接到已有 Blob；如果不存在，则以计算出的哈希作为内容地址写入新 Blob。该行为对所有资产默认生效，不由调用方选择是否去重。

删除模型包时，先记录该包资产列表引用的全部 Blob，再删除模型包安装记录，然后扫描其余所有已安装模型包的 `assets.json`。某个 Blob 如果仍被任意模型包引用，则保留；如果已经没有任何模型包引用，则从本地删除。该流程不依赖单独维护的引用计数，也不需要延迟到后续垃圾回收。

导入时的基本流程是：解析 manifest、校验安全路径、逐项读取 `assets`、校验文件大小、计算并校验 SHA-256、写入或复用 Blob，最后保存模型包 manifest 和资产到 Blob 的映射。模型包的包级指纹可以由规范化 manifest 和按路径排序的资产哈希清单计算，不依赖 ZIP 的压缩顺序或时间戳。

当前不实现签名，但应保留根目录 `signature.json` 的扩展位置。未来签名应覆盖规范化 manifest 和文件哈希清单，而不是直接签名 ZIP 二进制，以便同一内容重新压缩后仍能验证。

## Provider 选择

首次使用时会提供一个普通的 `manual` Provider：

```typescript
{
  id: 'manual',
  type: 'manual',
  name: '手动生成',
  models: []
}
```

AIRouter 不保存默认图像 Provider。调用界面从 Provider 列表中展示可选项，用户在每次生成时选择：`manual` Provider 直接作为一个选项，`openai-compatible` Provider 则按已启用模型展开。没有任何可用项时会补充默认手动 Provider。

`manual` Provider 由 renderer 的全局请求队列实现。任何页面通过该 Provider 发起图片生成后，应用根节点显示模态框：

- 展示只读提示词并通过 Electron 剪贴板通道复制。
- 从系统文件对话框导入 PNG、JPEG、GIF 或 WebP。
- 从系统剪贴板读取并编码为 PNG。
- 用户确认后把图片字节作为正常生成结果返回。
- 用户关闭、取消或调用方中止信号时，以 `AbortError` 结束当前请求。
- 同时发生多个请求时按发起顺序逐个展示。

## 设置界面

`设置 → AI 引擎 → 图像生成` 提供：

- `manual` 和 `openai-compatible` Provider 类型。
- API 图像 Provider 的 Base URL、API Key 和模型管理。
- `/models` 模型发现和手动模型 ID 添加。
- API Provider 的实际生成连接测试；该测试可能产生 Provider 费用。
- 手动 Provider 的测试生成按钮；通过全局弹窗导入测试图片并预览。

## Interface 集成

Interface 整套 AI 生成由用户分别选择文本模型和图像 Provider，先完成文本流和 JSON 校验，再按图片变量逐张调用所选图像 Provider。所有图片成功后，文本值、图片提示词和图片 assets 一次提交给仓储；失败或取消时不保存部分结果。

图片任务以无日志的扁平进度项展示。图片字段还提供图像 Provider 选择和单独的“生成图片”操作，结果进入 renderer 的待保存表单状态，用户保存题组后才写入 assets。独立的“AI 生图”侧栏会按字段顺序生成所有已有提示词的图片，全部成功后一次性覆盖并保存对应 assets；失败或取消时不提交部分结果。

## 验证覆盖

自动化测试覆盖独立配置和密钥、按 Provider 类型分派、两类文本协议的成功与失败流、调用时 Provider 选择、图片请求校验和二进制返回、IPC 取消、手动请求队列、模态框文件与剪贴板导入、手动测试生成、Interface 图片进度与原子资源保存。真实远端 Provider 的付费调用未纳入自动化测试。

## 代码依据

- `packages/airouter/src/main/image-service.ts`
- `packages/airouter/src/main/index.ts`
- `packages/airouter/src/shared/types.ts`
- `packages/airouter/src/renderer/index.ts`
- `packages/renderer/src/features/airouter/AIRouterImageSettingsPage.tsx`
- `packages/renderer/src/features/airouter/ManualImageGenerationDialog.tsx`
- `packages/interface-editor/src/application.ts`
- `packages/renderer/src/features/airouter/AIRouterSettingsPage.tsx`（语音合成入口当前为占位页面）
- `old/src/main/tts/tts-worker.ts`（旧版 Pocket TTS 运行时所需模型资源和参数）
