# Interface / Template / Schema 数据接口规范（定稿）

<!-- 审核进度：已审至 ## 五、Schema 定义（含），之前全部已定稿。 -->
<!-- 关键变更：Schema 导出变量名列表（对称于 Interface→Template），Template 展开时填固定值 + 留作答槽位。 -->
<!-- 已知未完善：选择题的处理方式尚未最终确定，当前为临时方案。 -->

本文定义三个模块之间的数据契约。不涉及内部实现。

---

## 一、总览

```
Interface                    Template                   Schema
    │                            │                         │
    │  变量名列表（varNames）      │                         │  变量名列表（fieldNames）
    ▼                            ▼                         ▼
InterfaceVarManifest ────→ Template 编辑器          SchemaFieldManifest
    │                                                        │
    │  AI 生成                                               │
    ▼                                                        │
InterfaceInstance ──────→ Section 引擎展开                    │
 (values)                   │                                │
                            │  按 Schema fieldNames 填充       │
                            ▼                                ▼
                        ExamPackage ◄────────────────  Schema 定义
                            │                         (fieldNames + 评分结构)
                            ▼
                        ExamPlayer
                            │
                            ▼
                      SubmissionPackage
```

对称关系：**Interface 导出 varNames → Template 填充 → ExamPackage**，完全对应于 **Schema 导出 fieldNames → Template 填充 + ExamPlayer 采集 → SubmissionPackage**。Schema 内部的评分流程不在本文档范围内。

---

## 二、Interface 定义（未实例化）

Interface 定义在 AI 生成之前的状态。Template 编辑器读取此格式来构建变量选择器。

```typescript
interface InterfaceDef {
  id: string // sha256:<64位十六进制摘要>，由规范化内容确定
  name: string
  description: string
  promptTemplate: string
  fields: FieldCollection
}

interface FieldCollection {
  order: string[] // 唯一的字段顺序来源
  nodes: Record<string, FieldNode>
}

interface FieldGroup {
  type: 'group'
  children: FieldCollection
}

// Template 编辑器关心的平铺视图：
interface InterfaceVarManifest {
  interfaceId: string
  interfaceName: string
  vars: InterfaceVarInfo[]
}

interface InterfaceVarInfo {
  varName: string // Template 中以 [@varName] 引用
  type: 'text' | 'image'
  description: string
  example: string
  path: string // 字段路径，如 "sectionA.sentences.s1"
}
```

---

## 二之二、Interface 实例（已实例化）

```typescript
interface InterfaceInstance {
  instanceId: string // UUID v4，一次独立创建对应一个实体 ID
  generatedAt: string
  values: Record<string, string> // varName → 值
}
```

`InterfaceDef.id` 是内容身份：相同的规范化 Interface 内容具有相同 ID。哈希输入包含 `name`、`description`、`promptTemplate` 和有序字段树，不包含实例。每层 `order` 必须与 `nodes` 的 key 集合完全一致，字段顺序不依赖 JSON 对象属性顺序。

`InterfaceInstance.instanceId` 是实体身份：两个实例即使 `values` 完全相同，只要 UUID 不同，就视为两个不同实例。实例本体不保存 `interfaceId`，所属 Interface 由仓储目录确定。新增、删除或导入实例不会改变 `InterfaceDef.id`。导入原实例、恢复备份或迁移内置版本时保留 UUID；同 UUID、不同内容必须作为冲突拒绝。

---

## 三、Schema 定义

### 3.1 SchemaDef

```typescript
interface SchemaDef {
  id: string
  name: string
  // 提交信息变量列表（对标 Interface 的 vars，这是 Schema 对其他模块的唯一契约）
  fields: SchemaFieldDef[]
}

// 提交信息字段定义（Schema 导出的变量列表）
type SchemaFieldDef =
  | { varName: string; type: 'text' }
  | { varName: string; type: 'audio'; recordIndex: number }
  | { varName: string; type: 'choice'; choiceIndex: number }
```

Schema 内部的评分结构、维度、合并方式等由 schema-editor 设计文档定义，本文档不涉及。

### 3.2 Schema 的变量导出（对标 Interface 的 varManifest）

```typescript
interface SchemaFieldManifest {
  schemaId: string
  schemaName: string
  fields: SchemaFieldDef[]
}
```

`SchemaFieldManifest` 是 Schema 对 Template 和 ExamPlayer 的契约：Template 展开 ExamPackage 时按此列表填充固定值，ExamPlayer 按此列表采集作答数据。

---

## 四、Template → ExamPackage

Section 引擎展开模板树时，除了生成页面数据外，还根据 Schema 的 `fields` 生成三个数据段：

```typescript
interface ExamPackage {
  title: string
  schemaId?: string
  pages: ExamPage[]

  // —— 以下三个数据段由 Section 引擎根据 Schema.fields 生成 ——

  // 录音题号索引（告诉 ExamPlayer 哪些序号需要录音）
  recordingIndices: number[]

  // 选择题号索引（告诉 ExamPlayer 哪些序号需要选择交互）
  choiceIndices: number[]

  // Schema 字段值列表（与 Schema.fields 一一对应）
  schemaFields: SchemaFieldValue[]
}

type SchemaFieldValue =
  | { varName: string; type: 'text'; value: string } // 固定文本，展开时已确定
  | { varName: string; type: 'audio'; recordIndex: number } // 录音槽位，题号引用
  | { varName: string; type: 'choice'; choiceIndex: number } // 选择题槽位，题号引用

interface ExamPage {
  id: string
  sectionTypeRef: string
  layout: ResolvedLayoutBlock[]
  timeline: ResolvedTimelineStep[]
}

type ResolvedTimelineStep =
  | { type: 'play'; src: string; statusText?: string }
  | { type: 'countdown'; seconds: number; statusText?: string }
  | { type: 'record'; duration: number; recordIndex: number; statusText?: string }

// （ResolvedLayoutBlock 等详见 template-editor.md）
```

### 4.1 生成规则

Section 引擎展开时：

1. 遍历所有 Section 的 timeline，对每个 `record` 步骤分配全局唯一的 `recordIndex`（从 0 递增）
2. 遍历所有 Section 的 params，对含选择题 params（optionA/B/C/D + answer）的 Section 分配全局唯一的 `choiceIndex`（从 0 递增）
3. 收集 `recordingIndices` 和 `choiceIndices`
4. 遍历 `Schema.fields`，生成 `schemaFields`：
   - `type=text`：value 直接从 Section 的 layout 中提取渲染文本
   - `type=audio`：记录对应的 `recordIndex`
   - `type=choice`：记录对应的 `choiceIndex`
5. `schemaFields` 与 `Schema.fields` 顺序一致、一一对应

---

## 五、ExamPlayer → SubmissionPackage

### 5.1 作答包结构

```typescript
// 作答包是 ZIP 文件，内含以下文件：
//
//   submission.json     — 元数据
//   schemaFields.json   — 从 ExamPackage 原样传递
//   choice.json          — 所有选择题答案 {"0": "A", "1": "B", ...}
//   0.mp3                — 录音（按 recordingIndices 编号）
//   1.mp3
//   ...
```

### 5.2 submission.json

```typescript
interface SubmissionMeta {
  student: StudentInfo
  schemaId: string
  submittedAt: string
}

interface StudentInfo {
  name: string
  studentId: string
}
```

### 5.3 schemaFields.json

从 ExamPackage 中的 `schemaFields` **原样复制、不做任何修改**。ExamPlayer 不解析、不篡改。

### 5.4 choice.json

```typescript
// Record<choiceIndex, selectedOption>
// 如 { "0": "A", "1": "C" }
```

ExamPlayer 根据 `choiceIndices` 在每个选择题的交互阶段收集学生选择，考试结束后统一写入 `choice.json`。

### 5.5 录音文件

ExamPlayer 根据 `recordingIndices` 依次启动录音，录音结束后以 `{recordIndex}.mp3` 文件名存入作答包。

---

## 六、全链路数据流

```
1. 教师创建 Interface 定义 → InterfaceDef
2. 教师创建 Schema 定义 → SchemaDef（含 fields 变量列表）

3. 教师编辑 Template
   → 导入 InterfaceVarManifest（变量选择器可用）
   → 导入 SchemaFieldManifest（知晓提交需要哪些字段）
   → 组装 Section 树（layout + timeline）
   → 关联 Schema

4. 教师调用 AI 生成 Interface 实例 → InterfaceInstance

5. Template 绑定 Interface 实例 → [@varName] 解析

6. Section 引擎展开
   → 遍历树 → 解析变量 → 分配 recordIndex / choiceIndex
   → 按 Schema.fields 生成 schemaFields
   → ExamPackage { pages, schemaId, recordingIndices, choiceIndices, schemaFields }

7. ExamPlayer 播放
   → 按 recordingIndices 录音 → 存为 {n}.mp3
   → 按 choiceIndices 收选择 → 存为 choice.json
   → schemaFields.json 原样传递
   → 打包 ZIP → SubmissionPackage

8. 评分
   → 解压 SubmissionPackage
   → 按 Schema 的评分结构（本文档不涉及）打分 → 成绩结果
```
