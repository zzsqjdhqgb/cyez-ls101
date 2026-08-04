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

- 左侧列出页面预设、框架预设、函数和用户自定义函数。
- 中间显示当前 Template 的有序节点树。
- 右侧显示选中节点的参数、输入绑定、出参和 Schema 绑定。
- 页面节点是叶子节点；框架节点可以包含多个有序子节点；函数节点是可复用函数的调用。
- 画布支持增删节点、移动节点、编辑绑定和撤销/重做。

## 三、DSL 节点

Template 的节点只有两种基础结构：页面节点和框架节点。函数节点是函数在调用处的表现形式。

~~~typescript
type TemplateNode = PageNode | FrameNode | FunctionNode

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
  inputs: Record<string, ValueExpression>
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

type ContentBlock = TextBlock | ImageBlock | ChoiceViewOutlet

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

文本变量可以来自 Interface、函数输入或当前作用域中的其他输出。只有 Interface 变量在用户可见语法中带命名空间，例如 [@speaking.sentence]；局部变量通过当前作用域中的名称引用。

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

type VariableRef =
  | { scope: 'interface'; alias: string; varName: string }
  | { scope: 'local'; name: string }
~~~

Interface 的 text 变量可以绑定到 string；Interface 的 image 变量可以绑定到 file。当前没有 Interface 的 number 变量，但表达式模型保留未来增加该能力的空间。

每个函数和页面都拥有局部命名空间。局部输出通过名称向外层暴露；同名输出不能共存。函数出参处可以使用普通值、变量引用或字符串表达式。

## 六、函数

函数是一个可复用的 DSL 子图。它由手动配置的输入列表、一个外层框架节点和手动配置的出参列表组成。

~~~typescript
interface FunctionDef {
  id: string
  name: string
  inputs: FunctionInputDef[]
  body: FrameNode
  outputs: FunctionOutputDef[]
  choiceQuestions: ChoiceQuestionContribution[]
  schemaUses: SchemaUse[]
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
  | ValueExpression
  | { type: 'audio'; source: 'record-output'; name: string }
  | { type: 'choice'; source: 'choice-output'; name: string }
~~~

函数输入、页面录音输出、选择题输出和函数出参共享同一个局部命名空间，所有名称必须整体唯一。新增输入或出参时系统生成可编辑的默认名称，例如 text-1、recording-1、answer-1。

函数出参表达式对函数内部来说就是普通可填写变量槽位，因此可以引用函数输入、页面录音输出、其他局部变量和固定文本。函数节点对外只暴露函数声明的出参，函数内部的其他变量不会穿透到外层。

~~~typescript
interface FunctionNode extends BaseNode {
  type: 'function'
  functionRef: string
  inputs: Record<string, ValueExpression>
}
~~~

调用函数时，调用方为每个函数输入提供一个表达式。函数出参以其声明的名称加入调用方的局部命名空间。

## 七、选择题

### 7.1 定位

选择题由三个部分组成：

- ChoiceQuestionContribution：函数或 Template 产生的一道选择题结构片段。
- ChoiceCollector：框架节点上的收集边界，负责把后代片段组成一个可分页题组。
- ChoiceViewOutlet：页面内容中的受控视图占位，编译后显示 Collector 生成的题组。

选择题题目与显示页面平行地由编译器收集，不通过 setter、Frame 句柄或普通函数出参传递。函数在编译器层面返回题目结构片段，但用户手动声明的函数出参只负责把具体 choice 作答值传到外层。

~~~typescript
interface ChoiceQuestionContribution {
  id: string
  outputName: string
  stem: TextExpression
  options: ChoiceOptionDef[]
}

interface ChoiceOptionDef {
  id: string
  content: TextExpression
}

interface ChoiceCollectorConfig {
  id: string
  questionsPerPage: number
}
~~~

每道题产生一个 choice 类型的运行期输出。outputName 在当前局部命名空间内唯一，新增时自动生成 answer-1 一类的可编辑默认名称。首版选择题为单选；选项数量由题目结构决定，选项 ID 稳定，A/B/C/D 等字母只属于显示标签。

正确答案、分值和评分规则不属于 ChoiceQuestionContribution，不写入 Player 使用的题目结构；它们通过 Schema 评分块的静态参数表达。

### 7.2 ChoiceViewOutlet

页面内容可以插入选择题视图占位：

~~~typescript
interface ChoiceViewOutlet {
  id: string
  type: 'choice-view'
  x: number
  y: number
  width: number
  height: number
  collector: 'nearest'
  defaultViewport: ChoiceViewport
}

type ChoiceViewport =
  | { mode: 'free'; initialPage?: number }
  | { mode: 'focus'; questionRef: string }
  | {
      mode: 'range'
      startPage: number
      endPage: number
      initialPage?: number
    }
~~~

- free：允许浏览整个题组。
- focus：自动跳到包含目标题的内页、高亮该题并锁定内部分页；同一内页上的其他题仍可作答。
- range：只允许在指定内页范围内翻页，当前内页超出范围时自动回到范围起点。

持久化格式中的内页序号从 0 开始，编辑器向用户显示时从 1 开始。Collector 的分页规则或题目数量变化后，编辑器必须重新校验 initialPage、startPage 和 endPage。

同一个 Collector 生成的多个 ChoiceViewOutlet 共享学生答案，但各自拥有独立的当前内页和视图状态。进入新的外层页面时，视图根据 defaultViewport 和当前时间步骤的覆盖参数初始化；答案不会被清除。学生可以改选，不能通过再次点击已选项取消；首版不强制作答，外层时间线结束时照常推进。

### 7.3 收集与函数组合

编译节点时，页面、选择题片段、Schema 依赖和普通出参通过彼此独立的通道返回：

~~~typescript
interface CompiledNode {
  pages: CompiledPage[]
  choiceQuestions: CompiledChoiceQuestion[]
  schemaUses: CompiledSchemaUse[]
  valueOutputs: CompiledValueOutput[]
}
~~~

具有 choiceCollector 的框架按子节点展开顺序收集 choiceQuestions。多个函数调用之间按调用节点顺序收集；单个函数产生多道题时按函数内声明顺序收集。Collector 根据 questionsPerPage 分页，并在第二阶段解析 ChoiceViewOutlet、focus/range、choice 出参和 Schema 绑定。

每个题目片段归属最近的外层 Collector。嵌套 Collector 会捕获自己的后代题目，不向更外层泄漏；题目片段找不到 Collector 时视为编译错误。每次函数调用都会重新命名局部题目身份，因此同一个单题函数调用十次会生成十道独立题目，但可以由同一个 Collector 组成统一题组。

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

## 十、Template 生命周期与身份

Template 使用草稿与已发布成品分离的模型。每份 Template 必须有有效的 Schema 依赖：根层可以直接消费评分块，也可以通过函数内部消费间接产生依赖；整个 DSL 展开后不能没有任何 Schema 评分块。

~~~typescript
type TemplateStatus = 'draft' | 'published'

interface TemplateContent {
  name: string
  description: string
  interfaces: TemplateInterfaceRequirement[]
  root: FrameNode
  choiceQuestions: ChoiceQuestionContribution[]
  schemaUses: SchemaUse[]
}

interface TemplateDraft extends TemplateContent {
  draftId: string
  status: 'draft'
}

interface TemplateDef extends TemplateContent {
  id: string
  status: 'published'
}
~~~

发布时根据 TemplateContent 的规范化内容计算 TemplateDef.id，格式为 sha256:<64 位十六进制摘要>。规范化输入包括名称、描述、Interface 依赖、根 DSL、Template 层选择题片段、Template 层 Schema 消费和引用的函数定义身份；不包括 draftId、发布状态、时间戳和导出时选择的 Interface 实例。

发布后的 Template 不直接编辑。修改已发布 Template 时先创建草稿；草稿通过校验后发布，内容变化时产生新的内容 ID，相同内容则复用已有成品。

## 十一、预览与导出

预览和正式导出都需要为每个 Interface 别名临时选择一个实例。选择结果不写入 Template。

导出流程：

1. 为所有 Interface 别名选择并校验 InterfaceInstance。
2. 解析 Interface 变量、函数输入、页面参数和 Schema 表达式。
3. 展开框架和函数，平行收集页面、选择题片段和 Schema 依赖。
4. 由每个 ChoiceCollector 组装题组并解析视图占位，为题目分配全局 choiceIndex。
5. 按页面时间线为 record 步骤分配全局 recordIndex。
6. 生成 ExamPlayer 可识别的页面、录音槽位和选择题题组。
7. 生成 Schema 可识别的评分块映射。
8. 写入最终试卷包。

除用户录制的音频和学生选择外，其他变量在第 2 步完成赋值，等价于编译期确定值。
