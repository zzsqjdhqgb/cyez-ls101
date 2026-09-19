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
| 工作台 | Workbench | 应用首页 |

规则：

- 新增用户可见术语前，先在本表登记并确认代码术语对照。
- 界面文案一律用左列；右列不得出现在用户可见文本中。

## 已知冲突

产品定义要求界面不向用户暴露 `Schema`，但 v0.4.1 的实际界面存在"Schema"字样
（例如评分单元相关页面的返回入口）。这是代码与产品用词的冲突，处理方式见
[`open-questions.md`](./open-questions.md) 第 1 条。
