# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型、Template 与 Function 工作文档身份、文件仓储、内嵌函数资源管理、应用门面、严格语义校验，以及从已校验 Template 到跨模块 `ExamPackage` 的编译。当前没有实现 renderer 页面或最终试卷文件封装。

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

Template 不区分草稿和发布状态。`createTemplateDocument()` 生成稳定 UUID `templateId`、初始 revision 0，并深拷贝正文、函数资源和编辑器状态；保存工作文档不触发严格业务校验，预览和导出才要求当前内容完整合法。导出后的 ExamPackage 不依赖 Template，后续修改或删除工作文档不会影响已经导出的试卷。

函数库源文档同样使用稳定 UUID `functionId`，可以直接编辑和删除。Template 内的 `FunctionDef` 是复制后的不可变快照，其 `id` 由 `deriveFunctionResourceId()` 根据函数正文计算。嵌套 `functionRef`、节点顺序、输入输出和 Schema 消费参与哈希；对象 key 不影响结果，字符串统一为 LF 换行和 NFC Unicode。

当前身份工具包括：

- `createTemplateDocument()`、`createFunctionDocument()`：创建可编辑 UUID 工作文档。
- `createFunctionResource()`：生成带内容 ID 的内嵌函数快照。
- `verifyFunctionResourceId()`：复算函数资源 ID 并检测正文篡改。
- `canonicalizeFunctionContent()`：生成稳定的函数正文规范表示。

## 仓储

`TemplateRepository` 同时管理 Template 和 Function 工作文档。`FileTemplateRepository` 使用 `@ls101/file-store` 兼容的作用域存储，布局为 `templates/<templateId>/template.json` 和 `functions/<functionId>/function.json`；适配器从 `@ls101/template-editor/adapters` 导出。

工作文档保存允许名称、DSL 和绑定处于业务不完整状态。仓储通过完整递归结构解析器验证所有节点判别字段、内容块、时间线、表达式、Interface requirement、Schema use、函数定义和 JSON 编辑器状态，确保读取结果可以安全进入校验和编译；同时检查 UUID v4、内嵌函数资源 ID 唯一性及资源内容哈希。损坏数据通过 `TemplateRepositoryError` 的 `INVALID_ID` 或 `INVALID_DATA` 返回，不会泄漏普通遍历异常。

Template 和 Function 工作文档都带 revision。首次保存使用 0，后续成功保存递增并返回新的完整文档；调用方必须用返回值替换本地副本。文件仓储对同一文档的变更串行执行并使用 compare-and-swap，过期副本返回 `REVISION_CONFLICT` 及当前/传入 revision，不覆盖较新数据。删除 Template 或函数源文档会清除对应工作目录；已嵌入其他 Template 的函数快照不受源函数删除影响。

## 应用门面

`createTemplateApplication()` 提供浏览、Template 工作文档和 Function 工作文档三个分区。创建操作立即生成 UUID 并保存；获取、整份保存和删除直接对应仓储操作。`save()` 返回递增 revision 后的文档，过期 autosave 必须由调用方处理冲突，不能静默覆盖。

`templates.embedFunction(templateId, functionId)` 递归读取函数库源文档，从叶子开始复制完整依赖闭包，把嵌套调用从源函数 UUID 改写为内嵌资源内容 ID，并把资源合并回 Template。同内容资源按哈希去重；递归依赖、源函数缺失和理论上的哈希碰撞通过结构化 `TemplateApplicationError` 返回。操作返回根资源的 `functionRef`，供编辑器创建或更新函数调用节点。

`templates.pruneFunctionResources()` 从 Template 根节点遍历嵌套函数引用，只保留传递可达的资源。清理是显式操作，因此编辑器可以在“复制资源”和“写入调用节点”之间保存中间状态。嵌入和清理都基于读取到的 revision 保存；如果期间发生 autosave，资源操作以 `REVISION_CONFLICT` 失败，不会用旧正文覆盖编辑内容。

`templates.validate()` 和 `templates.compile()` 会根据当前 Template 收集 Interface 与 Schema 身份，通过调用方提供的跨模块查询函数取得清单。编译时再把 Interface 实例选择及仓储定位器交给底层异步编译器。Schema Editor 尚未实现实际查询 API，当前通过窄依赖接口接入。

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

- renderer 对 Template 应用门面的注册，以及图形化 DSL 编辑器。
- Interface 应用/仓储的实例定位适配器和 Schema Editor 的评分块清单适配器。
- 编辑器节点级变更、撤销/重做和编译错误文案及定位交互。
- `ExamPackage` 的文件封装、资源复制和持久化格式。

## 验证覆盖

单元测试覆盖完整递归文档解析、损坏文件读取、revision/CAS、autosave 与函数嵌入/清理并发、工作文档 CRUD、函数依赖闭包复制与去重、嵌套 Frame 引用改写、源删除隔离、递归拒绝、函数内部 Schema 清单收集、不可达资源清理、应用层依赖组装、函数资源摘要、结构化错误契约、函数作用域、Schema 绑定、Collector 和视图约束。编译测试额外覆盖完整 Player/Schema 输出、重复及嵌套函数调用、函数内部相对与绝对 focus、number/file/audio 出参、全局录音索引、跨调用静态值循环、多 Interface/Schema 隔离和仓储归属验证。
