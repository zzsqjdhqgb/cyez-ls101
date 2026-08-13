# Template Editor

## 功能状态

`@ls101/template-editor` 已实现 UI 无关的作者态领域类型、Template 与函数库工作文档身份、版本化函数库仓储、内嵌函数资源管理、应用门面、严格语义校验，以及从已校验 Template 到跨模块 `ExamPackage` 的编译。renderer 已注册 Template 应用门面、列表入口、函数库浏览、Template 与本地函数工作文档编辑会话、节点结构编辑器、Page 内容画布、SchemaUse 附件配置，以及包含资源文件的最终 `.lsexam` 归档导出。

## 已实现边界

领域模型包括：

- 页面、框架、函数调用和选择题单题四种 DSL 节点。
- 页面内容块、线性时间线和选择题视图控制。
- `string | number | file` 静态参数表达式，以及 `audio | choice` 运行期输出。
- 函数输入、手动出参、局部输出引用，以及调用点出参名称重定向。
- 只保存稳定 `schemaId` 的 `SchemaUse`，按稳定 ID 分别绑定静态文本输入和 `text | fixed-speech | free-speech` 答案槽位。
- 每次 `SchemaUse` 可动态声明 `file` 附件，并通过仅在当前评分单元有效的 `[@this.varName]` 引用编译后的逻辑资源 URI。
- 多 Interface 依赖、命名空间和导出时实例选择 DTO。
- `TemplateContent`、稳定 UUID 的 `TemplateDocument`、内嵌函数资源和 JSON 编辑器状态。

Schema Editor 向 Template Editor 提供完整的正式 `SchemaDefinition`。Template 文档只保存 `schemaId`，校验和编译时读取最新 revision，并把当时的完整定义快照写入 ExamPackage。

## 工作文档、函数库与资源身份

Template 不区分草稿和发布状态。`createTemplateDocument()` 生成稳定 UUID `templateId`、初始 revision 0，并深拷贝正文、函数资源和编辑器状态；保存工作文档不触发严格业务校验，预览和导出才要求当前内容完整合法。导出后的 ExamPackage 不依赖 Template，后续修改或删除工作文档不会影响已经导出的试卷。

用户本地函数以函数库为工作文档边界。`LocalFunctionLibraryDocument` 使用稳定 UUID `libraryId` 和仓储 revision，库内每个函数使用稳定 UUID `functionId`；函数的语义正文和编辑器状态都随所属函数库统一读取、保存和删除。导入库和内置库使用不可变的 `FunctionLibraryRelease`，由 `libraryId + version + contentHash` 标识；内置库使用稳定的 `builtin:*` 库及函数 ID。

Template 内的 `FunctionDef` 是从函数库复制后的不可变快照，其 `id` 由 `deriveFunctionResourceId()` 根据函数正文计算。嵌套 `functionRef`、节点顺序、输入输出和 Schema 消费参与哈希；对象 key 不影响结果，字符串统一为 LF 换行和 NFC Unicode。源函数后续修改、删除或内置 release 停用不会改变已经嵌入 Template 的快照。

当前身份工具包括：

- `createTemplateDocument()`：创建可编辑的 Template 工作文档。
- `createLocalFunctionLibraryDocument()`、`createFunctionDocument()`：创建本地函数库及其库内函数投影。
- `createFunctionLibraryRelease()`、`verifyFunctionLibraryRelease()`：创建和验证不可变函数库 release。
- `createFunctionResource()`：生成带内容 ID 的内嵌函数快照。
- `verifyFunctionResourceId()`：复算函数资源 ID 并检测正文篡改。
- `canonicalizeFunctionContent()`：生成稳定的函数正文规范表示。

## 仓储

`TemplateRepository` 同时管理 Template、本地函数库工作文档、导入 release 和内置 release。`FileTemplateRepository` 使用 `@ls101/file-store` 兼容的作用域存储；适配器从 `@ls101/template-editor/adapters` 导出。主要布局为：

- `templates/<templateId>/template.json`：Template 工作文档。
- `function-libraries/local/<libraryId>/library.json`：本地函数库工作文档，包含库内全部函数和编辑器状态。
- `function-libraries/imported/<libraryId>/releases/v<version>/library.json`：导入的不可变 release。
- `function-libraries/builtin/<builtinKey>/releases/v<version>/library.json`：随应用登记的不可变内置 release。
- `function-libraries/builtin/active.json`：当前清单中的内置库及 active 版本。升级时整份替换此清单；被移除库的历史 release 继续保留，仅供已有版本依赖读取，不再出现在浏览列表或新建引用中。

工作文档保存允许名称、DSL 和绑定处于业务不完整状态。仓储通过完整递归结构解析器验证所有节点判别字段、内容块、时间线、表达式、Interface requirement、Schema use、函数定义和 JSON 编辑器状态，确保读取结果可以安全进入校验和编译。编辑器状态只接受由有限数字、字符串、布尔值、null、数组和普通对象组成的无环 JSON 树；非普通对象及循环引用会被拒绝。同时检查 UUID v4、内嵌函数资源 ID 唯一性及资源内容哈希。结构损坏或底层 JSON 语法错误都通过 `TemplateRepositoryError('INVALID_DATA')` 返回，不会泄漏 `TypeError`、`RangeError` 或 `SyntaxError`。

Template 和本地函数库工作文档都带 revision。首次保存使用 0，后续成功保存递增并返回新的完整文档；调用方必须用返回值替换本地副本。文件仓储使用 File Store main 进程提供的原子 compare-and-swap；该保证跨 renderer/window 和仓储实例成立。过期副本返回 `REVISION_CONFLICT` 及当前/传入 revision，不覆盖较新数据。删除本地函数库会清除整个库工作目录；已嵌入其他 Template 的函数快照不受源库删除影响。

函数库 release 登记前会校验内容哈希、库和函数 ID、函数 ID 唯一性以及完整依赖图。每个 `functionRef` 必须符合对应来源的 ID 规则并指向同一 release 内存在的函数，任何直接或间接递归都会在启动或导入阶段被拒绝，不能延迟到复制函数时才失败。

## 应用门面

`createTemplateApplication()` 提供 `browser`、`templates`、`functionLibraries.local` 和 `functionLibraries.imported` 分区。`browser.listFunctionLibraries()` 汇总当前 active 内置库、全部导入 release 和本地函数库，并返回每个库的来源、版本及函数摘要；renderer 左栏按“来源 → 函数库 → 函数”展示该数据。本地库可以直接创建函数、编辑函数、导出和删除；导入 release 可以登记并按具体版本删除，内置库不可删除且函数不可编辑。Template 和本地函数库的创建操作立即生成 UUID 并保存；获取、整份保存和删除直接对应仓储操作。`save()` 返回递增 revision 后的文档，过期 autosave 必须由调用方处理冲突，不能静默覆盖。

函数库文件使用 `.lsfunclib` 扩展名，正文是经过规范化内容哈希保护的 `FunctionLibraryRelease` JSON。首次导出本地库使用 v1；内容未变化时重复导出保持版本，内容变化后再导出才递增版本，并在文件成功写入后更新工作文档的 `exportState`。导入必须经过 JSON 结构、内容哈希、UUID、函数 ID、依赖完整性和递归检查，不能把工作文档或任意 JSON 直接登记为导入 release。

当前随应用发布的 `builtin:basic` v2“基础组件库”是唯一的节点预设特例，包含 `builtin:frame`（框架）、`builtin:page`（页面）和 `builtin:choice-question`（带两个最小选项的选择题）。应用层按 `builtin:basic` 这个稳定库 ID 硬编码识别，renderer 提取条目函数体根下的唯一子节点并执行 `insert-node`，不会生成函数调用节点或内嵌函数资源。`builtin:examples` v3“示例组件库”仅用于演示，包含“标题页组合”和“选择题组合”两个普通函数；两个示例函数都声明并在正文中使用入参，同时导出可供下游变量引用的静态值或选择题结果。点击后仍生成函数调用节点并复制函数资源。组件只能从左栏函数库添加；中间节点树只负责结构选择、复制、移动和删除。

`templates.embedFunction(templateId, locator)` 通过包含来源、库 ID、可选 release 版本和函数 ID 的定位器读取函数库，从叶子开始复制完整依赖闭包，把嵌套调用从源函数 ID 改写为内嵌资源内容 ID，并把资源合并回 Template。同内容资源按哈希去重；运行期源函数缺失和理论上的哈希碰撞通过结构化 `TemplateApplicationError` 返回。操作返回根资源的 `functionRef`，供编辑器创建或更新函数调用节点。

函数调用节点在节点卡片和右侧属性栏共享同一个参数编辑器。编辑器根据内嵌函数快照的签名展示全部入参和出参映射：字符串入参支持文本与变量拼接，数字和文件入参只能绑定常量或单个同类型变量，出参字段编辑调用方作用域中的变量名。修改出参名仍通过文档 mutation 自动重写当前定义作用域内的下游局部引用；快照缺失时，前端回退展示调用节点已有绑定以便诊断和修复。

`templates.insertFunctionCall(templateId, locator, parentId, index?)` 是编辑器使用的原子组合操作。它在同一份已读取的 Template 上复制完整函数闭包、按函数签名生成所有输入默认表达式和调用处出参名、插入函数节点，最后只执行一次 CAS 保存。父框架不存在或结构操作被拒绝时不会保存刚复制的资源；成功结果包含 `functionRef` 和最终生成的 `callNodeId`。

`templates.pruneFunctionResources()` 从 Template 根节点遍历嵌套函数引用，只保留传递可达的资源。清理是显式操作，因此编辑器可以在“复制资源”和“写入调用节点”之间保存中间状态。嵌入和清理都基于读取到的 revision 保存；如果期间发生 autosave，资源操作以 `REVISION_CONFLICT` 失败，不会用旧正文覆盖编辑内容。

## 不可变编辑引擎

`editTemplateDocument(document, operation)` 和 `editFunctionDocument(document, operation)` 是不访问仓储的纯编辑入口。成功结果包含新文档、原文档、原操作和结构化 change 列表，可直接作为撤销/重做历史的基础；失败结果保留原文档，并提供稳定错误码、路径和参数。编辑不修改输入对象，也不递增 revision，调用方保存后必须继续用仓储返回的新 revision 文档替换本地状态。

当前操作覆盖节点插入、删除、移动和复制，页面内容块与时间线，选择题选项，Collector 分页，函数调用输入/出参绑定，函数输入与手动出参，Interface requirement、Schema use、Schema 输入/答案绑定、SchemaUse 附件和编辑器私有状态。节点使用定义作用域内唯一 ID 定位；列表索引在操作时检查边界。

编辑引擎实现位于 `src/mutations/`：公开入口保持在 `index.ts`，Template 文档与库内函数投影编辑、节点定义 reducer、页面关联清理、表达式重写、标识生成和函数资源可达性分别按状态所有权与不变量组织。该目录拆分不改变 `@ls101/template-editor` 的公开导出。

新增或复制时自动分配不冲突的节点 ID、内容块 ID、选项 ID、录音名、选择题输出名和函数调用出参名。复制子树会同步重写复制体内部的局部变量引用以及 relative focus 的 `callPath/questionId`；absolute focus 始终保留从 Template 根出发的原地址。删除 ChoiceViewBlock 会清除时间线中对应的 override；删除函数调用节点会在同一次 Template 编辑中清除传递不可达的函数资源。`reconcile-function-call` 根据最新签名移除过期 binding key、保留仍有效的值并补齐新增输入和出参名。

renderer 的 Template 编辑会话直接消费不可变 mutation 结果，以完整文档快照维护 undo/redo 历史。最近成功保存的历史条目作为 clean 基线；撤销回该条目会恢复为非 dirty。保存期间允许继续编辑，返回的新 revision 会重定基到当前 undo/redo 历史，既不覆盖新修改，也不会让后续保存使用过期 CAS revision。路由参数变化通过新的 keyed 编辑会话隔离旧文档、错误和异步响应。

本地函数使用独立的 focus 编辑路由和历史会话。页面复用 Template 的节点树、Page 画布、选择题、时间线、Schema use、函数调用和内容块检查器，并额外编辑函数名称、静态输入及五类输出表达式；左栏可插入基础节点预设，以及任意本地、导入或内置库中的普通函数。跨库调用会在一次 CAS 中复制所选函数的完整传递依赖闭包，给副本分配目标本地库中的 UUID 并改写内部引用；副本作为不在函数库浏览器中展示的内部依赖随目标库保存和导出，因此源库后续修改或删除不影响调用。插入会回指当前函数的同库依赖会被拒绝。会话保存时同时持有所属 `LocalFunctionLibraryDocument` 快照和当前 `FunctionDocument` 投影，通过 `saveFunction()` 在函数库 revision 边界执行 CAS，成功后用返回的完整函数库更新后续保存基线。直接访问导入库或内置库 ID 不能取得可编辑文档。

当前结构编辑器展示包含根 Frame 的可折叠节点树，支持选择节点，以及新增 Frame、Page、ChoiceQuestion，兄弟节点上移/下移、子树复制和确认删除。Page 节点内联编辑 Timeline，Function 节点内联编辑调用参数，ChoiceQuestion 节点内联编辑输出名、题干和全部选项；节点折叠后隐藏对应编辑内容。新增或复制后的节点自动成为当前选择；非 Frame 节点旁新增时作为同级节点插入，Frame 节点被选中时则添加为其子节点。Function 调用必须经过函数资源闭包复制应用操作，因此不通过普通节点插入入口创建。

作者态共享页面原语位于 `@ls101/page-renderer`。该包定义 1200×800 固定设计面、百分比几何、缩放容器及文本、图片和 ChoiceView 的基础视觉组件，不依赖 Template 作者态模型或 Player 编译态模型。学生端 `ExamPageView` 则是独立运行期渲染器：组件内部创建 Shadow Root，并把专用 `ExamPageView.css` 以内联私有样式安装到该根；它不导入 `renderer/styles/global.css`、主题 token 或 `ExamPlayer.module.css`。主程序和预览只能在 Shadow Host 外控制尺寸与变换，不能把全局元素选择器、主题变量或播放器布局样式注入学生端页面。

renderer 中栏提供“结构 / 页面”标签页。Page 画布支持新增文本、图片和 ChoiceView，单选、拖动、缩放、复制、删除及视图缩放；变量文本以 token 预览。选中块的 ID、百分比几何、文本表达式与格式、图片表达式和 ChoiceView 视口在右侧独立折叠区域编辑。交互继续提交现有内容块 mutation，因此共用文档撤销、重做、dirty 和保存语义；一次连续拖动或缩放只在指针释放时形成一个历史条目。

中栏同时提供“预览”模式。预览以当前选中的 Page、Frame、Function 调用或根 Frame 为范围，按编译展开顺序收集页面，并把每个 Page 的每个 Timeline step 映射为一个独立画面。进入预览后，左侧函数库切换为按 Page 分组的纵向胶片；胶片缩略图是不可聚焦的静态画面，中栏则复用学生端 ChoiceView，允许临时选择答案并在 free/range 允许范围内翻页。切换画面或重新进入预览会清空答案与分页状态；标题栏信息浮窗展示当前画面各 ChoiceView 的最终模式、可用分页、初始页或聚焦题，不向 1200×800 学生端画面插入调试标记。右侧显示 Interface 实例选择、预览范围、当前 Timeline 信息和校验错误。预览直接读取当前未保存工作文档，执行与导出一致的变量、函数、ChoiceCollector、Schema 和资源解析，但不合成 TTS 音频；Interface 实例选择只保留在当前编辑会话中，不写入 Template。

图片内容块保存独立的百分比宽高，渲染时保持图片原始比例并以 `contain` 方式在固定框内居中；长边撑满框，另一方向留空，不执行裁剪或拉伸。

ChoiceView 的 focus 模式在属性栏中按 Collector 展开结果选择“第几页 / 第几题”。renderer 使用与编译器一致的节点及函数调用展开顺序建立页题到 `questionRef` 的映射，不向用户暴露 scope、函数调用路径或题目节点 ID。

ChoiceView 的 free/range 页码同样使用基于 Collector 最终页数的下拉框。range 起止页联动并限制初始页候选，避免属性栏产生越界或反向区间。函数中的选择题允许由外部 Collector 收集；函数中的 ChoiceView 则必须在该函数展开范围内找到唯一 Collector，不能依赖调用方 Collector。

工作文档允许暂时不完整。删除函数输入、录音或选择题后，无法无歧义决定替代值的普通表达式不会被猜测式删除或改写，而由严格语义校验返回可定位错误。函数输入重命名和 Interface alias 重命名属于含义明确的操作，会重写当前可编辑正文中的对应变量引用。内嵌函数资源不随 alias 重命名而重写：函数禁止直接引用 Template Interface alias，只能通过调用输入接收 Interface 值，因此函数资源不捕获调用方命名空间。

`templates.validate()` 和 `templates.compile()` 会根据当前 Template 收集 Interface 与 Schema 身份，通过调用方提供的跨模块查询函数取得清单。编译时再把 Interface 实例选择及实例定位器交给底层异步编译器。renderer 通过 Interface 应用门面的 `published.getVarManifest()` 和 `instances.locate()` 取得变量、实例和附件源 URL，通过 `FileSchemaRepository.getSchema()` 读取最新正式 Schema。Schema 查询适配器会先校验 UUID；空值和编辑中的非法 `schemaId` 直接按不存在处理，使语义校验可以返回结构化 `UNKNOWN_SCHEMA`，不会让仓储参数异常中断校验。

## 严格语义校验

异步的 `validateTemplateDocument(document, context)` 从 Template 自带资源读取函数快照，复算每个资源的内容 ID，并拒绝非法 ID 或正文篡改。调用方只提供 Interface 变量清单和 Schema 评分块清单。底层同步的 `validateTemplateContent(content, context)` 仍可用于单独校验正文及显式函数集合，但不承担资源身份验证。两者都返回稳定错误代码、字段路径和参数，不生成面向用户的错误文案。

校验器按 Template 根或函数定义建立局部作用域，框架本身不创建隐式作用域。函数调用必须完整填写输入，并通过 `outputNames` 将每个手动出参重命名到调用方作用域；同一函数可以因此被多次调用。函数内部 Schema 消费随实际调用展开，但调用方不能改写其绑定。

当前校验覆盖：

- Interface 别名、依赖、acceptedVars 和变量类型；`this` 是 SchemaUse 附件命名空间的全局保留别名。
- 节点、内容块、选项、局部变量和 Schema use 的唯一性。
- 页面、时间线、文本插值、函数输入与出参的变量解析和类型匹配。
- 函数定义不能直接引用 Template Interface alias，Interface 值必须从调用点经函数输入传入。
- 正式 Schema、必填/未知文本输入、完整答案绑定及三类答案的类型匹配。
- SchemaUse 附件名称、外层 `file` 表达式、当前评分单元内 `[@this.varName]` 引用和作用域隔离。
- 函数缺失、输入/出参映射完整性和递归调用。
- 内嵌函数资源 ID 格式、正文摘要和嵌套依赖闭包。
- ChoiceCollector 嵌套、全卷唯一候选、分页字面量、题数总和和未收集题目。
- 选择题视图是否具有唯一 ChoiceMeta，以及 free/range 页码范围。
- 展开后的 Template 是否至少消费一个 Schema。

## 试卷包编译

异步的 `compileTemplate(document, context)` 先对工作文档执行完整语义和资源完整性校验，再使用导出时传入的 Interface 实例选择展开 Template。函数定义只从 `document.resources.functions` 读取，不访问函数库。成功时返回 `ExamPackage`；失败时通过判别联合返回校验阶段或编译阶段的结构化错误，不生成部分试卷包。

编译器分两阶段工作。第一阶段展开框架和函数调用，分配全局 `recordIndex`、`choiceIndex` 并建立静态值依赖；第二阶段统一求值页面内容、时间线、选择题、函数静态出参和 Schema 字段。因此页面或函数输入可以引用同层稍后声明的静态输出，跨函数形成的静态值循环会作为编译错误返回。

当前编译行为包括：

- 校验每个 Interface 别名恰好有一个实例选择；通过调用方提供的仓储定位器按 `instanceId` 获取唯一定位结果，并验证真实仓储归属匹配 `interfaceId`，且所有 acceptedVars 都有实例值。
- 按函数调用路径展开页面、内容块、录音、选择题、函数出参和函数内部 Schema 消费。
- 为展开后的页面和内容块生成稳定 ID，为每次函数内部 Schema 消费生成调用路径限定的实例 ID。
- 收集唯一 ChoiceCollector 候选，生成全局只读 ChoiceMeta，并把结构化 focus 地址解析为 `choiceIndex`。
- 把文本插值、静态参数和 Interface 图片值求值为 Player 可直接消费的数据。
- 把 Schema 静态文本输入解析为字符串，把 `text` 答案编译为 choice 索引，把 `fixed-speech` 编译为固定原文与录音索引，把 `free-speech` 编译为录音索引。
- 求值 SchemaUse 的附件 `file` 表达式，生成 `resource:<assetKey>`，写入 `ExamPackage.resources` 清单，并在编译结果旁返回仅供归档写入阶段使用的源 URL。

跨模块 `ExamPackage` 契约位于 `@ls101/core-types`。`player` 只包含页面、时间线、录音索引和可选的 ChoiceMeta；`schema` 保存精确的正式 Schema 定义快照及每次使用的输入/答案映射；`resources` 保存逻辑资源键到包内路径和媒体元数据的映射。作者机器上的源 URL 不进入持久化 ExamPackage。

## 未实现边界

工作文档允许保存不完整状态；编译入口会自行执行严格校验。以下能力尚未实现：

- Page 画布的多选、吸附辅助线、键盘微调和画布内直接文本编辑。
- 跨函数调用路径中深层编译错误的逐级调用栈导航。

## 验证覆盖

单元测试覆盖完整递归文档解析、损坏及非法 JSON 文件读取、严格 JSON 编辑状态、跨仓储实例 revision/CAS、autosave 与函数嵌入/清理并发、工作文档 CRUD、函数依赖闭包复制与去重、嵌套 Frame 引用改写、源删除隔离、递归拒绝、函数内部 Schema 清单收集、不可达资源清理、应用层依赖组装、函数资源摘要、结构化错误契约、函数作用域、Schema 绑定、Collector 和视图约束。编辑测试覆盖不可变/revision 语义、节点冲突重命名、子树内部引用和 focus 重写、移动约束、内容块级联清理、录音复制、函数调用签名协调、输入和 Interface alias 重命名、资源级联清理，以及函数闭包复制与调用插入的单次保存和失败无残留。renderer 测试覆盖保存期间继续编辑、保存失败后保持历史与 dirty 并允许重试、加载异常、mutation 拒绝、路由会话隔离、离开确认、折叠 Frame 内新增节点可见、嵌套节点增删移动复制、undo/redo 和保存 clean 基线。编译测试额外覆盖完整 Player/Schema 输出、重复及嵌套函数调用、函数内部相对与绝对 focus、number/file/audio 出参、全局录音索引、跨调用静态值循环、多 Interface/Schema 隔离和仓储归属验证。
