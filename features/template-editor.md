# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型、Template 草稿与内容身份纯函数、基于外部依赖清单的发布语义校验，以及从已校验 Template 到跨模块 `ExamPackage` 的编译。当前没有实现仓储、编辑操作或 renderer 页面。

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

## 试卷包编译

`compileTemplate(content, context)` 先执行完整发布语义校验，再使用导出时传入的 Interface 实例绑定展开 Template。成功时返回 `ExamPackage`；失败时通过判别联合返回校验阶段或编译阶段的结构化错误，不生成部分试卷包。

编译器分两阶段工作。第一阶段展开框架和函数调用，分配全局 `recordIndex`、`choiceIndex` 并建立静态值依赖；第二阶段统一求值页面内容、时间线、选择题、函数静态出参和 Schema 字段。因此页面或函数输入可以引用同层稍后声明的静态输出，跨函数形成的静态值循环会作为编译错误返回。

当前编译行为包括：

- 校验每个 Interface 别名恰好有一个实例绑定、绑定的仓储归属匹配 `interfaceId`，且所有 acceptedVars 都有实例值。
- 按函数调用路径展开页面、内容块、录音、选择题、函数出参和函数内部 Schema 消费。
- 为展开后的页面和内容块生成稳定 ID，为每次函数内部 Schema 消费生成调用路径限定的 `useId`。
- 收集唯一 ChoiceCollector 候选，生成全局只读 ChoiceMeta，并把结构化 focus 地址解析为 `choiceIndex`。
- 把文本插值、静态参数和 Interface 图片值求值为 Player 可直接消费的数据。
- 把 Schema 的 text 字段编译为静态值，把 audio 和 choice 字段编译为对应运行期索引。

跨模块 `ExamPackage` 契约位于 `@ls101/core-types`。`player` 只包含页面、时间线、录音索引和可选的 ChoiceMeta；`schema.usages` 只描述评分块消费及其字段到静态值或运行期索引的映射。

## 未实现边界

当前类型仍允许表达不完整的草稿；编译入口会自行执行严格校验。以下能力尚未实现：

- Template 和 Function 仓储，以及调用方从 Interface 仓储按 instanceId 组装编译绑定。
- 草稿保存、发布和预览的应用服务工作流。
- `ExamPackage` 的文件封装、资源复制和持久化格式。
- renderer 图形化 DSL 编辑器及编译错误文案和定位交互。

## 验证覆盖

单元测试覆盖内容 ID、草稿/发布身份、依赖与表达式类型、函数作用域及重命名、Schema 完整绑定、函数递归、Collector 跨函数收集、分页、视图范围和全局候选约束。编译测试额外覆盖完整 Player/Schema 输出、重复函数调用、相对与绝对 focus 地址、函数内部 Schema 展开、跨调用静态值循环、Interface 实例绑定错误和校验错误透传。
