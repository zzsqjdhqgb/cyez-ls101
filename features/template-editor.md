# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型、Template 草稿与内容身份纯函数，以及基于外部依赖清单的发布语义校验。当前没有实现仓储、编辑操作、试卷包编译或 renderer 页面。

## 已实现边界

领域模型包括：

- 页面、框架、函数调用和选择题单题四种 DSL 节点。
- 页面内容块、线性时间线和选择题视图控制。
- `string | number | file` 静态参数表达式，以及 `audio | choice` 运行期输出。
- 函数输入、手动出参、局部输出引用，以及调用点出参名称重定向。
- 带 `schemaId + blockId` 强关联的评分块消费与字段绑定。
- 多 Interface 依赖、命名空间和导出时实例选择 DTO。
- `TemplateContent`、`TemplateDraft`、`TemplateDef` 和发布状态。

Schema Editor 向 Template Editor 提供的 `SchemaBlockManifest` 位于 `@ls101/core-types`，其中只包含评分块和字段契约，不暴露评分实现。

## 内容身份

`deriveTemplateId()` 对 `TemplateContent` 做稳定序列化并计算 SHA-256，结果格式为 `sha256:<64 位十六进制摘要>`。对象 key 不影响结果，DSL 数组顺序参与结果；所有字符串在计算前统一为 LF 换行和 NFC Unicode。

哈希包含名称、描述、Interface 依赖、完整根 DSL、Schema 消费，以及根 DSL 中的函数内容 ID 引用。`draftId`、发布 `id`、状态、时间戳和导出时选择的 Interface 实例不参与哈希。

公共纯函数包括：

- `createTemplateDraft()`：生成 UUID v4 草稿身份和 `draft` 状态。
- `publishTemplate()`：生成不可变内容 ID 和 `published` 状态。
- `verifyTemplateId()`：复算已发布内容 ID。
- `compareTemplateIdentity()`：区分相同内容、不同 ID 和同 ID 内容冲突。

## 发布语义校验

`validateTemplateContent(content, context)` 接收 Template 正文，以及只读的 Interface 变量清单、Schema 评分块清单和函数定义列表。返回稳定错误代码、字段路径和参数，不生成面向用户的错误文案。

校验器按 Template 根或函数定义建立局部作用域，框架本身不创建隐式作用域。函数调用必须完整填写输入，并通过 `outputNames` 将每个手动出参重命名到调用方作用域；同一函数可以因此被多次调用。函数内部 Schema 消费随实际调用展开，但调用方不能改写其绑定。

当前校验覆盖：

- Interface 别名、依赖、acceptedVars 和变量类型。
- 节点、内容块、选项、局部变量和 Schema use 的唯一性。
- 页面、时间线、文本插值、函数输入与出参的变量解析和类型匹配。
- Schema、评分块、完整字段绑定及 text/audio/choice 类型匹配。
- 函数缺失、输入/出参映射完整性和递归调用。
- ChoiceCollector 嵌套、全卷唯一候选、分页字面量、题数总和和未收集题目。
- 选择题视图是否具有唯一 ChoiceMeta，以及 free/range 页码范围。
- 展开后的 Template 是否至少消费一个 Schema 评分块。

## 未实现边界

当前类型仍允许表达不完整的草稿；调用方只在发布前执行严格校验。以下规则需要后续编译器或应用层实现：

- `focus.questionRef` 的函数调用路径展开和最终全局题目身份解析。
- 函数、页面、选择题和 Schema 映射的实际展开及运行期索引分配。
- 静态函数出参的完整依赖图求值和跨调用循环检测。
- InterfaceInstance 归属校验及最终 ExamPackage 生成。
- 草稿仓储、发布工作流和 renderer 编辑器。

## 验证覆盖

单元测试覆盖内容 ID、草稿/发布身份、依赖与表达式类型、函数作用域及重命名、Schema 完整绑定、函数递归、Collector 跨函数收集、分页、视图范围和全局候选约束。
