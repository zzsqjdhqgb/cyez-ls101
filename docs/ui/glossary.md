<!--
status: implemented
product-version: 0.4.1
audience: both
owner: ui
-->

# 术语表

用户可见术语是界面文案与产品文档的**唯一用词**。代码术语只允许出现在 `docs/engineering/`。

| 用户可见术语 | 代码 / 文件术语 | 说明 |
| --- | --- | --- |
| 评分单元 | `Schema`、`.lsschema` | 定义答案结构、评分输入、分值与评分标准 |
| 试卷模板 | `Template`、`.lstemplate` | 可编辑的制卷规则 |
| 题型 | `Interface`、`.lsinterface` | 字段定义与生成要求 |
| 题组 | `Instance` | 题型下可复用的具体内容 |
| 试卷 / 试卷库 | `ExamPackage`、`.lsexam` | 生成后的可运行快照 |
| 作答包 | `SubmissionPackage`、`.lssubmission` | 一次运行产生的原始作答 |
| 作答记录 | `SubmissionRecord` | 导入后的作答包记录 |
| 评分结果 | `SubmissionGradingRecord` | 与原始作答分开保存 |
| 结算批次 | `SubmissionSettlementBatch` | 结算结果的归组单位 |
| 函数库 | `FunctionLibrary`、`.lsfunclib` | 模板可复用的函数集合 |
| 服务商 | `Provider` | 文本、图像、语音合成、语音识别的 AI 服务配置 |
| 时间线 | `Timeline` | 页面上按时间播放或采集的步骤序列 |
| 采集器 | `Collector` | 汇总选择题等题目、供视图读取的节点 |
| 版本 | `revision` | 评分单元、模板、函数库的修订号；界面显示为「版本 N」 |
| 工作台 | Workbench | 应用首页 |

衍生用词：

| 场景 | 用户可见写法 | 不得出现 |
| --- | --- | --- |
| 对象标识 | 「编号」（如 `题型编号`、`稳定编号`、`模型编号`） | `ID` |
| 凭据 | 「API 密钥」 | `API Key` |
| 允许保留的缩写 | `AI`、`JSON`、`TTS`、`WASM`、`SHA-256`、`OpenAI Compatible`、`Base URL` | 其余英文缩写 |

规则：

- 新增用户可见术语前，先在本表登记并确认代码术语对照。
- 界面文案一律用左列；右列不得出现在用户可见文本中。
- 界面文案中的中文之间不留空格；数字或英文与中文之间留一个空格（如 `共 1 个服务商`、`版本 2`）。

## 落地状态

v0.4.1 的界面曾直接暴露 `Schema`、`Interface`、`Instance`、`Timeline`、`Collector`、
`revision`、`Provider`、`ID` 等内部术语。替换已按本表完成（含文档、测试与视觉基线同步），
见 [`open-questions.md`](./open-questions.md) 第 1 条。此后新增界面文案必须直接使用左列用词。

