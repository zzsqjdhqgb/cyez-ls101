## 定位

AI 引擎模块是整个软件中所有 AI 能力的统一抽象层。上层业务（出卷、批改、语音识别等）不直接调用任何特定 AI 提供商的 API，而是通过引擎的统一接口完成任务。

## 一、模块结构

```
AI 引擎
├── LLM 推理模块
│   ├── 统一接口: prompt → text response
│   ├── 后端实现: OpenAI / Claude / 本地模型 / 其他 API
│   └── 管理: API Key、模型选择、参数配置
│
├── 图像生成模块
│   ├── 统一接口: prompt → image
│   ├── 后端实现: DALL·E / Stable Diffusion / Midjourney API / 其他
│   └── 管理: API Key、模型选择、参数配置
│
├── 语音识别模块（STT）
│   ├── 统一接口: audio → text
│   ├── 后端实现: Whisper API / 本地 ONNX 模型 / sherpa-onnx / 其他
│   └── 管理: API Key 或本地模型路径、参数配置
│
├── 语音评测模块（未来）
│   ├── 统一接口: audio + reference_text → score + feedback
│   ├── 后端实现: 待定
│   └── 管理: 待定

├── 语素识别模块（未来）
│   ├── 统一接口: audio → phoneme_sequence
│   ├── 后端实现: 待定
│   └── 管理: 待定
│
└── (未来新增模块按同样模式扩展)
```

## 二、设计原则

### 2.1 接口与实现分离

每个 AI 能力对外只暴露一个统一接口。接口参数和返回值是固定的——上层的出卷模块不需要知道底层是调 OpenAI 还是本地模型。

```
// 统一接口示例（概念层面，非具体代码）

LLM.infer({
  prompt: string,
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number
}) → { text: string }

ImageGen.generate({
  prompt: string,
  size?: { width: number, height: number },
  style?: string
}) → { image: Buffer, format: string }

STT.transcribe({
  audio: Buffer,
  format: string,       // wav / mp3 / ...
  sampleRate: number
}) → { text: string, confidence?: number }
```

### 2.2 后端可替换

每个模块内部预设若干后端实现。用户通过配置界面选择使用哪个后端，填入对应的 API Key 或本地模型路径。

```
LLM 模块
  ├── 后端: OpenAI
  │   配置: apiKey, baseUrl, model (gpt-4o / gpt-4o-mini / ...)
  ├── 后端: Anthropic
  │   配置: apiKey, model
  ├── 后端: 本地 Ollama
  │   配置: baseUrl, model
  └── 后端: 自定义兼容接口
      配置: apiKey, baseUrl, model
```

切换后端不影响上层的任何业务逻辑。

### 2.3 配置独立管理

各类 AI 配置集中管理，与业务数据分离：

- API Key 安全存储（不在试卷或模板中明文保存）
- 模型选择和参数在各模块内独立配置
- 支持"测试连接"——输入 prompt 后验证后端是否可用

## 三、上层调用关系

```
出卷（Interface）   →  LLM 推理  (生成试卷内容)
                    →  图像生成  (生成配图，可选)

批改（Schema）      →  LLM 推理  (AI 预评分)
                    →  语音识别  (STT 转写学生录音)

语音评测（未来）    →  语音评测  (发音准确度)
                    →  语素识别  (定位发音错误)
```

每个业务模块只依赖 AI 引擎的统一接口，不依赖具体后端。

## 四、引擎配置界面

用户在软件的设置页面中管理 AI 引擎：

```
设置 → AI 引擎
  ├── LLM
  │   ├── 后端选择: [OpenAI ▼]
  │   ├── API Key: [****]
  │   ├── 模型: [gpt-4o-mini ▼]
  │   ├── Base URL: https://api.openai.com/v1
  │   └── [测试连接]
  │
  ├── 语音识别
  │   ├── 后端选择: [本地 sherpa-onnx ▼]
  │   └── 模型路径: ...
  │
  ├── 图像生成（可选）
  │   ├── 后端选择: [无 ▼]
  │   └── ...
  │
  └── (未来模块按需出现)
```

各后端如果不需要（比如教师只用 AI 出卷，不需要语音识别），可以设为"无"或"暂不使用"，相关功能自动隐藏。
