# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型，以及 Template 草稿、发布和内容身份纯函数。当前没有实现仓储、编辑操作、完整语义校验、函数展开、试卷包编译或 renderer 页面。

## 已实现边界

领域模型包括：

- 页面、框架、函数调用和选择题单题四种 DSL 节点。
- 页面内容块、线性时间线和选择题视图控制。
- `string | number | file` 静态参数表达式，以及 `audio | choice` 运行期输出。
- 函数输入、手动出参和局部输出引用。
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

## 未实现边界

当前类型允许表达草稿的中间状态，但不会执行发布校验。以下规则仍需由后续语义校验器和编译器实现：

- 节点 ID、局部变量名、Interface 别名和 Schema `useId` 唯一性。
- 函数输入完整性、变量类型匹配和 Schema 字段完整绑定。
- ChoiceCollector 的数量、嵌套、分页总数和全局唯一 ChoiceMeta。
- `focus/range` 引用解析、函数展开和运行期索引分配。
- InterfaceInstance 归属校验及最终 ExamPackage 生成。

## 验证覆盖

单元测试覆盖内容 ID 格式与稳定性、数组顺序、字符串规范化、依赖身份变化、篡改检测、身份冲突分类和草稿/发布字段隔离。类型构造测试覆盖页面、选择题、函数 choice 出参和 Schema choice 绑定。
