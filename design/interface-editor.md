# Interface 编辑器 — 核心设计（定稿）

## 一、定位

Interface 是一个**带字段映射契约的 AI 生成器**。

在 Template 编辑器之外，教师打开 Interface 编辑器，定义一套字段结构和提示词，调用 AI 生成结构化数据。生成的每个字段值就是一个变量——在 Template 中通过 [@varName] 引用。

## 二、数据结构

### 2.1 Interface 定义

```typescript
interface InterfaceDef {
  id: string
  name: string
  description: string
  promptTemplate: string        // 发送给 LLM 的提示词
  fields: FieldNode             // 字段结构（嵌套对象树）
}

// FieldNode 可以是一组子字段（object），也可以是叶子字段
type FieldNode = FieldGroup | FieldLeaf

interface FieldGroup {
  type: "group"                 // 容器，包含子字段
  children: Record<string, FieldNode>
}
```

### 2.2 叶子字段

```typescript
interface FieldLeaf {
  type: "text" | "image"

  // 以下三项由教师填写

  varName: string               // 变量名，在 Template 中以 [@varName] 引用
  description: string           // 字段描述，告知 AI 此字段的含义，如"第二题题干"
  example: string               // 示例值，辅助 AI 理解输出格式
}
```

### 2.3 样例

一个"上海高考口语" Interface 的字段结构：

```json
{
  "promptTemplate": "请生成一套上海高考英语口语模拟试卷，难度中等，话题围绕校园生活。",
  "fields": {
    "sectionA": {
      "type": "group",
      "children": {
        "sentences": {
          "type": "group",
          "children": {
            "s1": {
              "type": "text",
              "varName": "sentenceA1",
              "description": "朗读句子第一题题干",
              "example": "Good morning, everyone. Welcome to our school."
            },
            "s2": {
              "type": "text",
              "varName": "sentenceA2",
              "description": "朗读句子第二题题干",
              "example": "I believe that practice makes perfect."
            }
          }
        }
      }
    },
    "sectionB": {
      "type": "group",
      "children": {
        "picture": {
          "type": "image",
          "varName": "sectionBImage",
          "description": "看图说话题目配图",
          "example": "A family having dinner together in a cozy restaurant"
        },
        "hint": {
          "type": "text",
          "varName": "sectionBHint",
          "description": "看图说话关键词提示",
          "example": "family, dinner, restaurant, happy"
        }
      }
    }
  }
}
```

## 三、编辑器界面

分上下两区。

### 3.1 上半区：提示词编辑

大文本框，编辑 `promptTemplate`。支持基本 Markdown 格式。

### 3.2 下半区：字段树编辑

**树状视图**，类似文件管理器：

```
▼ sectionA
  ▼ sentences
    ├ [text] sentenceA1     "朗读句子第一题题干"
    ├ [text] sentenceA2     "朗读句子第二题题干"
    └ [+]
▼ sectionB
  ├ [image] sectionBImage   "看图说话题目配图"
  ├ [text] sectionBHint     "看图说话关键词提示"
  └ [+]
[+ 添加顶层字段]
```

每个 group 节点可折叠。点击节点在右侧展开编辑面板，或直接在树内 inline 编辑。

### 3.3 叶子字段编辑面板

点击叶子字段后显示四个属性的编辑表单：

```
类型:     [text ▼]          ← text / image 切换

变量名:   [sentenceA1____]  ← 用于 Template 中的 [@sentenceA1]

描述:     [朗读句子第一题题干_______________________]
          （告知 AI 此字段的内容含义）

示例:     [Good morning, everyone. Welcome to our school.]
          （辅助 AI 理解输出格式）
```

## 四、AI 生成流程

### 4.1 提交给 LLM

系统将 `promptTemplate` + 字段结构的 JSON 描述一同发给 LLM：

```json
{
  "prompt": "请生成一套上海高考英语口语模拟试卷...",
  "fields": {
    "sectionA": {
      "sentences": {
        "s1": { "type": "text", "description": "朗读句子第一题题干", "example": "..." },
        "s2": { "type": "text", "description": "朗读句子第二题题干", "example": "..." }
      }
    },
    "sectionB": {
      "picture": { "type": "image", "description": "看图说话题目配图", "example": "..." },
      "hint": { "type": "text", "description": "看图说话关键词提示", "example": "..." }
    }
  }
}
```

字段的 `varName` 不发给 LLM——它只用于 Template 端的变量绑定。LLM 看到的只有 `type`、`description`、`example`。

### 4.2 LLM 返回

LLM 返回的 JSON 与字段结构一致，但叶子节点填充了实际值：

```json
{
  "sectionA": {
    "sentences": {
      "s1": "The importance of education cannot be overstated.",
      "s2": "Technology has changed the way we communicate."
    }
  },
  "sectionB": {
    "picture": "A classroom full of students working on a group project, laptops open, teacher walking around helping",
    "hint": "classroom, students, project, teacher, collaboration"
  }
}
```

### 4.3 图片字段的二次生成

对于 `type: "image"` 的字段，LLM 返回的不是图片而是一个**图片生成提示词**。系统将此提示词发送给生图 AI（如 DALL-E / Stable Diffusion），产出实际图片。

### 4.4 生成结果为 Interface 实例

生成完成后，结果存储为 Interface 实例——`varName → value` 的映射：

```json
{
  "instanceId": "550e8400-e29b-41d4-a716-446655440000",
  "interfaceId": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "generatedAt": "2026-07-24T10:30:00Z",
  "values": {
    "sentenceA1": "The importance of education cannot be overstated.",
    "sentenceA2": "Technology has changed the way we communicate.",
    "sectionBImage": "https://...",           // 已生成的图片 URL
    "sectionBHint": "classroom, students, project, teacher, collaboration"
  }
}
```

## 五、实例管理

每个 Interface 可多次调用 AI，生成多套实例：

```
上海高考口语 Interface
  ├ 实例 A（难度: 中等, 话题: 校园）  2026-07-24
  ├ 实例 B（难度: 困难, 话题: 科技）  2026-07-23
  └ 实例 C（难度: 简单, 话题: 日常）  2026-07-22
```

教师可以预览每个实例的值（包括生成的图片）、删除不满意的实例、或基于已有实例重新生成。

Interface 实例使用实体身份：每次独立生成、复制、基于已有实例重新生成或修改后另存时，系统生成新的 UUID v4 `instanceId`。两个实例即使字段值和图片内容完全相同，只要 `instanceId` 不同，就视为两个不同实例。Instance 不参与 Interface 内容 ID 的计算，实例列表变化不会改变 `InterfaceDef.id`。

导入原实例或恢复备份时保留原 `instanceId`。重复导入同 `instanceId`、同内容的实例时跳过；同 `instanceId`、不同内容属于数据冲突，拒绝导入。实例的 `interfaceId` 必须与所属 Interface 的内容 ID 一致。

## 六、Interface 导入导出

Interface 定义——包含名称、描述、`promptTemplate` 和有序 `fields` 结构——可导出为文件，供其他教师导入使用。Interface 使用规范化内容的 SHA-256 作为 ID，因此相同内容在不同设备上具有相同 ID；实例不参与该哈希。

导出时 Interface 定义始终包含，教师可以选择：

- 仅导出 Interface
- 导出 Interface 和选中的实例
- 导出 Interface 和全部实例

导入时可以再次选择不导入实例、导入选中实例或导入全部附带实例。不支持脱离 Interface 单独导出实例。实例中的本地图片等资源必须随实例一起打包。

导入时系统必须重新计算并校验 Interface 内容 ID。本地已有同 ID、同内容时复用已有 Interface；同 ID、不同内容视为哈希冲突或数据篡改，拒绝导入。不同 `instanceId` 的实例即使内容相同也全部保留，不按内容去重。

交换文件使用 `.lsinterface` 扩展名，内容为 ZIP。渲染进程使用 `fflate` 将业务交换包编码/解码为 `Uint8Array`，再通过 `@ls101/file-dialog` 的 `readBinary()` 和 `writeBinary()` 调用系统文件对话框。ZIP 固定结构如下：

```text
manifest.json
interface.json
instances/
└── <instanceId>/
    ├── instance.json
    └── assets/
        └── <instance assets>
```

解包时必须拒绝未知路径、路径穿越、重复文件、缺失文件、非法 UTF-8/JSON、资源清单不一致及超过文件数或解压大小限制的文件。`file-dialog` 只负责用户文件的二进制读写，不解析 ZIP 或 Interface 业务内容。

## 七、生成失败处理

- LLM 返回格式不符合字段结构 → 提示"AI 返回格式异常"，展示原始返回内容，教师可手动修正或重新生成
- 图片生成超时/失败 → 图片字段为空，标记为"生成失败"，教师可单独重新生成该图片
- Token 超限 → 提示优化 prompt 或减少字段数
