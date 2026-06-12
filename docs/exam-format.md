<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 试卷格式规范

## 文件位置与名称

试卷文件必须命名为 `exam.json`，与 `media/` 目录一起放置在考试包内。

**考试包结构（ZIP 或目录）：**

```
考试包.zip
├── exam.json
└── media/
    ├── audio1.mp3
    ├── image1.png
    └── ...
```

导入后存储在 `{userData}/exams/{eid}/` 目录下（EID 为 `title` + `questions` 的 SHA-256 哈希）。加载时将 `media/` 下的文件通过 `exam-resource://{eid}/` 协议提供给渲染进程。

## 类型定义

```typescript
// src/shared/types/exam.ts

type ContentNode =
  | { type: 'text'; text: string; bold?: boolean; size?: 'small' | 'normal' | 'large' }
  | { type: 'image'; src: string; width?: string; height?: string }
  | { type: 'video'; src: string }
  | { type: 'audio'; src: string; text: string }
  | { type: 'quad-image'; images: [string, string, string, string]; width?: string }

type TimeControl =
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex?: number }
  | { type: 'content-controlled' }

interface Question {
  id: string
  content: ContentNode[]
  time: TimeControl
  statusText?: string
}

interface GradingInfoItem {
  id: number
  recordIndex: number
  problemInfo: string
  gradingInfo: string
  fullScore: number
}

interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
}
```

## 整体结构

```json
{
  "title": "考试标题",
  "questions": [ /* Question[] */ ],
  "gradingInfo": [ /* GradingInfoItem[]，可选 */ ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 整个试卷的标题 |
| `questions` | Question[] | 是 | 题目列表，按顺序播放（索引从 0 开始），至少包含一个题目 |
| `gradingInfo` | GradingInfoItem[] | 否 | 批改评分项定义，仅在需要批改功能的试卷中添加 |

---

## 题目对象 (Question)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 题目唯一标识 |
| `content` | ContentNode[] | 是 | 内容节点数组，按顺序从上到下渲染，至少包含一个节点 |
| `time` | TimeControl | 是 | 时间控制对象，决定答题流程的推进方式 |
| `statusText` | string | 否 | 自定义状态栏显示文本 |

---

## 内容节点 (ContentNode)

内容节点描述了题目显示区域中的视觉元素，由 `type` 字段指定。支持五种类型：

### 1. 文本节点 (`type: "text"`)

```json
{ "type": "text", "text": "你好", "size": "large", "bold": true }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"text"` | 是 | |
| `text` | string | 是 | 显示的文本内容 |
| `size` | `"small"` \| `"normal"` \| `"large"` | 否 | 默认 `"normal"` |
| `bold` | boolean | 否 | 默认 `false` |

### 2. 图片节点 (`type: "image"`)

```json
{ "type": "image", "src": "media/pic.png", "width": "80%", "height": "auto" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"image"` | 是 | |
| `src` | string | 是 | 相对于考试包根目录的图片路径 |
| `width` | string | 否 | 默认 `"80%"` |
| `height` | string | 否 | 未设置时自动保持比例 |

### 3. 视频节点 (`type: "video"`)

```json
{ "type": "video", "src": "media/video.mp4" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"video"` | 是 | |
| `src` | string | 是 | 相对于考试包根目录的视频文件路径 |

### 4. 音频节点 (`type: "audio"`)

```json
{ "type": "audio", "src": "media/audio.mp3", "text": "音频对应的文本内容" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"audio"` | 是 | |
| `src` | string | 是 | 相对于考试包根目录的音频文件路径 |
| `text` | string | 是 | 音频对应的文本内容（用于存档参考和模板导出时的 TTS 合成） |

考试播放时，音频节点仅播放音频，不显示 `text` 内容。

### 5. 四宫格图片 (`type: "quad-image"`)

```json
{
  "type": "quad-image",
  "images": ["media/img1.png", "media/img2.png", "media/img3.png", "media/img4.png"],
  "width": "90%"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"quad-image"` | 是 | |
| `images` | [string, string, string, string] | 是 | 必须长度为 4，按左上、右上、左下、右下顺序排列 |
| `width` | string | 否 | 默认 `"80%"` |

---

## 时间控制 (TimeControl)

`time` 对象决定题目如何计时、何时自动进入下一题。`type` 共有三种：

### 1. 倒计时 (`type: "countdown"`)

```json
"time": { "type": "countdown", "seconds": 10 }
```

- `seconds`：必填，正数，指定倒计时秒数。计时归零后自动进入下一题。
- 内容中**可以**包含视频或音频节点（用于播放引导音频等场景）。

### 2. 录音 (`type: "record"`)

```json
"time": { "type": "record", "duration": 20, "recordIndex": 1 }
```

- `duration`：必填，录音最长时长（秒）。超过此时长录音自动停止并切题。
- `recordIndex`：可选，用于区分不同录音文件（保存为 `<recordIndex>.mp3`）。

### 3. 内容控制 (`type: "content-controlled"`)

```json
"time": { "type": "content-controlled" }
```

- 题目推进由内部媒体（视频或音频）播放完成自动触发。
- **必须且只能**在内容中包含一个视频节点或一个音频节点（二者选一）。

---

## 批改评分项 (GradingInfoItem)

```json
{
  "id": 0,
  "recordIndex": 1,
  "problemInfo": "## 题目\n请朗读以下句子……",
  "gradingInfo": "## 评分标准\n- 发音准确 (5分)\n- 语调自然 (5分)",
  "fullScore": 10
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | number | 是 | 评分项 ID，从 0 开始严格递增 |
| `recordIndex` | number | 是 | 关联的录音索引，必须匹配某个 `record` 题目的 `recordIndex` |
| `problemInfo` | string | 是 | 题目信息，Markdown 格式，显示在批改界面左侧 |
| `gradingInfo` | string | 是 | 评分标准，Markdown 格式，显示在批改界面可折叠区域 |
| `fullScore` | number | 是 | 满分值，必须为正数 |

---

## 合法性验证

`validateExamPackage(pkg)` 定义在 `src/shared/validation.ts:16-213`。返回 `ValidationError[]`，空数组表示合法。

### 结构化验证规则

1. 根对象必须包含 `questions` 数组，且为非空。
2. 每个题目必须有 `id`（字符串）、`content`（非空数组）、`time`（对象）。
3. 内容节点的 `type` 必须为 `"text"` | `"image"` | `"video"` | `"audio"` | `"quad-image"` 之一。
4. 各类型节点的必填字段：
   - `text` 节点：`text` 必须为字符串
   - `image` 节点：`src` 必须为字符串
   - `video` 节点：`src` 必须为字符串
   - `audio` 节点：`src` 和 `text` 都必须为字符串
   - `quad-image` 节点：`images` 必须为长度为 4 的数组
5. `time.type` 必须为 `"countdown"` | `"record"` | `"content-controlled"` 之一。
6. `countdown` 必须包含 `seconds`（数字），`record` 必须包含 `duration`（数字）。
7. `content-controlled` 下必须且只能有一个 video 或 audio 节点。
8. `gradingInfo` 若存在：
   - 必须是数组
   - `id` 从 0 开始严格递增
   - `recordIndex` 必须匹配考试中某个 `record` 题目的 `recordIndex`，且不重复
   - `problemInfo` 和 `gradingInfo` 必须为字符串
   - `fullScore` 必须为正数
   - 覆盖的 `recordIndex` 数量必须等于考试中所有定义了 `recordIndex` 的题目数量

### 资源存在性验证

通过结构化验证后，`validateExamResources()`（`src/main/utils.ts:69-98`）检查每个 `src` 和 `images` 路径：
1. 路径安全验证（`isSafeMediaPath()`）：路径必须在 `media/` 目录内，防止路径遍历攻击
2. 文件存在性检查：文件必须真实存在于考试包目录下

## 完整示例

```json
{
  "title": "模拟口语考试",
  "questions": [
    {
      "id": "1",
      "content": [
        { "type": "text", "text": "请描述图片", "size": "large" },
        { "type": "image", "src": "media/image1.png", "width": "80%" }
      ],
      "time": { "type": "countdown", "seconds": 5 },
      "statusText": "观察图片中..."
    },
    {
      "id": "2",
      "content": [
        { "type": "text", "text": "听录音回答问题", "bold": true },
        { "type": "audio", "src": "media/audio1.mp3", "text": "What is your favorite color?" }
      ],
      "time": { "type": "content-controlled" },
      "statusText": "正在播放音频"
    },
    {
      "id": "3",
      "content": [
        { "type": "text", "text": "请作答" },
        { "type": "image", "src": "media/image1.png", "width": "50%" }
      ],
      "time": { "type": "record", "duration": 20, "recordIndex": 1 },
      "statusText": "正在录音"
    },
    {
      "id": "4",
      "content": [
        { "type": "text", "text": "观看视频并回答" },
        { "type": "video", "src": "media/video1.mp4" }
      ],
      "time": { "type": "content-controlled" },
      "statusText": "观看视频中"
    }
  ],
  "gradingInfo": [
    {
      "id": 0,
      "recordIndex": 1,
      "problemInfo": "## 题目 3\n请根据图片内容进行描述。",
      "gradingInfo": "## 评分标准\n- 内容完整性 (5分)\n- 语言准确性 (5分)\n- 流利度 (5分)",
      "fullScore": 15
    }
  ]
}
```

## 测试覆盖

`src/shared/__tests__/validation.test.ts` 包含 33 个测试用例，覆盖：
- 空值/非对象输入
- 缺少 questions 数组
- 每种内容节点类型的必填字段验证
- 无效 type、缺少 id、缺少 content、缺少 time
- 无效 time type、缺少 seconds/duration
- content-controlled 媒体节点计数（0、1、多个）
- gradingInfo 完整验证（id 递增、recordIndex 匹配、去重、字符串字段、fullScore 正数、覆盖完整）
