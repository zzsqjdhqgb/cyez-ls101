<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 试卷模板格式规范

试卷模板是一套用于生成"试卷草稿"的蓝图，用户基于模板填写文本、选择文件后即可导出一份符合标准规范、资源完整的考试包（`exam.json` + `media/`）。

## 文件位置与名称

模板存储为 ZIP 压缩包，其内部根目录必须包含 `template.json` 文件，并可包含 `media` 文件夹用于存放固定媒体资源。

```
模板.zip
├── template.json
└── media/
    ├── fixed_audio.wav
    └── ...
```

## 类型定义

```typescript
// src/shared/types/template.ts

interface EditableDataItem {
  type: 'text' | 'file'
  id: string
  description: string
  fileName?: string   // 仅 file 类型需要
}

interface ExamTemplate {
  examData: Record<string, unknown>    // 题目数据，含占位符
  editableData: EditableDataItem[]     // 可编辑数据项列表
}

interface TemplateListItem {
  id: string
  title: string
  description?: string
  createdAt: string
}
```

## 整体结构

```json
{
  "examData": { ... },
  "editableData": [ ... ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `examData` | object | 是 | 题目数据，结构类似最终试卷的 `exam.json`，但允许包含占位符 |
| `editableData` | array | 是 | 可编辑数据项列表，定义用户需要填写或上传的内容 |

---

## 1. `examData` — 题目数据

`examData` 对象的结构与标准试卷文件（`exam.json`）一致，包含 `title` 和 `questions`，但允许在字符串值中使用**占位符**（格式 `{{id}}`）。`examData` 中也可以包含 `gradingInfo` 评分项定义。

**示例：**

```json
{
  "examData": {
    "title": "朗读句子练习",
    "questions": [
      {
        "id": "1",
        "content": [
          { "type": "text", "text": "请朗读以下句子", "size": "large", "bold": true },
          { "type": "text", "text": "{{sentence_1}}", "size": "small" }
        ],
        "time": { "type": "countdown", "seconds": 3 },
        "statusText": "准备中"
      },
      {
        "id": "2",
        "content": [{ "type": "text", "text": "{{sentence_1}}", "size": "small" }],
        "time": { "type": "record", "duration": 5, "recordIndex": 2 },
        "statusText": "录音中"
      }
    ]
  },
  "editableData": [
    { "type": "text", "id": "sentence_1", "description": "第一句话" },
    { "type": "text", "id": "sentence_2", "description": "第二句话" }
  ]
}
```

**关键规定：**

- 所有占位符只能出现在字符串类型的值中（如 `text`、`statusText`、`problemInfo`、`gradingInfo` 等字段）。
- 数字类型的值（如 `seconds`、`duration`）不能包含占位符，必须由模板预先确定。
- 占位符可以重复使用，同一个 `id` 可以出现在多个地方。
- `gradingInfo` 中的 `problemInfo` 和 `gradingInfo` 字段也可以使用占位符。

### `audio` 节点特殊规定

在模板的 `examData` 中，所有 `audio` 类型的节点**必须**包含 `text` 属性，且 `src` 不能为空：

```json
{
  "type": "audio",
  "src": "media/instruction_audio.wav",
  "text": "{{instruction_text}}"
}
```

- `text` 字段为音频对应的完整文本（可包含占位符），用于导出时调用 TTS 合成音频。
- `src` 在模板中可以指向 `media/` 目录中不存在的文件（由 TTS 动态合成），但 `src` 本身不能为空字符串。
- 如果 `src` 指向的文件已存在于构建目录中，导出时跳过合成直接使用。

---

## 2. `editableData` — 可编辑数据项

支持两种类型：`text`（文本输入）和 `file`（文件选择）。

### 文本类型 (`type: "text"`)

```json
{ "type": "text", "id": "sentence_1", "description": "第一句话" }
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"text"` | 是 | |
| `id` | string | 是 | 唯一标识符，用于在 `examData` 中作为占位符引用 |
| `description` | string | 是 | 显示在输入框上方的提示文字 |

### 文件类型 (`type: "file"`)

```json
{
  "type": "file",
  "id": "picture_file",
  "description": "选择图片",
  "fileName": "media/picture.png"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | `"file"` | 是 | |
| `id` | string | 是 | 唯一标识符 |
| `description` | string | 是 | 显示在文件选择按钮上方的提示文字 |
| `fileName` | string | 是 | 导出时该文件应被放置到的相对路径（通常以 `media/` 开头） |

---

## 模板合法性验证

`template-service.ts` 中的 `validateTemplate()` 函数在导入模板或创建草稿时执行以下检查：

### 1. ID 与文件名唯一性

- 所有 `editableData` 项的 `id` 必须互不相同。
- 所有文件类型的 `fileName` 以及 `media` 目录中已存在的文件名不能有重复。

### 2. 占位符完整性

- 深度遍历 `examData` 中所有字符串值，提取所有占位符（`{{...}}`）。
- 所有被引用的占位符必须在 `editableData` 中存在对应的 `id`。
- `editableData` 中定义的每一个 `id` 必须至少被一个占位符引用。

### 3. `audio` 节点特殊验证

- 所有 `audio` 类型节点必须包含非空的 `text` 字符串。
- 所有 `audio` 类型节点必须包含非空的 `src` 字符串。

### 4. 文件引用完整性

- 遍历 `examData` 中所有 `src`、`images` 等路径属性（排除 `audio` 节点的 `src`，因其可能由 TTS 合成生成）。
- 所有被引用的文件路径必须存在于 `editableData` 的 `fileName` 或 `media` 目录中。
- `media` 中已有文件 + editableData 中 file 类型的 `fileName` 中的每个路径都必须被 `examData` 中的某处引用（`audio` 的 `src` 除外）。

---

## 模板创建草稿与导出流程

1. **创建草稿**：用户选择一个通过验证的模板，系统复制 `template.json` 和 `media` 目录到草稿文件夹，初始化空白的文本值/文件值映射。
2. **编辑草稿**：界面展示 `editableData` 的内容：
   - 文本类型：带 `description` 标签的输入框
   - 文件类型：文件选择按钮（支持剪贴板图片粘贴 `uploadClipboardImage`）
   - 支持编辑草稿标题（不影响 `examData.title` 原始值）
3. **导出试卷**（`draft-service.ts`）：
   - 验证所有文本项已填写、所有文件项已选择
   - 在临时目录构建最终试卷：
     - 复制 `media` 固定文件
     - 用户上传文件复制到 `fileName` 指定路径
     - 替换所有 `{{占位符}}`
     - 设置标题为草稿自定义标题或模板默认标题
     - 对每个 `audio` 节点：若 `src` 指向的文件不存在则调用 TTS 合成
   - 打包为 ZIP 并提示保存位置
   - 通过 `draft:exportExam-progress` 事件推送进度

### 草稿的导入/导出

- **导出草稿**（`draft:exportDraft`）：打包 `template.json` + `draftState.json` + `media/` + `uploads/` 为 ZIP
- **导入草稿**（`draft:import`）：解压 ZIP，验证必要文件，复制到 `drafts/` 并分配新 UUID

---

## TTS 合成说明

草稿导出时的 TTS 合成使用内置 Pocket TTS 引擎（离线运行）：
- 当 `audio` 节点的 `src` 指向的文件不存在于构建目录中时，自动根据 `text` 字段合成音频。
- 合成后输出为 WAV 格式（24000 Hz, PCM 16-bit, 单声道）。
- 详细参数和架构见 [tts-engine.md](./tts-engine.md)。

---

## 测试覆盖

`src/main/services/__tests__/template-service.test.ts` 包含 14 个测试用例，覆盖模板验证逻辑的边界情况。`src/shared/__tests__/validation.test.ts` (33 tests) 中的 gradingInfo 验证也间接验证了模板中 gradingInfo 的正确性。
