# Interface / Template / Schema 数据接口规范（定稿）

<!-- 本文只定义跨模块契约，不涉及内部实现。 -->
<!-- 选择题在 Player 数据段中的最终交互和导出方式尚未定稿，本文只保留扩展位置，不提前确定产品行为。 -->

本文定义 Interface、Template 和 Schema 之间的数据契约。

## 一、总览

~~~text
Interface                         Template                         Schema
    │                                │                               │
    │ InterfaceVarManifest           │ DSL + 变量表达式              │ SchemaBlockManifest
    ▼                                │                               │
InterfaceDef ────────────────→ TemplateContent ←──────────────── SchemaDef
    │                                │
    │ 多个 InterfaceInstance         │ 导出时选择各 Interface 的实例
    ▼                                ▼
InterfaceInstance ─────────────→ ExamPackage
                                      ├── Player 数据段
                                      └── Schema 映射段
~~~

Interface 负责提供可生成的数据变量；Template 负责定义试卷 DSL、参数来源和播放结构；Schema 负责提供可复用的评分块以及每个评分块需要的变量。

Template 不保存 InterfaceInstance。Template 只保存 Interface 的身份和内部别名；预览或正式导出时，才为每个别名选择一个实例。

## 二、Interface 定义与实例

### 2.1 InterfaceDef

~~~typescript
interface InterfaceDef {
  id: string // sha256:<64 位十六进制摘要>
  name: string
  description: string
  promptTemplate: string
  fields: FieldCollection
}

interface FieldCollection {
  order: string[]
  nodes: Record<string, FieldNode>
}

interface FieldGroup {
  type: 'group'
  children: FieldCollection
}
~~~

Template 使用扁平变量清单：

~~~typescript
interface InterfaceVarManifest {
  interfaceId: string
  interfaceName: string
  vars: InterfaceVarInfo[]
}

interface InterfaceVarInfo {
  varName: string
  type: 'text' | 'image'
  description: string
  example: string
  path: string
}
~~~

### 2.2 InterfaceInstance

~~~typescript
interface InterfaceInstance {
  instanceId: string // UUID v4
  name: string
  generatedAt: string
  values: Record<string, string>
}
~~~

实例本体不保存 interfaceId；实例所属的 Interface 由仓储目录确定。Template 导出时必须校验所选 instanceId 确实属于 Template 声明的 interfaceId。

## 三、Schema 定义

### 3.1 Schema 是评分块列表

Schema 不是一个只能整体消费的评分配置，而是一个可复用的评分块列表。Template 或函数可以只消费其中的部分评分块，也可以多次独立消费同一个评分块。

~~~typescript
interface SchemaDef {
  id: string
  name: string
  blocks: SchemaBlockDef[]
}

interface SchemaBlockDef {
  blockId: string
  name: string

  // 评分块对外暴露的变量列表。
  // 评分维度、评分规则和内部合并方式由 schema-editor 定义。
  fields: SchemaFieldDef[]
}

type SchemaFieldDef =
  | { varName: string; type: 'text' }
  | { varName: string; type: 'audio' }
  | { varName: string; type: 'choice' }
~~~

choice 类型的 Player 交互和最终导出方式尚未定稿；Template 的 Schema 引用模型必须为其保留扩展位置，但本文不确定具体行为。

Schema 对 Template 暴露评分块清单：

~~~typescript
interface SchemaBlockManifest {
  schemaId: string
  schemaName: string
  blocks: Array<{
    blockId: string
    blockName: string
    fields: SchemaFieldDef[]
  }>
}
~~~

### 3.2 Schema 评分块消费

Template 或函数在所在层级消费评分块：

~~~typescript
interface SchemaUse {
  useId: string
  schemaId: string
  blockId: string

  // 必须覆盖被消费评分块的全部 fields。
  bindings: Record<string, SchemaBindingExpression>
}
~~~

同一个 schemaId + blockId 可以出现多次；每次消费拥有独立的 useId 和独立绑定。

Schema 绑定允许使用 Template 的普通表达式：

~~~typescript
type SchemaBindingExpression =
  | {
      type: 'literal'
      value: string | number
    }
  | {
      type: 'variable'
      scope: 'interface'
      alias: string
      varName: string
    }
  | {
      type: 'variable'
      scope: 'local'
      name: string
    }
  | {
      type: 'concat'
      parts: Array<
        | { type: 'literal'; value: string }
        | { type: 'variable'; scope: 'interface'; alias: string; varName: string }
        | { type: 'variable'; scope: 'local'; name: string }
      >
    }
  | {
      type: 'record-output'
      name: string
    }
~~~

其中 record-output 是运行期录音槽位的引用；其他表达式在导出试卷包时求值。

### 3.3 Schema 作用域和合并

Schema 消费遵循 DSL 的局部作用域：

- 子层级不能看到父层级声明的 Schema 消费。
- 当前层级消费评分块时，必须在当前层级完整绑定全部参数，不能只绑定一部分。
- 父层级可以看到子函数声明的 Schema 依赖，但只能把它当作不可修改的依赖声明，不能重新绑定子函数内部字段。
- 函数内部消费的评分块会随函数依赖向外合并。
- 外层也可以独立消费同一个 Schema 或同一个评分块；独立消费不会覆盖函数内部绑定。
- 生成导出包时，Schema 依赖按 schemaId 分组；每个 useId 仍保留为独立消费实例。

Template 发布校验必须确认展开后的有效 Schema 消费集合非空。Schema 依赖可以全部来自函数内部，但不能完全缺失。

## 四、Template 对外契约

Template 可以依赖多个 Interface，并且只接受每个 Interface 的部分变量：

~~~typescript
interface TemplateInterfaceRequirement {
  alias: string
  interfaceId: string
  acceptedVars: string[]
}
~~~

alias 是 Template 内部为 Interface 分配的命名空间。只有 Interface 变量使用命名空间，例如：

~~~text
[@speaking.sentence]
[@listening.question]
~~~

Template 不保存实例选择：

~~~typescript
interface ExportInterfaceInstanceSelection {
  alias: string
  interfaceId: string
  instanceId: string
}
~~~

导出或预览时，调用方必须为每个 alias 提供一个选择结果。

## 五、Template DSL 与导出

Template 的 DSL 由页面节点、框架节点和函数节点组成。页面节点包含内容文档和线性时间线；时间线中的每个 record 步骤产生一个可命名的录音输出。函数有手动声明的输入列表、外层框架节点和手动声明的出参列表。

函数出参和页面录音输出都属于局部变量。出参名称在同一局部命名空间内唯一；新增时系统可以生成可编辑的默认名称，如 recording-1。

除用户录制的音频外，所有变量和表达式都在导出试卷包时确定值，等价于编译期求值。

### 5.1 Player 数据段

Player 数据段与 Schema 的评分结构无关，只描述 ExamPlayer 播放试卷和保存运行期作答所需的基本信息。

~~~typescript
interface PlayerExamData {
  pages: ExamPage[]
  recordingIndices: number[]

  // 选择题的交互和导出方式尚未定稿。
  // choiceIndices 及相关字段在选择题设计确定后补充。
}

interface ExamPage {
  id: string
  layout: ResolvedContentBlock[]
  timeline: ResolvedTimelineStep[]
}

type ResolvedTimelineStep =
  | { type: 'play'; src: string }
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex: number }
~~~

录音文件按 recordIndex 保存。Player 不需要理解 Schema 的评分规则。

### 5.2 Schema 映射段

Schema 映射段把每个评分块消费实例的字段映射到固定值或 Player 运行期槽位：

~~~typescript
interface SchemaExportData {
  usages: SchemaUsageExport[]
}

interface SchemaUsageExport {
  useId: string
  schemaId: string
  blockId: string
  fields: SchemaFieldValue[]
}

type SchemaFieldValue =
  | { varName: string; type: 'text'; value: string }
  | { varName: string; type: 'audio'; recordIndex: number }
  | { varName: string; type: 'choice'; choiceIndex: number }
~~~

text 等非录音字段在导出时已经确定。audio 字段只保存对应的 recordIndex，实际音频由 ExamPlayer 在运行时录制。choice 字段的运行期行为待选择题设计确定。

### 5.3 ExamPackage

~~~typescript
interface ExamPackage {
  title: string
  player: PlayerExamData
  schema: SchemaExportData
}
~~~

Template 可以引用多个 Schema，因此 ExamPackage 不再使用单一的 schemaId 字段。

## 六、作答包

作答包分为 Player 运行期数据和 Schema 映射数据：

~~~text
submission.zip
├── submission.json
├── schema.json
├── 0.mp3
├── 1.mp3
└── ...
~~~

- schema.json 保存从 ExamPackage.schema 原样传递的 Schema 映射。
- 音频文件按 recordIndex 命名。
- ExamPlayer 不解析、不修改评分块字段，只负责采集运行期作答并写入作答包。
- 选择题的作答文件和交互协议待单独设计。

元数据使用多个 Schema：

~~~typescript
interface SubmissionMeta {
  student: StudentInfo
  schemaIds: string[]
  submittedAt: string
}

interface StudentInfo {
  name: string
  studentId: string
}
~~~

## 七、完整数据流

~~~text
1. 创建 InterfaceDef
2. 创建 SchemaDef（包含可复用评分块）
3. 创建 TemplateDraft
   → 声明多个 Interface 依赖和变量子集
   → 组装页面、框架和函数节点
   → 配置函数输入和手动出参
   → 在函数或 Template 层消费 Schema 评分块
   → 为每个评分块完整填写绑定
4. 发布 TemplateDraft → TemplateDef
5. 预览或导出时为每个 Interface 别名选择 InterfaceInstance
6. 编译 Template DSL
   → 求值所有静态表达式
   → 展开函数和框架
   → 为录音步骤分配 recordIndex
   → 生成 Player 数据段
   → 生成 Schema 映射段
7. ExamPlayer 播放 Player 数据
   → 运行时录制音频
   → 采集其他尚未确定的运行期作答
   → 生成作答包
8. Schema 系统读取 schema.json 和作答数据进行评分
~~~
