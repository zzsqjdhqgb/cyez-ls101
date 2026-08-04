# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型、Template 与 Function 工作文档身份、内嵌函数资源身份、严格语义校验，以及从已校验 Template 到跨模块 `ExamPackage` 的编译。当前没有实现仓储、函数资源复制操作或 renderer 页面。

## 已实现边界

领域模型包括：

- 页面、框架、函数调用和选择题单题四种 DSL 节点。
- 页面内容块、线性时间线和选择题视图控制。
- `string | number | file` 静态参数表达式，以及 `audio | choice` 运行期输出。
- 函数输入、手动出参、局部输出引用，以及调用点出参名称重定向。
- 带 `schemaId + blockId` 强关联的评分块消费与字段绑定。
- 多 Interface 依赖、命名空间和导出时实例选择 DTO。
- `TemplateContent`、稳定 UUID 的 `TemplateDocument`、内嵌函数资源和 JSON 编辑器状态。

Schema Editor 向 Template Editor 提供的 `SchemaBlockManifest` 位于 `@ls101/core-types`，其中只包含评分块和字段契约，不暴露评分实现。

## 工作文档与函数资源身份

Template 不区分草稿和发布状态。`createTemplateDocument()` 生成稳定 UUID `templateId` 并深拷贝正文、函数资源和编辑器状态；保存工作文档不触发严格校验，预览和导出才要求当前内容完整合法。导出后的 ExamPackage 不依赖 Template，后续修改或删除工作文档不会影响已经导出的试卷。

函数库源文档同样使用稳定 UUID `functionId`，可以直接编辑和删除。Template 内的 `FunctionDef` 是复制后的不可变快照，其 `id` 由 `deriveFunctionResourceId()` 根据函数正文计算。嵌套 `functionRef`、节点顺序、输入输出和 Schema 消费参与哈希；对象 key 不影响结果，字符串统一为 LF 换行和 NFC Unicode。

当前身份工具包括：

- `createTemplateDocument()`、`createFunctionDocument()`：创建可编辑 UUID 工作文档。
- `createFunctionResource()`：生成带内容 ID 的内嵌函数快照。
- `verifyFunctionResourceId()`：复算函数资源 ID 并检测正文篡改。
- `canonicalizeFunctionContent()`：生成稳定的函数正文规范表示。

## 严格语义校验

异步的 `validateTemplateDocument(document, context)` 从 Template 自带资源读取函数快照，复算每个资源的内容 ID，并拒绝非法 ID 或正文篡改。调用方只提供 Interface 变量清单和 Schema 评分块清单。底层同步的 `validateTemplateContent(content, context)` 仍可用于单独校验正文及显式函数集合，但不承担资源身份验证。两者都返回稳定错误代码、字段路径和参数，不生成面向用户的错误文案。

校验器按 Template 根或函数定义建立局部作用域，框架本身不创建隐式作用域。函数调用必须完整填写输入，并通过 `outputNames` 将每个手动出参重命名到调用方作用域；同一函数可以因此被多次调用。函数内部 Schema 消费随实际调用展开，但调用方不能改写其绑定。

当前校验覆盖：

- Interface 别名、依赖、acceptedVars 和变量类型。
- 节点、内容块、选项、局部变量和 Schema use 的唯一性。
- 页面、时间线、文本插值、函数输入与出参的变量解析和类型匹配。
- Schema、评分块、完整字段绑定及 text/audio/choice 类型匹配。
- 函数缺失、输入/出参映射完整性和递归调用。
- 内嵌函数资源 ID 格式、正文摘要和嵌套依赖闭包。
- ChoiceCollector 嵌套、全卷唯一候选、分页字面量、题数总和和未收集题目。
- 选择题视图是否具有唯一 ChoiceMeta，以及 free/range 页码范围。
- 展开后的 Template 是否至少消费一个 Schema 评分块。

## 试卷包编译

异步的 `compileTemplate(document, context)` 先对工作文档执行完整语义和资源完整性校验，再使用导出时传入的 Interface 实例选择展开 Template。函数定义只从 `document.resources.functions` 读取，不访问函数库。成功时返回 `ExamPackage`；失败时通过判别联合返回校验阶段或编译阶段的结构化错误，不生成部分试卷包。

编译器分两阶段工作。第一阶段展开框架和函数调用，分配全局 `recordIndex`、`choiceIndex` 并建立静态值依赖；第二阶段统一求值页面内容、时间线、选择题、函数静态出参和 Schema 字段。因此页面或函数输入可以引用同层稍后声明的静态输出，跨函数形成的静态值循环会作为编译错误返回。

当前编译行为包括：

- 校验每个 Interface 别名恰好有一个实例选择；通过调用方提供的仓储定位器按 `instanceId` 获取唯一定位结果，并验证真实仓储归属匹配 `interfaceId`，且所有 acceptedVars 都有实例值。
- 按函数调用路径展开页面、内容块、录音、选择题、函数出参和函数内部 Schema 消费。
- 为展开后的页面和内容块生成稳定 ID，为每次函数内部 Schema 消费生成调用路径限定的 `useId`。
- 收集唯一 ChoiceCollector 候选，生成全局只读 ChoiceMeta，并把结构化 focus 地址解析为 `choiceIndex`。
- 把文本插值、静态参数和 Interface 图片值求值为 Player 可直接消费的数据。
- 把 Schema 的 text 字段编译为静态值，把 audio 和 choice 字段编译为对应运行期索引。

跨模块 `ExamPackage` 契约位于 `@ls101/core-types`。`player` 只包含页面、时间线、录音索引和可选的 ChoiceMeta；`schema.usages` 只描述评分块消费及其字段到静态值或运行期索引的映射。

## 未实现边界

工作文档允许保存不完整状态；编译入口会自行执行严格校验。以下能力尚未实现：

- Template 和 Function 工作文档仓储，以及调用方把 Interface 仓储的 `findInstance()` 适配为编译所需实例定位器。
- 复制函数完整依赖闭包、改写内部引用、按哈希去重和清理不可达资源的应用操作。
- 工作文档保存、预览和导出的应用服务工作流。
- `ExamPackage` 的文件封装、资源复制和持久化格式。
- renderer 图形化 DSL 编辑器及编译错误文案和定位交互。

## 验证覆盖

单元测试覆盖工作文档 UUID、函数资源内容 ID 与入口级篡改检测、完整结构化错误契约、依赖与表达式类型、函数作用域及重命名、Schema 完整绑定、函数递归、Collector 跨函数收集、分页、视图范围和全局候选约束。编译测试额外覆盖完整 Player/Schema 输出、重复及嵌套函数调用、函数内部相对与绝对 focus、函数内部 Schema 展开、number/file/audio 出参、全局录音索引、跨调用静态值循环、多 Interface/Schema 隔离、仓储归属验证和校验错误透传。
