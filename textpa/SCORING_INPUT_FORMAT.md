# 通用英语口语评分输入格式

本文定义面向上海英语听说练习及相似题型的版本化输入样本。当前只固定数据协议，
不改变现有 TextPA 的评分提示词或分数逻辑。

规范文件是 [`schemas/scoring-sample.schema.json`](schemas/scoring-sample.schema.json)，
三个仅用于展示格式的样本见
[`examples/scoring-samples.jsonl`](examples/scoring-samples.jsonl)。
其中的音频路径是格式占位符，不能直接运行。

## 文件约定

- 数据集使用 UTF-8 JSONL，每行一个完整样本。
- `schema_version` 当前固定为 `1`。
- `id` 在一个数据集中必须唯一，并且不应复用考生姓名或身份证号。
- 现有 `textpa transcribe` 会把音频 basename 当作 `id`；在接入 JSONL adapter
  前，建议本格式也采用同一个 basename，便于按 ID 合并结果。
- `audio_path` 推荐使用相对于数据集目录的路径；不要写入临时绝对路径、API key
  或带鉴权参数的 URL。
- 可选的 `audio` 对象可以记录 `sha256`、时长、采样率和声道数，用于复核文件是否
  被替换；它不取代当前链路使用的 `audio_path`。
- 每条样本必须且只能提供 `rubric_ref` 或内联 `rubric` 之一。前者适合正式数据集，
  后者适合单条调试；不能同时提供两者，以免版本冲突。
- 原始样本、声学派生数据和人工标签可以在归档时位于同一个对象中，但模型评分
  建议写入独立的 `assessment` 文件，绝不覆盖 `labels`。
- 尚未生成的可选字段直接省略；空数组表示已经检查但没有事件。不要用空字符串
  伪装缺失数据。

主要顶层字段如下：

| 字段                                    | 来源      | 说明                                      |
| --------------------------------------- | --------- | ----------------------------------------- |
| `schema_version`                        | 人工      | 数据协议主版本                            |
| `id`                                    | 人工      | 一次作答的匿名唯一 ID                     |
| `audio_path` / `audio`                  | 人工/采集 | 音频路径及可选文件元数据                  |
| `task`                                  | 题库      | 题型、题目、参考信息和时限                |
| `rubric_ref` / `rubric`                 | 评分配置  | 必须二选一：外部细则引用或内联细则        |
| `transcript`、`phonemes_*`、`alignment` | 处理链路  | 当前 TextPA 兼容字段                      |
| `derived`                               | 处理链路  | 时间戳、流利度事件、指标和模型 provenance |
| `labels`                                | 人工评分  | 仅供校准和评测，推理输入不应提供          |

## 处理阶段

同一个 schema 支持三种阶段，字段逐步增加：

| 阶段     | 必需字段                                                       | 生成方               |
| -------- | -------------------------------------------------------------- | -------------------- |
| 原始样本 | `schema_version`、`id`、`audio_path`、`task`、一种 rubric 字段 | 题库或数据整理人员   |
| 声学证据 | 原始样本 + `transcript`、`phonemes_cmu`、`phonemes_ipa`        | ASR/音素/流利度链路  |
| 标注样本 | 原始或声学样本 + `labels`                                      | 人工评分者和仲裁流程 |

当前 `textpa assess` 真正读取的仍是 `id`、`transcript`、`phonemes_cmu` 和
`phonemes_ipa`。它会忽略本文新增的 `task`、`rubric_ref`、`rubric`、`derived`
和 `labels` 字段；后续内容评分接入时再消费这些字段。

当前 `textpa transcribe` 接收音频文件路径而不是本 JSONL，也不会自动把 `task`
复制到输出。现阶段应先对 `audio_path` 运行声学命令，再按相同 `id` 把 transcript
和音素字段合并回原始样本；专用 adapter 后续再实现。合并后的
`transcript`、`phonemes_cmu`、`phonemes_ipa` 必须同时存在或同时缺失，避免产生
无法交给 `textpa assess` 的半成品。

## 与真人评分的关系

自动评分需要的信息并不全是机器额外创造出来的。真人评分员同样会使用题目、
材料、参考内容和评分细则，只是可以通过听觉、上下文和经验隐式理解；自动系统
必须把这些信息显式保存并做版本管理。

| 信息层次 | 例子                                             | 与题目的关系             | 所属模块           |
| -------- | ------------------------------------------------ | ------------------------ | ------------------ |
| 作答事实 | 音频、考生回答、作答时间                         | 每次作答不同             | 真人和自动批改共用 |
| 题目事实 | 题干、图片、前置音频、朗读原文、参考答案、关键点 | 绑定具体题目             | 题库               |
| 评分规则 | 分数范围、评价维度、挡位描述、反馈要求           | 可跨题目复用             | 批改配置           |
| 题型策略 | 如何处理朗读、复述、Free Talk 或对话             | 绑定题型，不绑定具体题目 | 自动评分内部配置   |
| 声学证据 | 转写、音素、停顿、重复、时间戳                   | 每次作答生成             | 自动评分处理链路   |
| 运行信息 | 模型、提示词、参数、重试、状态和版本             | 与题目无关               | 自动评分运行环境   |
| 批改结果 | 总分、分项分、评语和证据                         | 每次评分生成             | 真人和自动批改共用 |

真正相对真人批改新增的系统数据主要有三类：

- 机器生成的中间证据，例如 transcript、IPA、CMU、停顿和重复事件。
- 保证结果可复现的 provenance，例如 ASR、音素模型、LLM、提示词和配置版本。
- 异步任务状态，例如等待、处理中、重试、失败和完成，以及对应的错误信息。

`task`、`reference` 和 rubric 本身不是机器专用信息；它们只是把真人原本隐式使用的
信息结构化。人工评分界面可以继续直接展示题目和音频，不需要向评分员展示音素、
模型参数或重试状态。

## 配置分层

为了让真人批改模块和自动评分共用数据，不能把所有选项都放进一个宽泛的“批改
配置”。推荐区分以下三种可版本化配置：

### 批改配置（GradingConfig）

这是用户可以选择、与具体题目无关的教学和评分政策，对应本格式中的
`rubric_ref` 或内联 `rubric`。适合包含：

- 评分维度，例如内容、语法、发音、流利度和总分。
- 分数范围、步长和各挡位自然语言描述。
- 是否输出分项分、总分和详细反馈。
- 反馈语言、反馈详细程度和评分严格程度。
- 可选的校准样本集引用。

校准样本不能默认跨所有题型通用。批改配置引用校准集时，应同时声明兼容的 rubric
版本和题型；例如朗读锚点不应直接用于 Free Talk。

### 题型配置（TaskProfile）

这是绑定题型、但不绑定某一道具体题目的自动评分策略，对应
`task.profile_id/profile_version`。它可以由系统根据 `task.type` 自动选择，不必成为
老师每次批改时的额外选项。适合包含：

- 该题型允许或要求的 `reference.mode`。
- 应使用哪些证据，以及内容、发音和流利度证据如何组织给 LLM。
- 题型专用的提示词片段、输出要求和分数解释。
- 该题型对题目材料、上下文、角色或事件顺序的要求。
- 必要时对通用 rubric 的题型级限制或映射。

声学处理本身可以在英语题型间复用，但内容判断不能完全相同。例如朗读必须比较
`expected_text`，复述需要关键事件与顺序，Free Talk 则需要判断是否回应并展开了
题目。这个差异属于 TaskProfile，而不是通用批改配置。

### 评分引擎配置（EngineProfile）

这是纯系统运行配置，不应混入面向老师的批改配置。它包括 Whisper、音素模型和
LLM 的名称与 revision、思考深度、提示词实现版本、并发、超时、429 重试和缓存
策略。更换 EngineProfile 不应改变题目事实或人工评分标签，但必须记录到自动评分
结果的 provenance 中。

## 先做真人批改时的兼容要求

如果先实现真人批改模块，再接入自动评分，建议从一开始保留以下能力：

- `Question` 不只保存展示题干，还能保存 `task.type`、stimuli 和结构化 reference。
- 一次 `Attempt` 可以拥有多条独立 `Assessment`，不能用新的机器结果覆盖人工结果。
- `Assessment` 标明 `grader_type`，例如 `human`、`automatic` 或 `adjudicated`。
- 分数使用可扩展的 `scores` 对象，而不是只支持一个固定总分字段。
- 自动评分的 Evidence、ProcessingRun 和 provenance 与人工评语分开存储。
- 题目能按 `task.type` 和版本解析到一个 TaskProfile。

只增加题目无关的 GradingConfig，仍然不能覆盖具体题目的朗读原文、参考答案、关键
点和材料，也不能覆盖各题型不同的证据组织方式，更不能保存自动处理的中间证据、
失败状态和模型版本。因此推荐的关系是：

```text
Question  ──> TaskProfile
    │
    └──> Attempt ──> Evidence / ProcessingRun
             │
GradingConfig ─────> Assessment (human or automatic)
```

映射到当前输入格式：`task` 保存 Question 侧信息，`task.profile_*` 引用
TaskProfile，`rubric_ref/rubric` 引用或内联 GradingConfig，`derived` 保存自动生成的
Evidence，`labels` 保存校准用的人工结果。正式的人工和机器 Assessment 都应写入
独立结果记录；本输入 schema 暂不定义该输出协议。

## 最小原始样本

```json
{
  "schema_version": 1,
  "id": "practice-free-talk-0001.wav",
  "audio_path": "audio/practice-free-talk-0001.wav",
  "task": {
    "profile_id": "shanghai-free-talk-v1",
    "profile_version": "draft-1",
    "instance_id": "free-talk-question-0001",
    "type": "free_talk",
    "prompt": {
      "language": "en",
      "text": "Do you think students should do volunteer work? Explain your opinion."
    },
    "reference": {
      "mode": "key_points",
      "key_points": [
        {
          "id": "opinion",
          "description": "States a clear opinion.",
          "required": true
        },
        {
          "id": "support",
          "description": "Provides at least one relevant reason or example.",
          "required": true
        }
      ]
    },
    "response_constraints": {
      "preparation_seconds": 15,
      "response_seconds": 60
    }
  },
  "rubric_ref": {
    "id": "shanghai-speaking-practice-rubric",
    "version": "draft-1"
  }
}
```

## 题目字段

`task.type` 当前预留以下值：

- `read_aloud`：朗读，有精确参考文本。
- `short_answer`：简短问答，通常有一个或多个关键内容点。
- `retelling`：复述，关注主要事件、关系和顺序。
- `picture_description`：看图描述，题目可在 `stimuli` 中引用图片。
- `free_talk`：开放表达，关注交际任务和内容展开。
- `dialogue`：角色扮演或多轮回应。
- `other`：尚未归类的相似题型。

`task.reference` 必须显式提供；没有参考答案的开放表达写 `{"mode":"open"}`，
确认不做内容对照时写 `{"mode":"none"}`。朗读题必须使用 `exact_text`，不能只把
原文混在题目指令里。

`task.profile_id` 和 `task.profile_version` 必须成对出现，用于绑定题型处理方式和
提示词族；`rubric_ref` 则只绑定评分挡位与细则。即使两个配置碰巧使用相同版本号，
它们也不是同一实体，也不互相覆盖。
`task.instance_id` 用于标识具体题目。`id` 仍表示一次具体作答，因此同一道题的
多次练习应使用不同的 `id`，但可以共享 `instance_id`。

单段背景可放在 `task.prompt.context`；对话题应使用有序的
`task.prompt.turns[{role, text}]`，不要把不同角色的内容拼成一段无角色文本。
每个 `task.stimuli` 元素只表示一种 `text`、`image` 或 `audio` 材料；组合材料用
多个元素表达。文本材料必须有 `text`，图片和音频材料必须有 `path`。

`task.reference.mode` 决定内容判断方式：

| mode               | 使用场景              | 需要的字段            |
| ------------------ | --------------------- | --------------------- |
| `none`             | 暂无参考内容          | 无                    |
| `open`             | 完全开放表达          | 可只使用题目和 rubric |
| `exact_text`       | 朗读                  | `expected_text`       |
| `reference_answer` | 有参考回答但允许改写  | `reference_answer`    |
| `key_points`       | 问答、复述、Free talk | `key_points`          |

关键内容点不是扣分公式。它们只向 LLM 描述任务是否完成，并允许通过
`required`、`weight` 和 `acceptable_examples` 表达重要性及可接受变体。

## 评分细则

数据集较大时推荐只保存 `rubric_ref`，由运行环境根据 `id` 和 `version` 加载
评分细则。需要让单条样本完全自包含时，则用内联 `rubric` 取代 `rubric_ref`：

```json
{
  "rubric": {
    "id": "shanghai-speaking-practice",
    "version": "draft-1",
    "score_scale": { "minimum": 0, "maximum": 5, "step": 0.5 },
    "dimensions": [
      {
        "id": "overall",
        "description": "Holistic task performance.",
        "bands": [
          {
            "score": 5,
            "descriptor": "Content meets the task; grammar and pronunciation errors are rare."
          },
          {
            "score": 4.5,
            "descriptor": "Content largely meets the task with limited grammar or pronunciation errors."
          }
        ]
      }
    ]
  }
}
```

这里的 band 是 LLM 的定序锚点，不要求程序按错误数量机械扣分。最终分数仍可由
LLM 综合内容、语法、发音和流利度给出；程序只检查范围和 `step`。

## 声学派生字段

完成 Whisper 和音素提取后，应保留现有字段名，便于当前链路直接读取：

```json
{
  "transcript": "I think volunteer work is useful because students can help others.",
  "phonemes_cmu": "AY TH IH NG K ...",
  "phonemes_ipa": "aɪ θ ɪ ŋ k ...",
  "alignment": [{ "start": 0.0, "end": 0.12, "phone": "AY" }],
  "derived": {
    "transcript_segments": [
      {
        "start": 0.0,
        "end": 4.8,
        "text": "I think volunteer work is useful because students can help others.",
        "confidence": 0.91
      }
    ],
    "fluency_events": [
      {
        "type": "filled_pause",
        "start": 1.2,
        "end": 1.5,
        "evidence": "um"
      }
    ],
    "metrics": {
      "duration_seconds": 6.2,
      "speech_seconds": 4.8,
      "pause_ratio": 0.2258
    },
    "provenance": {
      "asr": { "model": "large-v3", "revision": "pinned-revision" },
      "ipa": { "model": "wav2vec2-ipa", "revision": "pinned-revision" },
      "cmu": { "model": "charsiu-cmu", "revision": "pinned-revision" }
    }
  }
}
```

`derived` 是后续评分器使用的结构化证据，不要求数据提供方手工填写。原始模型
输出、模型 revision 和置信度应保留，避免把 ASR 错误误判成考生的内容、语法或
发音错误。

当前命令仍会产生顶层 `asr_model`、`ipa_model`、`cmu_model` 字段。合并 adapter
应把它们归一化到 `derived.provenance.{asr,ipa,cmu}`；新格式以这里的 `model`、
`revision`、`provider` 和 `parameters` 为准。若导入数据同时含旧字段和新字段，
adapter 必须在值不一致时报错，不能静默选择其中一个。

## 人工标签

`labels` 只用于校准和评测，在线待评分样本不需要提供。推荐保存各评分者原始
分数，并把仲裁或均值单独放入 `consensus`：

```json
{
  "labels": {
    "raters": [
      {
        "rater_id": "rater-01",
        "scores": {
          "content": 4.5,
          "grammar": 4.0,
          "pronunciation": 4.5,
          "fluency": 4.0,
          "overall": 4.5
        },
        "notes": "One noticeable restart; the response completes the task."
      }
    ],
    "consensus": {
      "method": "adjudicated",
      "scores": { "overall": 4.5 }
    }
  }
}
```

`rater_id` 应使用匿名内部编号。不要只保存平均分，否则之后无法计算评分者一致性
或重新调整评分口径。

## 校验层次

JSON Schema 负责字段存在性、类型、枚举值和声学字段完整性。以下跨字段规则应由
导入 adapter 做语义校验，不能只依赖 JSON Schema：

- 所有时间段满足 `0 <= start <= end`，并且不超过音频时长。
- `score_scale.minimum < maximum`，band 和人工标签分数都在范围内并符合 `step`。
- `minimum_words <= maximum_words`（两者同时存在时）。
- 数据集内 `id` 唯一；外部 rubric 能按精确的 `id` 与 `version` 解析。
- 旧、新 provenance 同时存在时内容一致。

## 当前边界

- 此格式没有假定上海正式考试的真实总分、维度权重或扣分公式。
- 示例 rubric 只展示结构，不代表官方标准。
- `task` 和 `rubric` 目前不会改变 TextPA 的零样本提示词。
- 图片、题目前置音频等材料先通过 `task.stimuli` 引用；实际文件打包和部署协议
  后续再确定。
- schema 有意允许额外字段，以便之后增加语法证据、说话人轮次和多模态输入而
  不迁移已有 JSONL。
