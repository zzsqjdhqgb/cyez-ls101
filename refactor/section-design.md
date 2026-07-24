## 核心理念

**Section = 参数化的题目生成器。**

```
Section(params: T) → Question[]
```

Section 接收一组参数，内部展开为一道或若干道题目。整张试卷就是一个根 Section。

关键设计：**复合 Section 的参数 schema 不是手动声明的，而是从子 Section 自动推导出来的。**

## 一、Section 的层级

### 1.1 原子 Section（内容节点）

不可再分的最小单元。系统内置以下原子类型：

| 原子类型 | 参数 |
|----------|------|
| `text` | `text: string`, `size: small/normal/large`, `bold: boolean` |
| `image` | `src: file`, `width: string`, `height: string` |
| `video` | `src: file` |
| `audio` | `src: file`, `text: string` |
| `quad-image` | `images: file[4]`, `width: string` |

### 1.2 复合 Section 的组成

一个复合 Section 包含两个部分：

**A. 子 Section 列表**

复合 Section 声明"我内部包含哪些子 Section"。每个子 Section 可以是一个原子 Section，也可以是另一个复合 Section。

子 Section 可以声明为：
- **单个**：内部包含一个该类型的 Section
- **列表**（`from_child`）：内部包含 0 到 N 个该类型的 Section，每个实例自动分配随机 UUID

**B. 自有参数**

复合 Section 可以声明一些自己独有的参数（如共享的时间配置、满分分值等）。这些自有参数与子 Section 的参数互不干扰。

### 1.3 参数自动推导（`from_child`）

这是最关键的设计：**当父 Section 包含某个子 Section 列表时，父 Section 的参数 schema 自动包含一个 `children` 列表字段，其元素类型就是子 Section 的参数类型。无需手动重新声明。**

举例：

```
原子 Section: 朗读单句
  参数: { text: string }

复合 Section: 朗读句子组
  子 Section:
    - from_child: 朗读单句    // 意思是"包含 N 个朗读单句"
  自有参数: 无

  // 朗读句子组的参数 schema 自动推导为:
  // {
  //   children: { text: string }[]    ← 由 from_child 自动生成，每项自动分配 UUID
  // }
```

教师在图形界面中看到的是：

```
朗读句子组
  └── children (列表，可增减)
      ├── [UUID: a1b2] text: "Hello, how are you?"
      ├── [UUID: c3d4] text: "What is your name?"
      └── [UUID: e5f6] text: "Nice to meet you."
```

**不需要**在朗读句子组中手动声明一个 `texts: string[]` 参数然后再编写循环绑定逻辑。子 Section 的参数直接穿透成为父 Section 的参数列表，每个子 Section 实例对应列表中的一项。

### 1.4 带自有参数的复合 Section

如果朗读句子组不仅包含朗读单句列表，还需要一个统一的准备时间和录音时长：

```
复合 Section: 朗读句子组
  子 Section:
    - from_child: 朗读单句
  自有参数:
    - prepSeconds: number
    - recordSeconds: number

  // 参数 schema 自动推导为:
  // {
  //   own: { prepSeconds: number, recordSeconds: number },
  //   children: { text: string }[]
  // }
```

教师在界面中看到：

```
朗读句子组
  ├── prepSeconds: 3        ← 自有参数
  ├── recordSeconds: 10     ← 自有参数
  └── children (列表):
      ├── [UUID: a1b2] text: "Hello, how are you?"
      ├── [UUID: c3d4] text: "What is your name?"
      └── [UUID: e5f6] text: "Nice to meet you."
```

自有参数出现在组级别，对组内所有子 Section 生效。内部展开逻辑（由 Section 开发者编写）负责将自有参数和每个子 Section 的参数合并后传入子 Section。

## 二、嵌套与参数树

Section 嵌套可以任意深度。每一层的参数 schema 都由 `子 Section 的 from_child` + `自有参数` 自动构成。

一个更复杂的例子：

```
复合 Section: 快速应答单题
  参数: { question: string, audio?: file }

复合 Section: 快速应答组
  from_child: 快速应答单题
  自有参数: { prepSeconds: number, recordSeconds: number }

  // 参数 schema:
  // {
  //   own: { prepSeconds, recordSeconds },
  //   children: { question: string, audio?: file }[]
  // }
```

再往上组合成一张试卷：

```
根 Section: 试卷
  from_child: 朗读句子组
  from_child: 快速应答组
  自有参数: { title: string }

  // 参数 schema:
  // {
  //   own: { title: string },
  //   children_朗读句子组: { own: { prepSeconds, recordSeconds }, children: { text }[] }[],
  //   children_快速应答组: { own: { prepSeconds, recordSeconds }, children: { question, audio? }[] }[]
  // }
```

教师在试卷编辑器中看到的完整参数树：

```
试卷
  ├── title: "2024 高考英语听说模拟"
  │
  ├── ▼ 朗读句子组 [0]
  │   ├── prepSeconds: 3
  │   ├── recordSeconds: 10
  │   └── children:
  │       ├── [UUID: a1] text: "Hello"
  │       ├── [UUID: b2] text: "Good morning"
  │       └── [UUID: c3] text: "How are you?"
  │
  ├── ▼ 朗读句子组 [1]        ← 同一试卷可添加多个同类型 Section 组
  │   ├── prepSeconds: 5
  │   ├── recordSeconds: 15
  │   └── children:
  │       ├── [UUID: d4] text: "Nice weather today"
  │       └── [UUID: e5] text: "See you tomorrow"
  │
  └── ▼ 快速应答组 [0]
      ├── prepSeconds: 2
      ├── recordSeconds: 8
      └── children:
          ├── [UUID: f6] question: "What is your favorite color?", audio: [文件]
          └── [UUID: g7] question: "Where do you live?", audio: [TTS]
```

教师可以随时在试卷中**新增一个 Section 组**（如再加一个朗读句子组），也可以在任何组内**增删 children 条目**。整个参数树可以自由折叠展开。

## 三、参数类型

| 类型 | 使用场景 | UI |
|------|---------|-----|
| `string` | 文本内容 | 文本框 / 多行文本框 |
| `number` | 秒数、分数 | 数字输入框 |
| `file` | 图片、音频、视频 | 文件选择器（支持上传和剪贴板粘贴） |
| `object` | 含子字段的复合参数 | 可折叠分组 |
| `list<T>` | 自有参数中的可重复列表 | 可增减条目列表 |

`from_child` 实际上就是一种特殊的 `list`——但列表的 schema 不由当前 Section 声明，而是从子 Section 推导。

## 四、内置 Section 库

系统预置一组基础 Section 类型：

| Section | 参数 | 描述 |
|---------|------|------|
| 朗读单句 | `text: string` | 一句朗读内容 |
| 快速应答单题 | `question: string`, `audio?: file` | 一个问答对 |
| 看图说话单题 | `image: file` | 一张图片的描述任务 |
| 听力选择单题 | `audio: file`, `question: string`, `options: string[]`, `answer: number` | 一道听力选择题 |
| 信息提示 | `content: ContentNode[]` | 纯展示信息（不答题） |

以及内置的复合 Section（多个单题的组合 + 时间配置）：

| Section | from_child | 自有参数 |
|---------|-----------|---------|
| 朗读句子组 | 朗读单句 | `prepSeconds`, `recordSeconds` |
| 朗读短文组 | 朗读单句 × 1 | `passage: string`, `prepSeconds`, `recordSeconds` |
| 快速应答组 | 快速应答单题 | `prepSeconds`, `recordSeconds` |
| 看图说话组 | 看图说话单题 | `prepSeconds`, `recordSeconds` |
| 情景问答组 | 快速应答单题 | `scenario: string`, `prepSeconds`, `recordSeconds` |

注意：`朗读短文组` 的 `from_child` 是**单个**而不是列表——只有一道朗读题，但参数是整段短文文本。内部展开为：展示全文（准备）→ 朗读录音。

## 五、自定义 Section

教师可以将试卷中的 Section 组保存为自定义 Section。保存后，该 Section 的结构（子 Section 组成 + 自有参数 + 默认值）被记录下来，下次新建试卷时可以直接使用。

- 保存范围：可选中单个 Section 组，也可选中多个 Section 组一起保存
- 保存后出现在 Section 库的"自定义"分类中
- 自定义 Section 可导入导出，在不同电脑间共享

## 六、试卷状态

| 状态 | 含义 |
|------|------|
| 编辑中 | 正在编辑，未完成 |
| 就绪 | 编辑完成，可用于考试 |

草稿 = 编辑中的试卷。模板 = 可复用的就绪试卷 + 自定义 Section。不再有独立的草稿或模板概念。

新建试卷时：
- **空白创建**：空试卷，逐步添加 Section 组
- **从已有试卷复制**：复制 Section 结构和参数默认值，修改具体内容
- **从自定义 Section 开始**：选一个自定义 Section 作为起点

## 七、出卷流程

```
试卷列表 → 新建试卷
  ├── 空白创建 → 添加 Section 组（从库中选择类型）
  ├── 从已有试卷复制
  └── 从自定义 Section 开始

→ 在参数树中填写内容
→ 随时可预览（以学生视角播放，不录音）
→ 完成编辑 → 试卷标记为就绪
→ 可导出为文件，供其他电脑使用或学生考试
```

## 八、与原设计的关键区别

| 原设计 | 新设计 |
|--------|--------|
| 父 Section 需手动声明 `texts: string[]` 然后循环绑定 | 父 Section 声明 `from_child: 朗读单句`，参数自动推导为 `children: { text }[]` |
| 参数映射逻辑在 JSON 模板中以 `{{占位符}}` 实现 | 参数穿透由 Section 引擎自动完成，Section 作者只需声明 from_child |
| 每个层级都需要显式声明完整参数 | 参数树从子 Section 向上自动拼合 |
| 模板、草稿、试卷三者分离 | 草稿 = 编辑中的试卷，模板 = 可复用的就绪试卷或自定义 Section |
