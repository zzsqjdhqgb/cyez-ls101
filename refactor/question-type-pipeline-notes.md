# 题目评分管道、Schema 与资源设计（当前草案）

> 本文整理 2026-08-09 的讨论结论，用于统一 Schema、Template、ExamPlayer 与 Grading Engine 之间的概念边界。
> Schema 领域模型、Template 编译期 TTS 资源生成、完整 ExamPlayer UI 和播放器内的最终归档组装已按本文实现。Grading Engine 仍待实现。

## 一、评分管道

Schema 只使用以下三种题型区分评分管道：

```text
objective | fixed-reading | freetalk
```

这里的题型描述评分所需的数据结构和处理流程，不是考试中的表面名称。

- `objective`：学生提交一个字符串，Grading Engine 将它与题目提供的“解析”字符串直接比较。
- `fixed-reading`：学生提交一条或多条录音，每条录音都有对应的固定朗读文本。
- `freetalk`：学生提交一条或多条录音，不存在需要逐字对应的固定朗读文本。

“朗读词组”“朗读句子”“朗读短文”都可以使用 `fixed-reading`。“复述”“看图说话”“话题表达”“情景应答”等都可以使用 `freetalk`。这些表面形式的区别由 Template 流程、题目输入和评分数据表达，不继续扩展第一层题型枚举。

`fixed-reading` 和 `freetalk` 同时兼容人工评分与 AI 评分。评分方式不固化在 Schema 中，而是在开始一次批改时选择：

```text
同一份已解析 Schema 数据
  ├── human
  └── ai
```

`objective` 当前固定使用字符串直接比较，不进入人工或 AI 评分流程。

## 二、Schema 与评分单元

一个正式 Schema 定义一种可复用的评分单元。旧设计中的 `blocks` 和 `blockId` 删除，不再允许一个 Schema 内包含多种评分块。

Template 通过 `SchemaUse` 多次使用同一个正式 Schema。一次 `SchemaUse` 就是试卷中的一个实际评分单元，并且只产生一份评分结果。

例如，两句朗读句子一起评分时，一个 Schema 的答案格式包含两个固定语音槽位，每个槽位分别绑定朗读原文和学生录音。如果两句分别评分，Template 创建两次 `SchemaUse`。

正式 Schema 至少包含：

```text
PublishedSchema
  ├── schemaId
  ├── revision
  ├── questionType
  ├── answerFormat
  ├── templateInputs
  ├── maxScore
  └── gradingData
```

- `schemaId` 是正式 Schema 的稳定身份。
- `revision` 在正式 Schema 的可编辑数据保存后递增。
- `questionType` 决定评分管道。
- `answerFormat` 定义学生答案槽位及其顺序。
- `templateInputs` 定义 Template 必须提供的静态题目输入。
- `maxScore` 是该评分单元的满分。
- `gradingData` 保存答案槽位与自定义输入的显示说明、评分标准、AI 额外提示词等可编辑题型数据。内置输入的说明由系统固定提供。

正式 Schema 不再使用内容哈希作为唯一身份，因为正式数据允许继续修改。发布和每次修改仍应保存 revision 或内容哈希，以便 Template 编译时记录并校验使用的准确快照。

## 三、答案格式

答案格式是一个有序列表。每个答案槽位具有稳定 ID：

```text
AnswerDefinition
  ├── answerId
  └── type: text | fixed-speech | free-speech
```

- `answerId` 用于 Template 绑定，正式 Schema 发布后不可修改。
- `type` 是答案的语义类型，正式 Schema 发布后不可修改。
- 列表顺序是答案的评分顺序，正式 Schema 发布后不可修改。
- 答案的显示说明保存在正式 Schema 的可编辑数据中，不参与结构哈希。

例如，两句朗读句子合并评分：

```text
answerFormat:
  - answerId: sentence-1
    type: fixed-speech
  - answerId: sentence-2
    type: fixed-speech

answerDescriptions:
  sentence-1: 朗读句子第一句
  sentence-2: 朗读句子第二句
```

三种答案类型分别展开为固定的输入槽位：

```text
text
  └── text: 学生提交的文本

fixed-speech
  ├── text: Template 提供的固定朗读原文
  └── audio: 学生提交的录音

free-speech
  └── audio: 学生提交的录音
```

`fixed-speech` 本身就是一个复合答案类型，因此不需要额外使用 `readingTextInputId` 或映射表关联原文和录音。同一个 `answerId` 下的 `text` 与 `audio` 天然属于同一条固定语音答案。

当前三类题型允许的答案格式为：

| 题型            | 答案格式                        |
| --------------- | ------------------------------- |
| `objective`     | 恰好一个 `text`                 |
| `fixed-reading` | 一个或多个有序的 `fixed-speech` |
| `freetalk`      | 一个或多个有序的 `free-speech`  |

答案槽位是 Schema 中的语义对象，学生文本和录音是 ExamPlayer 的运行期对象。Template 按 `answerId` 绑定各个子槽位，Schema 不直接依赖 `recordIndex` 或选择题索引。Template 时间线中的 TTS 文本在编译期生成音频并进入 ExamPackage；ExamPlayer 只播放编译后的音频资源，不在考试时执行 TTS。

## 四、Template 输入契约

除了答案格式，评分还需要题目描述、评分材料等静态文本。Schema 向 Template 暴露文本输入字段，每个字段具有稳定 ID 和显示说明：

```text
TemplateInputDefinition
  ├── inputId
  ├── type: text
  └── required
```

`text` 可以是普通文本或 Markdown。Schema 不声明 `image`、`file` 或静态 `audio` 输入；图片、附件和其他文件通过每次 SchemaUse 的动态附件列表进入文本参数，见第六节。

自定义输入的显示说明保存在正式 Schema 的可编辑数据中，不参与结构哈希。内置输入的说明由系统固定提供：`question-description` 为“题目描述”，客观题的 `analysis` 为“解析”；二者不重复写入正式 Schema 数据。

所有题型默认包含题目描述 `text` 输入。Schema 还可以根据评分需要声明参考答案、评分材料或其他文本输入。

### 4.1 `objective`

客观题至少包含：

- 题目描述。
- `解析`，类型为 `text`。
- 一个类型为 `text` 的答案槽位。
- `maxScore`。

`解析` 是 Template 提供的题目输入，也是当前客观题的直接比较目标。学生答案与 `解析` 使用字符串直接比较；相同则得到 `maxScore`，不同则得到零分。当前不增加标准化、模糊匹配或其他解析规则。

目前没有多选题需求，因此客观题只处理一个字符串答案。以后出现多选题时，可以在客观题的 `gradingData` 中增加少选扣分或直接计零分等评分机制；当前不预留这些字段。

### 4.2 `fixed-reading`

固定朗读题至少包含：

- 题目描述。
- 评分标准。
- 一个或多个 `fixed-speech` 答案槽位；每个槽位同时要求固定朗读文本和学生录音。
- `maxScore`。
- AI 评分使用的额外提示词，可以为空。

固定朗读文本由 Template 绑定到 `fixed-speech.text`，学生录音绑定到同一答案的 `fixed-speech.audio`。Grading Engine 逐条处理时直接取得同一个答案对象中的原文和录音。

### 4.3 `freetalk`

自由表达题至少包含：

- 题目描述。
- 评分标准。
- 一个或多个 `free-speech` 答案槽位；每个槽位只要求学生录音。
- `maxScore`。
- AI 评分使用的额外提示词，可以为空。

`freetalk` 可以使用参考答案、图片、情景背景或其他辅助材料，但不存在与录音逐字对应的固定朗读文本。

## 五、Schema 草稿库与正式 Schema

Schema 同时具有草稿和正式版本机制，但这里的“正式”不表示全部内容永久不可修改。

### 5.1 草稿库

草稿库是可持续编辑的工作文档：

```text
SchemaDraftLibraryDocument
  ├── libraryId
  ├── revision
  └── structures[]
```

草稿库中的条目主要定义结构，不要求填写完整的评分数据。结构至少包括题型、答案槽位的 ID、类型和顺序，以及 Template 输入契约。

草稿结构可以继续编辑。同一份草稿结构可以发布任意多个正式 Schema，用于创建共享答案格式但评分标准、提示词、名称或满分不同的评分方案。

### 5.2 正式 Schema

每次从草稿结构发布都会创建一个新的正式 Schema，并分配独立、稳定的 `schemaId`。正式 Schema 保存发布时的结构快照，并补齐 `maxScore`、评分标准和其他题型数据。

正式 Schema 发布后：

- 答案槽位的 `answerId`、类型和顺序不可修改。
- 正式 Schema 的题型不可修改。
- 名称、描述、`maxScore`、评分标准和 AI 额外提示词等数据可以修改。
- 每次修改递增 `revision`。
- 从同一草稿结构发布的多个正式 Schema 互相独立，修改一个不会修改其他正式 Schema。

Template 只保存稳定的 `schemaId`，不保存 Schema revision，也不内嵌正式 Schema 数据。正式 Schema 的结构已经冻结，因此修改正式数据不会要求修改 Template 的输入或答案绑定。

编译 Template 时，根据 `schemaId` 读取该正式 Schema 的最新 revision，并将当时的完整快照写入 ExamPackage。正式 Schema 后续修改不会改变 Template 文档或已经生成的 ExamPackage；以后重新编译同一 Template 时，新 ExamPackage 会使用修改后的满分、评分标准和提示词等数据。

### 5.3 正式 Schema 的不可变结构

Template 会通过 `inputId` 绑定 Schema 的静态输入，因此修改正式 Schema 的输入 ID 或类型会使现有 Template 失效。`templateInputs` 的 ID、类型和必要性属于正式 Schema 的不可变结构；显示说明仍可修改。

正式 Schema 发布后，以下结构统一冻结：

- `questionType`。
- 答案槽位的 ID、类型和顺序。
- Template 输入的 ID、类型和必填性。

名称、显示说明、`maxScore`、评分标准和 AI 额外提示词不属于绑定契约，可以继续修改。

## 六、Template 资源模型

Schema 不声明图片或文件字段。资源由 Template 在每一次 SchemaUse 上动态配置，并在编译时进入 ExamPackage。

### 6.1 SchemaUse 附件列表

Template 编辑器中的 SchemaUse 配置区域提供一个可以任意增删的附件列表。每个附件项包含一个局部名称和一个 `file` 类型的 Template 值：

```text
SchemaUse
  ├── schemaId
  ├── inputBindings
  ├── answerBindings
  └── attachments[]
        ├── varName
        ├── description
        └── file: FileExpression
```

- `varName` 遵循 Template 变量命名规则，并在当前 SchemaUse 内唯一。
- `file` 可以绑定 Template 文件、Interface 产生的资源或其他合法的 `file` 变量。
- Schema 本身不知道附件数量，也不预先声明附件名称。
- 附件只属于当前 SchemaUse 的配置作用域，不自动暴露给其他 SchemaUse。

底层编译器可以按内容去重相同文件，但这不改变各 SchemaUse 的作用域边界。

### 6.2 附件变量

每个附件项在当前 SchemaUse 的输入参数中生成一个只读局部变量。附件项的 `file` 表达式先从外部作用域取得一个 `file` 类型变量，再由 Template 编译器收集资源并生成编译后的文件地址。

Template 变量作用域约定如下：

- `[@varname]`：引用外部作用域中已有的变量，例如 Interface 或 Template 当前作用域中的 `file` 变量。
- `[@this.varname]`：引用当前 SchemaUse 附件列表产生的局部变量。`this` 是 SchemaUse 的保留作用域名。

因此 `this` 同时是 Template 全局保留的 Interface alias，不能用于声明 Interface requirement，避免 Schema 文本在格式化再解析后改变引用含义。

例如：

```text
attachments:
  - varName: question-image
    file: [@img1]

questionDescription:
  "请根据图片回答：![校园]([@this.question-image])"
```

这里 `[@img1]` 是外部的 `file` 类型变量，`[@this.question-image]` 是当前 SchemaUse 附件编译后的地址。后者只允许在这次 SchemaUse 的题目描述、参考答案、评分材料等参数中使用，不自动暴露给其他 SchemaUse。Template 编辑器需要为 Markdown 编辑提供插入 SchemaUse 附件变量的能力，而不是要求作者手写最终文件路径。

这意味着图片、音频或普通附件都使用同一种 `file` 附件机制。文件的媒体类型由文件元数据判断，不进入 Schema 的输入字段枚举。

### 6.3 编译与地址解析

Template 编译器负责：

1. 求值每个附件项的 `file` 表达式。
2. 收集文件并写入 ExamPackage 的资源区域。
3. 为文件生成在 ExamPackage 中稳定且无冲突的地址。
4. 将 SchemaUse 局部附件变量解析为该地址。
5. 保证 ExamPlayer、Markdown 渲染器和 Grading Engine 能通过同一地址读取文件。

地址不能依赖作者机器的绝对路径。Schema 和 Template 共同使用逻辑资源 URI 加统一 resolver，不使用相对于某个磁盘目录的持久化路径。

持久化契约优先保存逻辑地址或资源键；如果某个运行环境需要绝对文件路径，应由加载 ExamPackage 的资源解析器在运行时转换，不把环境相关绝对路径写入 Template 或 Schema 数据。

逻辑地址契约为：

```text
SchemaUse 附件变量值: resource:<assetKey>

ExamPackage.resources:
  <assetKey> -> 文件元数据和包内存储位置

ExamPlayer / Markdown Renderer / Grading Engine:
  resolve(resource:<assetKey>) -> 当前环境可读取的 URL 或文件路径
```

这样 Schema 和 Template 只需要共同遵守逻辑地址及资源清单契约，不需要共同假设 ExamPackage 一定已经解压到某个目录。

Schema 只消费附件变量已经解析后的文本参数，不参与文件导入、打包或物理路径计算。

## 七、ExamPackage

ExamPackage 是 Template 编译器生成、供 ExamPlayer 直接执行的考试包。目标结构由考试数据、答案捕获计划和作答包副本三部分组成：

```typescript
interface ExamPackage {
  format: 'ls101-exam'
  formatVersion: 1
  packageId: string

  examData: {
    title: string
    player: PlayerExamData
    resources: ExamResourceManifest
  }

  answerCapturePlan: AnswerCapturePlan
  submissionTemplate: SubmissionTemplate
}
```

`examData` 只负责播放器展示和考试流程。`answerCapturePlan` 指导播放器把选择题和录音输出写入作答包的答案池：

```typescript
interface AnswerCapturePlan {
  strings: Array<{
    stringAnswerIndex: number
    choiceIndex: number
  }>

  audios: Array<{
    audioAnswerIndex: number
    recordIndex: number
  }>
}
```

`choiceIndex` 和 `recordIndex` 只属于播放器运行期。`stringAnswerIndex` 和 `audioAnswerIndex` 属于最终 SubmissionPackage，并由 SchemaUse 快照引用。每类答案索引必须从零开始连续分配，捕获计划中不得出现重复的目标索引或来源索引。

`submissionTemplate` 是 Template 编译器生成的作答包副本，包含所有编译期已经确定的批改数据：

```typescript
interface SubmissionTemplate {
  format: 'ls101-submission'
  formatVersion: 1

  meta: {
    examPackageId: string
    examTitle: string
  }

  schemaUses: SubmissionSchemaUse[]

  // 仅包含独立批改所需的静态资源。
  resources: SubmissionResourceManifest
}
```

这里的“副本”是最终 SubmissionPackage 中所有编译期可确定字段的完整静态部分，而不是需要播放器再次解释的中间模型。ExamPlayer 不读取或解释 `schemaUses`：它复制 `submissionTemplate`，按 `answerCapturePlan` 生成答案池，并向 `meta` 补充 `submissionId`、考生身份和考试时间。

ExamPackage 的规范解压目录使用 `manifest.json` 作为入口，资源按照 `examData.resources[*].packagePath` 写入：

```text
manifest.json
resources/<assetKey>/<filename>
```

ZIP 只是该目录的传输形式。归档读取器严格校验 index、播放器数据、捕获计划、SchemaUse、资源引用和归档内文件集合。页面图片等播放器资源全部进入考试包；只有评分快照实际需要的 SchemaUse 附件进入 `submissionTemplate.resources`。

播放器页面中的 `image` 块、时间线 `play` 音频与 SchemaUse Markdown 附件是不同的消费者，但共同使用 `resource:<assetKey>` 逻辑地址。页面图片和播放音频的资源键必须存在于 `examData.resources`；`examData.resources` 和 `submissionTemplate.resources` 都只允许指向考试包内的 `resources/` 静态资源目录。

## 八、SubmissionPackage

SubmissionPackage 是完全独立、可以直接进入批改流程的作答存储结构。它不包含完整 ExamPackage，而是保存三类业务数据：考试及考生元数据、字符串和音频答案，以及每个 SchemaUse 的完整批改快照。批改快照和音频答案所引用的文件随作答归档一起保存。

```typescript
interface SubmissionPackage {
  format: 'ls101-submission'
  formatVersion: 1

  meta: {
    submissionId: string
    examPackageId: string
    examTitle: string

    candidate: {
      candidateId: string
      displayName: string
    }

    startedAt: string
    submittedAt: string
  }

  answers: {
    strings: Array<string | null>
    audios: SubmissionAudioAnswer[]
  }

  schemaUses: SubmissionSchemaUse[]
  resources: SubmissionResourceManifest
}
```

`startedAt` 和 `submittedAt` 使用 ISO 8601 字符串。当前 SubmissionPackage 只表示一次正式完成的提交；中途保存、断点恢复和未完成 Attempt 暂不实现。

字符串答案按 `stringAnswerIndex` 存入 `answers.strings`。`null` 表示未作答，避免与真实字符串混淆。当前客观题的实际答案是选项标签字符串，例如 `"A"`。

音频答案按 `audioAnswerIndex` 存入 `answers.audios`：

```typescript
interface SubmissionAudioAnswer {
  resourceKey: string
  durationMs: number
}
```

### 8.1 SchemaUse 批改快照

`schemaUses` 中的每一项严格对应一次展开后的 SchemaUse，也是一个独立评分单元：

```typescript
interface SubmissionSchemaUse {
  instanceId: string

  // 完整正式 Schema 快照，不需要查询 Schema 仓储。
  schema: SchemaDefinition

  // Template 编译时已经解析完成的题目输入。
  inputs: CompiledSchemaInput[]

  // 编译期内容直接保存，学生答案只保存答案池索引。
  answers: SubmissionSchemaAnswer[]
}
```

三种答案引用如下：

```typescript
type SubmissionSchemaAnswer =
  | {
      answerId: string
      type: 'text'
      stringAnswerIndex: number
    }
  | {
      answerId: string
      type: 'fixed-speech'
      text: string
      audioAnswerIndex: number
    }
  | {
      answerId: string
      type: 'free-speech'
      audioAnswerIndex: number
    }
```

`answers` 必须与 `schema.structure.answerFormat` 一一对应：同一个 SchemaUse 中的 `answerId` 不得重复或缺失，ID 集合及各项类型必须与 Schema 定义完全一致。允许复用的是答案池索引，而不是 `answerId`；不同的答案槽位可以引用相同的 `stringAnswerIndex` 或 `audioAnswerIndex`，表示它们消费同一份学生作答。

因此固定语音的原文直接保存在 SchemaUse 快照中，学生录音通过 `audioAnswerIndex` 取得：

```typescript
{
  answerId: 'sentence-1',
  type: 'fixed-speech',
  text: 'The weather is beautiful today.',
  audioAnswerIndex: 0
}
```

批改系统处理某个列表项时，已经能够直接取得完整 Schema、题目输入、固定朗读文本和学生答案，不需要 ExamPackage、Template、Schema 仓储或播放器索引映射。

### 8.2 Submission 资源

SubmissionPackage 的 JSON 数据不直接内嵌音频或其他二进制文件。答案和 SchemaUse 输入通过资源键引用归档中的文件：

```typescript
type SubmissionResourceManifest = Record<
  string,
  {
    filename: string
    packagePath: string
    mediaType?: string
  }
>
```

`resources` 同时包含：

- `answers.audios` 引用的学生录音。
- SchemaUse 输入中 `resource:<assetKey>` 引用的、独立批改所需的静态附件。

静态附件的 `packagePath` 必须位于 `resources/`，学生录音必须位于 `recordings/`。最终 SubmissionPackage 的资源清单可以同时包含两类路径；SchemaUse 的逻辑资源引用只能指向静态附件，`answers.audios` 的资源键只能指向录音。当前契约不要求录音资源与音频答案一一对应：是否允许多个音频答案共享录音、是否保留未引用录音，留给后续业务规则决定。

Template 编译器负责识别 SchemaUse 批改快照所需的静态资源，将清单写入 `submissionTemplate.resources`，并把文件收入 ExamPackage 归档。组合作答包时，ExamPlayer 复制该资源清单并加入新录音的资源项，不解析 SchemaUse 文本；播放器使用加载预检时已经取得的静态文件和本次录音生成完整作答归档 Blob。

Submission 归档布局固定为：

```text
manifest.json
resources/<assetKey>/<filename>
recordings/<resourceKey>/<filename>
```

`manifest.json` 直接保存 `SubmissionPackage` JSON。归档中必须恰好包含 `resources` 清单引用的文件，不允许缺失文件、未知文件、重复路径或目录穿越路径。

播放器在组包时为新录音生成资源键、文件名、包内路径和媒体类型，使 SubmissionPackage 清单满足契约。播放器随后将清单、加载预检时取得的静态附件和新录音编码为完整作答归档 Blob，并通过完成回调返回。宿主只负责持久化、下载或上传 Blob。只有清单和它引用的全部文件共同组成可独立批改的最终作答归档。

### 8.3 不属于 SubmissionPackage 的数据

SubmissionPackage 只保存不可变的原始作答证据和编译期批改快照，不保存：

- SchemaUse 的二次解析结果。
- ASR 文本。
- 语音纠错结果。
- AI 调用状态。
- 分数和评语。

这些数据属于后续独立的 GradingRecord。GradingRecord 通过 `submissionId` 引用正式作答包，修改批改结果不会改变原始 SubmissionPackage。

## 九、运行期数据流

```text
正式 Schema 定义评分结构、题型数据、答案格式和输入契约
                              ↓
Template 填充静态题目输入，并按 ID 绑定运行期答案槽位
                              ↓
Template 编译器生成考试数据、答案捕获计划和 SubmissionTemplate
                              ↓
ExamPlayer 播放考试，按答案捕获计划记录字符串和音频
                              ↓
复制 SubmissionTemplate，加入考试元数据和学生答案
                              ↓
Grading Engine 逐项读取 SubmissionPackage.schemaUses
                              ↓
选择 human 或 ai，并输出评分结果
```

ExamPlayer 不知道 Schema 的结构和评分含义。Grading Engine 不需要重新取得或匹配 ExamPackage；SubmissionPackage 中的每个 SchemaUse 快照已经是完整评分输入，只需按索引从答案池取得学生作答。

## 十、评分流程

### 10.1 客观题

```text
学生答案字符串 + 解析字符串
             ↓ 直接比较
        maxScore 或 0
             ↓
          评分结果
```

客观题当前不调用语音纠错系统、文本 LLM 或人类评分流程。

### 10.2 人工评分

```text
题目输入 + 评分标准 + 有序答案列表 + maxScore
                         ↓
                    人类评分者
                         ↓
                      评分结果
```

人工评分不要求执行语音纠错，也不要求先把录音转换成文本。评分者需要能够访问当前评分单元的全部输入和答案。

### 10.3 AI 评分

```text
每条音频答案 ──→ 语音纠错系统 ──→ 该条答案的自然语言纠错结果
                                             │
题目输入 + 评分标准 + ASR 文本 + 有序纠错结果 + 额外提示词 + maxScore
                                             ↓
                                        文本 LLM
                                             ↓
                                          评分结果
```

语音纠错结果是 Grading Engine 的内部中间结果，不属于 Schema 输入，也不写回题目数据。

语音处理阶段必须遵守以下规则：

- 每条音频答案单独调用语音纠错系统，不能先合并音频。
- `fixed-reading` 为每条音频同时传入其对应的固定朗读文本。
- `freetalk` 不向语音纠错系统传入固定朗读文本。
- 每条音频的 ASR 文本和纠错结果必须与答案格式保持相同顺序。
- 文本 LLM 最后一次性接收整个评分单元的有序结果并完成评分。

音频答案在 Schema 数据中只表现为资源引用。ASR 和语音纠错都由 Grading Engine 内部处理。

## 十一、评分输出

所有题型及评分方式都只输出分数和评语：

```text
GradingResult
  ├── score: number
  └── comment: string
```

- `score` 必须满足：

```text
0 <= score <= maxScore
```

- `comment` 是 Markdown 字符串。人工评分时由评分者填写，AI 评分时由文本 LLM 生成。
- 客观题也返回同一个结构；其评语由客观题评分管道生成。

结构校验失败、资源缺失、模型调用失败等执行错误通过评分调用的失败通道表达，不混入正常评分结果。

## 十二、当前状态

本文涉及的 Schema 结构、发布机制、Template 绑定、附件变量、资源地址、ExamPackage、SubmissionPackage 和评分输出均已确认。Schema、Template 编译期 TTS、完整 ExamPlayer、播放器内的作答归档组装和 v1 ZIP 归档读写已经实现；静态部署规范统一使用 `manifest.json` 作为解压目录入口。主应用的试卷库与考试启动路由和 Grading Engine 仍待后续开发。
