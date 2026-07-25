# 低代码模板编辑器 — 核心设计（定稿）

## 一、布局

三栏经典格局，所有面板可折叠。

```
+--------------+-----------------------------------+--------------+
| Section 面板  |              主画布                |  属性面板     |
| (左侧, 240px) |                                   | (右侧, 280px)|
+--------------+-----------------------------------+--------------+
```

### 1.1 左侧：Section 面板

- 上方为预设 Section 列表（不可删除/编辑）
- 下方为"我的 Section"，按库分组
- 每个库内列出该库的自定义 Section
- 点击自定义 Section 进入独立编辑页面（见第六章）
- 从左侧拖拽 Section 到画布即添加；也可点击画布底部的"+ 添加 Section"从下拉菜单选择

### 1.2 中间：主画布

- Section 表现为**可折叠卡片**，卡片头显示类型名 + 参数摘要，右侧有折叠/删除/拖拽句柄
- 卡片之间用虚线分隔，表示试卷线性顺序
- 展开卡片显示子节点列表，每个子节点可编辑，支持增删和拖拽排序
- 画布顶部显示模板名和当前选用的 Interface 实例（全局变量来源）
- 顶栏右侧有"预览"按钮（切换学生视角）

### 1.3 右侧：属性面板

- 显示当前选中 Section 的参数表单
- 参数类型决定控件：number 数字输入，string 文本框（含 [@var] 变量引用支持），file 文件上传
- 参数值可以手动填写，也可以引用全局变量（语法见第四章）或前序 Section 的输出变量

---

## 二、最小 Section 定义

所有 Section 由同一个基础结构定义：

```
Section = layout + timeline
```

不存在"朗读单句"和"听力选择题"是不同类型这回事——它们只是同一结构的不同实例。

### 2.1 Layout：纯视觉布局

教师自由摆放文本块和图片块。基于 1200x800 设计基准，所有坐标为百分比。

```typescript
interface LayoutBlock {
  id: string
  type: "text" | "image"

  // 绝对定位（相对 1200x800 基准，百分比）
  x: number        // 0-100，左边缘
  y: number        // 0-100，上边缘
  width?: number   // 0-100，图片必须设；文本可选（不设则 auto-fit 到内容宽度）
  // height 由内容自动计算

  // 内容
  text?: string         // type=text，可含 [@var] 变量引用
  src?: string          // type=image
  fontSize?: number     // type=text，默认 24px（基于 1200 基准）
  bold?: boolean
  align?: "left" | "center" | "right"
}
```

**Z 轴规则**：图片永远在文本下方。同类型 block 之间渲染顺序 = 数组顺序。用户不能手动控制 z-index。

**自由布局实现风险**：如果绝对定位实现困难，回退到流式 block 列表（Notion 式）。回退方案中 block 按数组顺序从上到下排列，去掉 x/y/width 字段。通过 x/y 是否存在判断布局模式。

### 2.2 Timeline：播放序列

按顺序执行的原子步骤。

```typescript
type TimelineStep =
  | { type: "play",     src: string }       // 播放音频直到结束
  | { type: "countdown", seconds: number }  // 显示倒计时
  | { type: "record",   duration: number }  // 录音 N 秒，自动产生编号录音输出
```

**record 步骤自动产生输出**：扫描 timeline 中所有 record 步骤，按顺序编号（record #0, #1, #2...）。这些编号自动成为提交给 Schema 的录音数据。

### 2.3 Section 完整定义

```typescript
interface SectionDef {
  id: string
  name: string
  category: "builtin" | "custom"
  libraryId?: string          // 自定义库 ID

  // 核心结构
  layout: LayoutBlock[]       // 纯视觉
  timeline: TimelineStep[]    // 播放序列

  // 参数（可在属性面板和变量系统中引用）
  params: ParamField[]

  // 仅在自定义 Section 时有效
  inputVars?: InputVarDef[]
}
```

### 2.4 举例

预设 Section 本质上就是一个预填充了 layout 和 timeline 的 SectionDef。以下两个例子本质是同一结构，只是 params / layout / timeline 不同。

**朗读句子**（预设）：

```
id: "preset/sentence-reading"
name: "朗读句子"
category: "builtin"

params: [
  { key: "text", type: "string", label: "朗读内容" },
  { key: "prepSeconds", type: "number", label: "准备时间", defaultValue: 3 },
  { key: "recordSeconds", type: "number", label: "录音时间", defaultValue: 10 }
]

layout: [
  { id: "t1", type: "text", x: 30, y: 40, width: 40,
    text: "[@text]", fontSize: 32, bold: true, align: "center" }
]

timeline: [
  { type: "countdown", seconds: "[@prepSeconds]" },
  { type: "record", duration: "[@recordSeconds]" }
]
```

**听力选择题**（预设）：

```
id: "preset/listening-choice"
name: "听力选择题"
category: "builtin"

params: [
  { key: "audioSrc", type: "file", label: "音频" },
  { key: "question", type: "string", label: "题干" },
  { key: "optionA", type: "string", label: "选项 A" },
  { key: "optionB", type: "string", label: "选项 B" },
  { key: "optionC", type: "string", label: "选项 C" },
  { key: "optionD", type: "string", label: "选项 D" },
  { key: "answer", type: "select", label: "正确答案",
    options: [{"A",0},{"B",1},{"C",2},{"D",3}] }
]

layout: [
  { id: "q", type: "text", x: 5, y: 10, width: 90,
    text: "[@question]", fontSize: 24, align: "left" },
  { id: "a", type: "text", x: 10, y: 30, width: 80,
    text: "A. [@optionA]", fontSize: 20, align: "left" },
  { id: "b", type: "text", x: 10, y: 42, width: 80,
    text: "B. [@optionB]", fontSize: 20, align: "left" },
  { id: "c", type: "text", x: 10, y: 54, width: 80,
    text: "C. [@optionC]", fontSize: 20, align: "left" },
  { id: "d", type: "text", x: 10, y: 66, width: 80,
    text: "D. [@optionD]", fontSize: 20, align: "left" }
]

timeline: [
  { type: "play", src: "[@audioSrc]" },
  { type: "countdown", seconds: 5 }
]
```

---

## 三、Section 层级与组合

### 3.1 复合 Section（Section 组）

多个 Section 可以嵌套。父 Section 通过 children 字段声明包含的子 Section 只能是什么预设（所有 Section 共享同一基础结构，此处约束的是哪个预设模板被允许作为子节点），以及是单个还是列表。

```
SectionDef {
  ...（同 2.3）
  children?: ChildrenSlot[]      // 非空 = 复合 Section
}

type ChildrenSlot = {
  slotId: string
  allowedPresets: string[]       // 允许放入的预设 SectionDef.id
  multiplicity: "single" | "list"
}
```

### 3.2 复合 Section 的行为

复合 Section 自身的 layout 可包含标题性内容。核心视觉由其子 Section 的 layout 决定——每个子 Section 的 layout 占据一个全屏快照，exam-player 按子 Section 顺序逐一切换。

### 3.3 模板树（画布数据模型）

```typescript
interface TemplateTree {
  root: TemplateTreeNode
  interfaceInstanceId?: string    // 当前模板绑定的 Interface 实例（全局变量来源）
}

interface TemplateTreeNode {
  id: string
  typeRef: string                 // 指向 SectionDef.id
  ownParams: Record<string, unknown>
  children: TemplateTreeNode[]
}
```

根节点 typeRef 固定为 root/exam。模板级的 interfaceInstanceId 决定全局变量池。各个 Section 通过 [@varName] 引用变量，解析时先查局部作用域，再查全局变量池。

---

## 四、变量系统

### 4.1 变量层级

- **全局变量（Interface 实例注入）**：模板级。教师在模板顶栏选择一个 Interface 实例后，该实例的所有字段注入为全局变量
- **Section 参数变量**：每个 Section 的 params 本身可作为变量被当前 Section 的 layout/timeline 引用，也可传递给子 Section

### 4.2 变量引用语法

文本中通过内联语法引用变量：[@variable_name]。

渲染为彩色内联块：
- 蓝色块 = 全局来源（Interface 实例）
- 绿色块 = Section 参数来源

教师在文本输入框中按 @ → 弹出变量选择器 → 插入为不可编辑 token → 可删除、不可修改 token 文本。

### 4.3 变量选择器

列出当前可用的所有变量，按来源分组（全局 / 上级 Section），支持搜索过滤。

### 4.4 变量作用域规则

- 当前 Section 的 params → 当前 Section 的 layout 和 timeline 可用
- 父 Section 内，前序 Section 的 params 对后序 Section 可见
- 全局变量对所有 Section 可见
- 不支持跨父级穿透

---

## 五、操作模型

所有编辑收敛为原子操作，支撑 undo/redo。

| 操作 | 说明 |
|------|------|
| addNode(parentId, position, presetId) | 在父节点下新增节点 |
| removeNode(nodeId) | 删除节点及其子树 |
| moveNode(nodeId, newParentId, newPos) | 移动节点位置 |
| setParam(nodeId, key, value) | 修改 Section 参数值 |
| setInterfaceInstance(instanceId) | 切换模板的 Interface 实例（全局变量来源） |
| addLayoutBlock(nodeId, block) | 在 layout 中添加 block |
| removeLayoutBlock(nodeId, blockId) | 删除 layout block |
| moveLayoutBlock(nodeId, blockId, newPos) | 移动 layout block |
| resizeLayoutBlock(nodeId, blockId, newSize) | 调整 layout block 大小 |
| editLayoutBlockText(nodeId, blockId, text) | 修改文本 block 内容 |
| addTimelineStep(nodeId, step, position) | 插入 timeline 步骤 |
| removeTimelineStep(nodeId, position) | 删除 timeline 步骤 |
| moveTimelineStep(nodeId, fromPos, toPos) | 调整 timeline 顺序 |

---

## 六、自定义 Section 编辑器

### 6.1 入库流程

主画布选中一个或一组 Section → 右键 → "保存为自定义 Section" → 命名 → 选择库（或新建库）→ 保存后出现在左侧"我的 Section"面板。

### 6.2 自定义 Section 编辑页

点击"我的 Section"中的任意一项 → 进入独立编辑页面。布局和主编辑器画布基本相同，区别：

- **右上角有输入变量面板**（inputVars），可增删。这些变量是此 Section 对外暴露的接口
- **没有 Interface 全局变量**
- 自定义 Section 内可引用自己的 params 和 inputVars

### 6.3 使用自定义 Section

在主编辑器画布中从左侧拖拽自定义 Section 到画布。其 inputVars 暴露为属性面板中的参数。教师可以手动填写，或引用全局变量、前序 Section 的参数。

---

## 七、预设 Section

预设 Section（朗读句子、快速应答、听力选择题等）不是独立的 Section 类型——它们只是**预填充了 layout、timeline、params 的 SectionDef 实例**。教师选择预设 = 以此为基础开始编辑。

预设存储在类型注册表中，category=builtin，不可删除。教师可复制一份到自定义库后修改。

---

## 八、Interface 实例选择

模板顶栏显示当前选用的 Interface 实例（若有），作为全局变量来源。切换实例时，全局变量池更新。原本引用旧实例变量的 token 变为"未解析"状态（红色标记），直到教师手动重新赋变量。

模板可以没有 Interface 实例——此时只支持手动填写所有参数。

---

## 九、预览模式

画布顶栏右侧"预览"按钮 → 全屏切换至 ExamPlayer，以学生视角播放整张试卷。预览时 Section 引擎将模板树展开为 ExamPackage，变量替换为当前值（无 Interface 实例时使用手动填写的默认值）。