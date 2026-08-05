# 低代码试卷模板编辑器 — 核心设计（定稿）

## 一、产品定位

Template 是一份可复用的试卷 DSL。它描述试卷如何由页面、框架和函数组成，以及各个参数和评分块如何连接。

Template 不保存 Interface 的具体实例值。它只声明自己依赖哪些 Interface 和变量。用户在预览或导出时，才为每个 Interface 选择一个 InterfaceInstance。

Template 也不直接实现评分逻辑。Schema 以可复用的评分块列表形式提供评分系统所需的变量契约；Template 选择并绑定其中的评分块，并在导出时生成 Schema 可识别的映射。

整体关系：

~~~text
Interface                         Template                         Schema
定义可生成的数据变量                定义试卷 DSL 和参数连接             定义可消费的评分块和变量
        │                                  │                                  │
        │                                  │ 选择评分块并绑定                  │
        └── 导出时选择 Instance ──────────┴────────── 生成导出映射 ────────────┘
~~~

## 二、编辑器界面

编辑器是图形化 DSL 编辑器，采用三栏布局：

~~~text
+----------------+-----------------------------------+----------------+
| 节点/函数库     |              DSL 画布              | 属性与绑定面板  |
|                |                                   |                |
+----------------+-----------------------------------+----------------+
~~~

- 左侧列出页面预设、框架预设、选择题单题、函数和用户自定义函数。
- 中间显示当前 Template 的有序节点树。
- 右侧显示选中节点的参数、输入绑定、出参和 Schema 绑定。
- 页面节点是叶子节点；框架节点可以包含多个有序子节点；函数节点是可复用函数的调用。
- 画布支持增删节点、移动节点、编辑绑定和撤销/重做。

编辑器内核使用不可变文档操作。节点通过当前函数定义内唯一的 `nodeId` 定位，避免数组位置变化导致选中项或撤销记录指向错误对象；时间线、选项和其他纯列表仍使用受检查的索引操作。每次成功编辑返回新文档、原文档和结构化 change 列表，失败则返回错误码、字段路径和参数。编辑操作不递增 `revision`，只有仓储成功保存后才产生新 revision。

新增和复制节点时，内核自动生成不冲突的节点 ID。复制包含录音、选择题或函数调用的子树时，还会为其局部输出生成新名称，并重写复制体内部的局部变量引用以及相对 focus 地址。移动节点保留原 ID，且不允许把框架移动到自己的后代中。删除函数调用节点时，同一次编辑会清理 Template 中已不可达的内嵌函数资源。

## 三、DSL 节点

Template 有页面节点、框架节点和选择题单题节点三种基础结构。函数节点是函数在调用处的表现形式。

~~~typescript
type TemplateNode = PageNode | FrameNode | FunctionNode | ChoiceQuestionNode

interface BaseNode {
  id: string
}

interface FrameNode extends BaseNode {
  type: 'frame'
  children: TemplateNode[]
  choiceCollector?: ChoiceCollectorConfig
}

interface PageNode extends BaseNode {
  type: 'page'
  content: ContentDocument
  timeline: TimelineStep[]
}

interface FunctionNode extends BaseNode {
  type: 'function'
  functionRef: string
  inputs: Record<string, StaticValueExpression>
  outputNames: Record<string, string>
}

interface ChoiceQuestionNode extends BaseNode {
  type: 'choice-question'
  stem: TextExpression
  options: ChoiceOptionDef[]
  outputName: string
}
~~~

框架节点的 children 是一个有序列表，不使用 ChildrenSlot。框架只负责组合和排序；子节点类型与数量约束由函数定义或其他编辑器校验规则决定，而不是通过隐藏的插槽结构表达。

根节点固定为一个 FrameNode，代表整份试卷。

## 四、页面节点

页面节点不能添加子节点，包含两个部分：内容文档和线性时间线。

### 4.1 内容文档

内容文档是面向教师的简单编辑器，基于 1200×800 设计基准。内容块使用百分比坐标；图片永远渲染在文本下方，同类型内容块按数组顺序渲染。

~~~typescript
interface ContentDocument {
  blocks: ContentBlock[]
}

type ContentBlock = TextBlock | ImageBlock | ChoiceViewBlock

interface TextBlock {
  id: string
  type: 'text'
  x: number
  y: number
  width?: number
  fontSize?: number
  bold?: boolean
  align?: 'left' | 'center' | 'right'
  text: TextExpression
}

interface ImageBlock {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  src: ValueExpression<'file'>
}
~~~

文本支持固定内容与变量拼接。编辑器显示为带变量 token 的自然文本；内部使用结构化片段保存，避免用户直接修改变量标识。

~~~typescript
type TextExpression = {
  type: 'string'
  parts: Array<
    | { type: 'literal'; value: string }
    | { type: 'variable'; ref: VariableRef }
  >
}
~~~

Template 根中的文本变量可以来自 Interface 或当前作用域中的其他输出。只有 Interface 变量在用户可见语法中带命名空间，例如 [@speaking.sentence]；局部变量通过当前作用域中的名称引用。函数定义不能直接引用 Template 的 Interface alias，所需 Interface 值必须在调用点绑定到函数输入，再由函数内部以局部变量使用。

### 4.2 时间线

时间线是按顺序执行的列表。

~~~typescript
type TimelineStep = TimelineAction & {
  choiceViewOverrides?: Record<string, ChoiceViewport>
}

type TimelineAction =
  | { type: 'play'; src: ValueExpression<'file'> }
  | { type: 'countdown'; seconds: ValueExpression<'number'> }
  | {
      type: 'record'
      duration: ValueExpression<'number'>
      outputName: string
    }
~~~

record 步骤会产生一个音频类型的可用输出。新增录音项时系统生成默认名称，例如 recording-1；用户可以编辑名称，但同一局部命名空间内的名称必须唯一。展开 Template 时，系统为所有录音输出分配全局 recordIndex。

choiceViewOverrides 以内容块 ID 为 key，在当前时间步骤覆盖选择题视图的状态。它可以让同一个选择题视图在播放音频时聚焦某题，在检查阶段开放指定内页范围；选择题视图不能阻止时间线推进。

当前内置时间线只有上述三种步骤。用户录制的音频和学生选择是 Template 导出后仍需在 ExamPlayer 运行时产生的变量；其他参数和表达式在导出试卷包时确定。

## 五、值与变量表达式

参数类型只有 string、number 和 file。非文本值不支持拼接，只能是一个固定值或一个变量引用。

~~~typescript
type ValueType = 'string' | 'number' | 'file'

type ValueExpression<T extends ValueType = ValueType> =
  | { type: T; source: 'literal'; value: T extends 'string' ? string : T extends 'number' ? number : string }
  | { type: T; source: 'variable'; ref: VariableRef }

type StringExpression = ValueExpression<'string'> | TextExpression

type StaticValueExpression =
  | StringExpression
  | ValueExpression<'number'>
  | ValueExpression<'file'>

type VariableRef =
  | { scope: 'interface'; alias: string; varName: string }
  | { scope: 'local'; name: string }
~~~

Interface 的 text 变量可以绑定到 string；Interface 的 image 变量可以绑定到 file。当前没有 Interface 的 number 变量，但表达式模型保留未来增加该能力的空间。

每个函数和页面都拥有局部命名空间。局部输出通过名称向外层暴露；同名输出不能共存。函数出参处可以使用普通值、变量引用或字符串表达式。

## 六、函数

函数是一个可复用的 DSL 子图。它由手动配置的输入列表、一个外层框架节点和手动配置的出参列表组成。

~~~typescript
interface FunctionContent {
  name: string
  inputs: FunctionInputDef[]
  body: FrameNode
  outputs: FunctionOutputDef[]
  schemaUses: SchemaUse[]
}

interface FunctionDocument {
  functionId: string
  revision: number
  content: FunctionContent
  editorState: DslEditorState
}

interface FunctionDef extends FunctionContent {
  id: string
}

interface FunctionInputDef {
  name: string
  type: ValueType
}

interface FunctionOutputDef {
  name: string
  type: ValueType | 'audio' | 'choice'
  expression: OutputExpression
}

type OutputExpression =
  | StaticValueExpression
  | { type: 'audio'; source: 'record-output'; name: string }
  | { type: 'choice'; source: 'choice-output'; name: string }
~~~

函数库中的 `FunctionDocument` 是可直接编辑和删除的源文档，使用稳定 UUID 标识。用户把函数加入 Template 时，系统复制该函数当前状态及其完整嵌套函数依赖闭包；复制过程从叶子开始，把内部 `functionRef` 改写为已复制子函数的内容 ID，再计算父函数内容 ID。相同内容 ID 的资源只保存一次，因此最终结构是去重后的依赖图，而不是重复的树。

Template 不保存对函数库 UUID 的活动引用。复制完成后，Template 根节点和内嵌函数中的 `functionRef` 都只指向 Template 自身资源集合中的 `FunctionDef.id`。修改或删除函数库源文档不会影响已有 Template；更新到新版本必须显式重新复制。函数不会在存储时摊平，输入、出参、局部命名空间、Schema 消费和相对 focus 地址仍保留原有函数边界，最终导出时才由编译器展开。递归函数依赖不允许复制。

函数输入、页面录音输出、选择题输出和函数出参共享同一个局部命名空间，所有名称必须整体唯一。新增输入或出参时系统生成可编辑的默认名称，例如 text-1、recording-1、answer-1。

函数是独立复用边界，不捕获调用方的 Interface 命名空间。Template 调用函数时可以把 Interface 变量绑定到函数输入；函数正文、函数出参和函数内部 Schema 绑定只能引用函数输入及函数自身产生的局部变量。这样 Interface alias 重命名不需要重建内容寻址的函数资源 DAG。

函数出参表达式对函数内部来说就是普通可填写变量槽位，因此可以引用函数输入、页面录音输出、其他局部变量和固定文本。函数节点对外只暴露函数声明的出参，函数内部的其他变量不会穿透到外层。

~~~typescript
interface FunctionNode extends BaseNode {
  type: 'function'
  functionRef: string
  inputs: Record<string, StaticValueExpression>
  outputNames: Record<string, string>
}
~~~

调用函数时，调用方为每个函数输入提供一个表达式，并通过 outputNames 为每个函数出参指定调用方局部命名空间中的名称。新增调用节点时系统自动生成不冲突的默认名称，用户可以编辑；同一函数因此可以被多次调用而不产生固定出参名冲突。

函数签名发生变化后，调用节点通过显式的 reconcile 操作更新：保留名称和类型契约仍存在的输入绑定与出参重命名，删除已经不存在的 key，并用对应类型的空字面量和不冲突名称补齐新增项。工作文档仍允许表达式暂时引用已经删除的普通局部变量，这类需要用户重新选择含义的错误不做猜测式改写，由严格校验器定位。

## 七、选择题

### 7.1 定位

选择题由三个部分组成：

- ChoiceQuestionNode：可以直接放在框架或函数中的单题节点。
- ChoiceCollector：框架节点上的局部收集边界，负责把后代单题节点组成分页配置。
- ChoiceViewBlock：页面内容中的受控视图，显示编译后的全局 ChoiceMeta。

选择题单题节点与显示页面平行地由编译器收集，不通过 setter、Frame 句柄或普通函数出参传递。用户手动声明的函数出参只负责把具体 choice 作答值传到外层。

~~~typescript
interface ChoiceQuestionNode extends BaseNode {
  type: 'choice-question'
  stem: TextExpression
  options: ChoiceOptionDef[]
  outputName: string
}

interface ChoiceOptionDef {
  id: string
  content: TextExpression
}

interface ChoiceCollectorConfig {
  pages: ChoicePageSpec[]
}

interface ChoicePageSpec {
  questionCount: number
}
~~~

单题节点接收题干和可增减的选项列表。首版为单选，选项数量必须为 2 至 26；显示标签根据列表位置从 A 开始自动递增，不能手动编辑。每道题产生一个 choice 类型的运行期输出，值为 A-Z 或未作答标记 `-`。outputName 在当前局部命名空间内唯一，新增时自动生成 answer-1 一类的可编辑默认名称。

choice 是独立的运行期类型，不是 string。它不能参与文本拼接，也不能隐式绑定到 string 参数；它只能通过函数 choice 出参继续传递，或绑定到 Schema 的 choice 字段。

正确答案、分值和评分规则不属于 ChoiceQuestionNode，不写入 Player 使用的题目结构；它们通过 Schema 评分块的静态参数表达。

Collector 的 pages 是可增减列表，每项的 questionCount 表示该内页包含的连续题目数量。例如 `[5, 5]` 表示前五题在第一页、后五题在第二页。questionCount 只能是大于 0 的整数字面量，不接受变量绑定。严格校验时必须满足所有 questionCount 之和等于 Collector 实际收集的单题节点数量。

### 7.2 ChoiceViewBlock

页面内容可以插入选择题视图：

~~~typescript
interface ChoiceViewBlock {
  id: string
  type: 'choice-view'
  x: number
  y: number
  width: number
  height: number
  defaultViewport: ChoiceViewport
}

type ChoiceViewport =
  | { mode: 'free'; initialPage?: number }
  | {
      mode: 'focus'
      questionRef: {
        scope: 'relative' | 'absolute'
        callPath: string[]
        questionId: string
      }
    }
  | {
      mode: 'range'
      startPage: number
      endPage: number
      initialPage?: number
    }
~~~

- free：允许浏览全局 ChoiceMeta 的所有内页。
- focus：自动跳到包含目标题的内页、高亮该题并锁定内部分页；同一内页上的其他题仍可作答。
- range：只允许在全局内页的指定范围内翻页，当前内页超出范围时自动回到范围起点。

focus 的 questionRef 可以引用全局 ChoiceMeta 中的任意题目，不受原 Collector 收集范围限制。relative 地址从当前 Template 或函数定义作用域开始，absolute 地址从 Template 根开始；callPath 由沿途 FunctionNode.id 组成，questionId 指向最终单题节点。持久化格式中的内页序号从 0 开始，编辑器向用户显示时从 1 开始。Collector 的分页规则或题目数量变化后，编辑器必须重新校验 initialPage、startPage 和 endPage。

所有 ChoiceViewBlock 显示同一个全局 ChoiceMeta 并共享学生答案，但各自拥有独立的当前内页和视图状态。进入新的外层页面时，视图根据 defaultViewport 和当前时间步骤的覆盖参数初始化；答案不会被清除。学生可以改选，不能通过再次点击已选项取消；首版不强制作答，外层时间线结束时照常推进。

### 7.3 收集与函数组合

编译节点时，页面、选择题单题、Schema 依赖和普通出参通过彼此独立的通道返回：

~~~typescript
interface CompiledNode {
  pages: CompiledPage[]
  choiceQuestions: CompiledChoiceQuestion[]
  choiceMetaCandidate?: CompiledChoiceMeta
  schemaUses: CompiledSchemaUse[]
  valueOutputs: CompiledValueOutput[]
}
~~~

普通框架和函数按子节点展开顺序向上传播 choiceQuestions。具有 choiceCollector 的框架消费包裹范围内的 choiceQuestions，阻止原始题目继续向父层传播，按照 pages 配置分页，并生成一个密封的 choiceMetaCandidate。编译器随后把候选提升为全局、只读的 ChoiceMeta，并在第二阶段解析 ChoiceViewBlock、focus/range、choice 出参和 Schema 绑定。

首版整份 Template 最多只能产生一个 choiceMetaCandidate：Collector 不能嵌套；出现多个 Collector 候选是编译错误；带 Collector 的函数被调用两次同样会因产生两个候选而报错。没有选择题时允许没有 Collector；存在 ChoiceQuestionNode 时必须恰好产生一个候选，任何未被 Collector 消费的 choiceQuestions 都是编译错误。

每次函数调用都会重新命名局部题目身份，因此同一个不带 Collector 的单题函数调用十次会生成十道独立题目，并可由外层同一个 Collector 组成全局 ChoiceMeta。带 Collector 的完整选择题函数则可以开箱即用，外部不需要再次配置分页。

## 八、Interface 依赖

Template 可以依赖多个 Interface，并且只接受每个 Interface 的部分变量。每个依赖有一个 Template 内部别名，别名构成 Interface 变量的命名空间。

~~~typescript
interface TemplateInterfaceRequirement {
  alias: string
  interfaceId: string
  acceptedVars: string[]
}
~~~

例如：

~~~text
speaking  → 上海高考口语 Interface → sentence, topic, picture
listening → 上海高考听力 Interface → audio, question
~~~

Template 保存 interfaceId 和别名，不保存 instanceId。预览或导出时，用户为每个别名选择一个属于对应 Interface 的实例。

## 九、Schema 消费

Schema 由多个可复用评分块组成。Template 或函数可以选择其中的部分评分块；一旦消费某个评分块，必须在当前层级完整绑定它的全部参数。

~~~typescript
interface SchemaUse {
  useId: string
  schemaId: string
  blockId: string
  bindings: Record<string, OutputExpression>
}
~~~

评分块的消费具有作用域：

- 子层级不能看到父层级声明的 Schema 消费。
- 父层级只能看到子函数声明的 Schema 依赖，不能修改子函数内部的绑定。
- 函数内部消费的评分块会作为函数依赖向外合并。
- 同一个 Schema 的同一个评分块可以被多次独立消费，每次使用都有独立的 useId 和绑定。

Schema 相关的完整导出规则见 data-interface.md。

## 十、Template 工作文档与函数资源

Template 是可持续编辑并直接保存的工作文档，不区分草稿和已发布成品。每份 Template 使用稳定 UUID 标识；导出 ExamPackage 不是发布操作，也不会冻结 Template。导出后继续修改或删除 Template 不影响已经生成的试卷包，因为试卷包保存完整 Player 数据，只保留对 Schema 的评分依赖。

~~~typescript
interface TemplateContent {
  name: string
  description: string
  interfaces: TemplateInterfaceRequirement[]
  root: FrameNode
  schemaUses: SchemaUse[]
}

interface TemplateResources {
  functions: FunctionDef[]
}

interface TemplateDocument {
  templateId: string
  revision: number
  content: TemplateContent
  resources: TemplateResources
  editorState: DslEditorState
}
~~~

`editorState` 保存画布位置、折叠、选择等编辑器私有 JSON 状态，不参与语义校验或试卷编译。工作文档可以处于不完整状态，保存不触发严格校验；预览和导出必须通过完整校验。

Template 和函数源工作文档都带非负整数 `revision`。新文档从 0 开始，每次成功更新后由仓储递增；保存操作返回带新 revision 的完整文档，编辑器必须用返回值替换本地副本。仓储通过 File Store main 进程的原子 revision compare-and-swap 拒绝过期保存，该保证跨 renderer 和仓储实例成立；耗时的函数复制或资源清理不能覆盖期间完成的 autosave。

Template 本身不计算内容哈希。只有 `resources.functions` 中的内嵌函数快照使用 `sha256:<64 位十六进制摘要>` 内容 ID，用于不可变引用、复制去重和完整性验证。资源集合只需保存从 Template 根节点传递可达的函数依赖闭包；编辑器撤销历史所需的临时副本属于编辑状态，不参与编译。

每份 Template 必须有有效的 Schema 依赖：根层可以直接消费评分块，也可以通过内嵌函数消费间接产生依赖；整个 DSL 展开后不能没有任何 Schema 评分块。

## 十一、预览与导出

预览和正式导出都需要为每个 Interface 别名临时选择一个实例。选择结果不写入 Template。异步编译入口通过调用方提供的 Interface 仓储定位器按 `instanceId` 获取唯一定位结果，不直接信任选择 DTO 中自行声明的 `interfaceId`；定位结果的真实归属、选择结果和 Template requirement 必须三者一致。

导出流程：

1. 为所有 Interface 别名选择 InterfaceInstance，并通过仓储定位器校验实例存在且归属正确。
2. 解析 Interface 变量、函数输入、页面参数和 Schema 表达式。
3. 展开框架和函数，平行收集页面、选择题单题节点和 Schema 依赖。
4. 由唯一 ChoiceCollector 生成 choiceMetaCandidate，校验分页数量并提升为全局 ChoiceMeta。
5. 为每道选择题分配全局 choiceIndex，并解析视图、focus/range、choice 出参和 Schema 绑定。
6. 按页面时间线为 record 步骤分配全局 recordIndex。
7. 生成 ExamPlayer 可识别的页面、录音槽位和全局 ChoiceMeta。
8. 生成 Schema 可识别的评分块映射。
9. 写入最终试卷包。

除用户录制的音频和学生选择外，其他变量在第 2 步完成赋值，等价于编译期确定值。
