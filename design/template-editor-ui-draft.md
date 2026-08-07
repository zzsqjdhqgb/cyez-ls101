# Template 编辑器前端临时需求记录

> 临时记录，不替代正式设计文档。“已确认”记录用户明确提出的内容；“暂定细节”记录待用户继续确认的实现设想。

## 协作方式

- 用户说一点，实现一点。
- 用户提出的内容如果可以独立实现，则在记录后直接实现该独立部分。
- 不自行扩展尚未明确的产品逻辑。

## 已确认

- Template 编辑器使用左、中、右三栏结构。
- 左侧是函数库。
- 中间是节点树。
- 右侧是属性列表。
- 节点的关键属性直接显示在节点树卡片内，卡片本身应能表达并编辑节点内容。
- 节点具有独立的可编辑显示名称 `name`。名称是纯常量字符串，不接受变量；它不参与节点寻址、变量解析或编译引用。
- 节点卡片以显示名称为主标题，并在次要位置保留系统维护的节点 ID；旧节点未设置名称时按节点类型回退显示。
- 节点 ID 不作为显示名称编辑。它继续承担节点定位和部分编译引用，避免名称修改触发引用重写。
- 节点列表整体保持紧凑、简洁，优先使用熟悉的图标表达类型和操作，尽量减少 UI 文字。
- Page 节点在卡片内按执行顺序显示紧凑的 Timeline 列表；列表项通过图标区分 TTS、倒计时和录音，不再显示“录音”“倒计时”等类型文字。
- Page 卡片中的 Timeline 是可增减列表：列表头加号提供三种新增选项，每个列表项末尾提供删除按钮。
- 点击 Timeline 列表头加号后，新增选择器作为列表最后一项显示，与普通列表项等高；选择器只显示 TTS、倒计时和录音的三个图标。
- Timeline 列表项直接内联编辑主要字段：TTS 显示一个文本输入框；倒计时显示一个时长输入框；录音显示时长和输出名称两个输入框。
- Timeline 列表项本身不使用卡片背景、边框或圆角，只有输入框保留实体背景；相邻列表项之间仅使用一条细横线分隔，整体高度和间距尽量紧凑。
- 节点卡片内的属性列表应尽量具备与右侧属性栏相同的完整编辑能力，不能只支持新增和删除等部分操作。
- 叶子节点也启用卡片折叠；折叠后只保留节点标题行，并隐藏卡片内的全部属性、列表和操作。
- 其他节点的属性和集合后续沿用“卡片内紧凑、图标优先、功能完整”的交互模式。
- 左侧函数库与右侧属性栏都可以通过分隔条拖动调整宽度；窗口变宽时，中间编辑区优先扩展。
- 左右侧栏在编辑工作区内始终上下撑满，只允许内容纵向滚动，不出现横向滚动条。
- 右侧属性栏由可复用的折叠区域组成；全局属性和节点属性是首批区域，后续新增属性区域复用同一组件和交互。
- 全局属性包含 Template 的 Interface 依赖配置。用户从已发布 Interface 中选择并添加依赖，为其设置 Template 内唯一别名，并勾选该 Template 可以使用的变量；已有依赖可继续编辑别名、变量范围或移除。
- Template 编辑器中的“添加 Interface”只建立 `interfaceId + alias + acceptedVars` 依赖，不负责导入 `.lsinterface` 文件；文件包导入仍由 Interface 管理页面统一处理。
- 左侧当前来源没有函数库时，显示带图标、来源标题和简短说明的面板内空状态。
- 左侧函数库采用类似 draw.io 形状库的组件素材面板：内置、导入、本地使用顶部标签页切换，函数库作为可折叠分组，函数和基础组件以单列横向卡片展示。
- 素材卡片本体只展示信息，点击卡片不执行操作；只有卡片右侧的加号按钮会把对应组件或函数添加到模板。
- 内置、导入、本地只通过标签页分隔，不再额外使用颜色编码；素材面板统一使用编辑器主题色。
- 左侧按内置、导入、本地三个来源分类显示函数库。
- 组件只能从左侧函数库点击添加；节点树不提供直接新增组件入口。
- 内置、导入和本地都是函数库的来源分类，不是函数的来源分类。
- 每个来源下都可以有多个函数库，每个函数库可以包含多个函数。
- 内置库、导入库和本地库分别查找，不要求合并到同一个仓储或 ID 空间。
- 内置库、导入库和本地库需要各自适用的版本管理。
- 内置资源使用内置 key。
- 新建的自定义资源使用随机 UUID。
- 内置资源不可导出。
- 自定义资源可以导出，导出时 UUID 保持不变。
- 导入资源时沿用导出包中的原 UUID。
- 版本号不由用户显式指定，使用自增版本号。
- 系统记录上次导出的内容哈希；再次导出时，如果内容哈希发生变化，版本号自增一位。
- 本地自定义函数库的版本信息不参与编辑逻辑，只作为导出辅助状态。
- 当前维护“基础组件库”和临时的“示例组件库”。
- 基础组件库是唯一直接插入节点的特例；示例组件库导出普通函数，后续可以整库删除。
- 当前以独立函数为单位的仓储格式需要改为以函数库为单位。
- 软件安装目录只保存随当前软件版本发布的内置函数库 release。
- File Store 层提供一个通用的只读 Builtin Scoped Store，用于读取安装目录中随软件发布的资源。
- Builtin Scoped Store 只负责安全读取和列举资源，不负责把资源复制到任何业务仓储。
- Template Editor 初始化时自行通过 Builtin Scoped Store 读取内置函数库，并登记到自己的用户数据目录。
- 初始化完成后，编辑器运行期间从 Template Editor 仓储读取内置函数库，不直接使用安装目录中的文件。

### 变量输入与自动补全

- 变量不再通过独立的“作用域 + 变量名”表单控件输入，而是在对应输入框内通过 `@` 触发上下文变量补全。
- 补全列表先按当前字段要求的变量类型过滤，只显示类型兼容的变量。
- 如果当前上下文没有类型兼容的变量，补全列表只显示一项不可选中的“无可用变量”。
- 可拼接文本允许在输入内容的任意位置输入 `@`。选择变量后，从触发位置开始的 `@`及其查询前缀被替换为 `[@varname]`。
- `@` 后继续输入字符时，补全列表按变量名前缀实时匹配。例如 `@se` 只显示名称以 `se` 开头的变量；删除前缀字符后，列表立即恢复为新前缀对应的匹配结果。
- 数字、选择题返回结果等不可拼接的字段，整个字段只能是一个常量或一个变量。
- 不可拼接字段为空时，输入 `@` 会弹出类型兼容的变量列表。字段非空时，输入 `@` 不会将 `@` 写入字段，补全列表只显示一项不可选中的“请先清空输入框”。
- 补全弹层在输入框附近展开，视觉和信息密度参考 VS Code 的变量名补全列表。
- 局部变量与 Interface 变量重名时的候选项展示和插入格式尚未确认，实现时不自行推断。
- 编辑器修改函数调用输出名、选择题输出名或录音输出名时，自动重写当前定义作用域中对旧局部变量名的引用；这是编辑辅助行为，不改变编译器的变量绑定规则。

## 暂定细节

以下内容是当前实现设想，尚未全部确认。

### ID 与定位

```typescript
type LibraryId = `builtin:${string}` | UUID
type FunctionId = `builtin:${string}` | UUID

type FunctionLibraryLocator =
  | {
      source: 'builtin'
      libraryId: `builtin:${string}`
    }
  | {
      source: 'imported'
      libraryId: UUID
      version: number
    }
  | {
      source: 'local'
      libraryId: UUID
    }

interface FunctionLocator {
  library: FunctionLibraryLocator
  functionId: FunctionId
}
```

- 内置库和内置函数使用带 `builtin:` 前缀的稳定 key。
- 自定义库和自定义函数使用 `crypto.randomUUID()` 生成 UUID v4。
- 版本号不进入资源 ID；同一资源产生新版本时 ID 保持不变。
- 导出包中的函数定位可以使用 `libraryId + version + functionId`。
- 查找函数时先根据 `source` 选择函数库来源，再通过 `libraryId` 找到函数库，最后通过 `functionId` 在库内找到函数。
- `source` 不是函数自身身份的一部分，而是编辑器定位函数库数据源所需的信息。
- 导入时不自动重写 UUID，否则会破坏版本继承关系和函数内部引用。
- 将来可以提供显式的“导入为副本”；只有该操作会为库和全部函数生成新 UUID，并重写完整函数依赖图。

### 函数库层级

函数库按以下层级组织：

```text
来源分类（内置 / 导入 / 本地）
  └─ 多个函数库
       └─ 多个函数
```

- `source` 描述的是函数库来源，不是函数来源。
- 三个来源下都允许存在多个函数库。
- 每个函数库包含多个函数；函数必须通过所属函数库定位。
- 左侧 UI 先展示来源分类，再展示该来源下的函数库，展开函数库后才展示函数。
- 查找函数时不能只提供 `functionId`，需要同时提供函数库定位信息。

### 三类数据源

三类函数库分别使用不同的数据源，不要求合并成一个仓储：

```typescript
interface BuiltinFunctionLibraryCatalog {
  listLibraries(): readonly BuiltinFunctionLibrary[]
  getLibrary(libraryId: `builtin:${string}`): BuiltinFunctionLibrary | null
}

interface ImportedFunctionLibraryRepository {
  listLibraries(): Promise<readonly ImportedFunctionLibraryRelease[]>
  getLibrary(libraryId: UUID, version: number): Promise<ImportedFunctionLibraryRelease | null>
}

interface LocalFunctionLibraryRepository {
  listLibraries(): Promise<readonly LocalFunctionLibraryDocument[]>
  getLibrary(libraryId: UUID): Promise<LocalFunctionLibraryDocument | null>
}
```

- 内置函数库是随应用发布的只读定义。
- 导入函数库按 `libraryId + version` 保存不可变 release，同一个库的多个版本可以并存。
- 本地函数库是可编辑工作文档，使用 `revision` 进行并发保存，并保存导出辅助状态。
- 应用层根据 `FunctionLibraryLocator.source` 路由到对应数据源。
- 三类函数库只在“把函数复制进 Template”时进入同一条复制流程；复制结果仍是 Template 自带的不可变函数依赖闭包。

### 内置函数库存储

当前实现已经提供函数库仓储和内置 release 启动初始化；安装清单登记“基础组件库” v2，包含当前 DSL 的三个不可拆分原子组件：框架、页面和选择题；同时登记临时的“示例组件库” v2，其中只有“标题页组合”和“选择题组合”两个普通函数。只有 `builtin:basic` 被应用层硬编码为单节点预设库，点击时直接插入节点；包括示例库在内的其他函数库条目都生成函数调用节点。

现阶段的实现设想：

- 安装包携带一份内置函数库清单，其中每个函数库只包含当前软件版本配套的当前 release。
- File Store 层新增只读 Builtin Scoped Store。开发环境映射到项目内的 builtin 资源根目录；打包环境映射到 Electron `process.resourcesPath` 下的固定 builtin 资源目录。
- Builtin Scoped Store 使用与普通 Scoped Store 相同的 scope、`.text`、`.assets`、路径校验和列举规则，但公开类型中不包含写入、删除、CAS 或 clear 方法。
- Builtin Scoped Store 是通用基础设施，不知道 Template、函数库或任何业务初始化规则，也不执行复制。
- Template Editor 的应用初始化通过 Builtin Scoped Store 读取并解析内置函数库 release，再使用自己的可写 Template Repository 将 release 登记到 `userData/template-editor/function-libraries/builtin`。
- 其他需要 builtin 数据的模块可以复用同一个只读读取层，并自行决定缓存、转换、复制或直接使用策略。
- Renderer 不接收任意文件系统路径；所有读取仍通过白名单 IPC 和受校验的结构化 scope 完成。
- 内置 release 在用户数据仓储中仍然只读，没有工作文档 `revision`、导出状态或编辑状态。
- 内置目录的数据结构支持多个函数库；当前提供 `builtin:basic`“基础组件库”和可随时删除的 `builtin:examples`“示例组件库”。
- 基础组件库只包含不可拆分的原子节点预设，示例组件库只承担普通复合函数示范用途。
- 所有内置库和函数的稳定 key、函数引用及定义都应在测试中统一校验。

Template Editor 的初始化不是把内置 release 转换为本地可编辑函数库，而是把受软件管理的不可变 release 从 Builtin Scoped Store 登记到自己的用户数据仓储。三类函数库因此可以在运行期通过统一的 Template Editor 仓储边界读取，同时仍保持不同的写入规则。

### Builtin Scoped Store 边界

```typescript
interface BuiltinFileStore {
  scope(name: string): ReadonlyScopedStore
  readAsset(key: AssetKey): Promise<Uint8Array | null>
  getAssetUrl(key: AssetKey): string
}

interface ReadonlyScopedStore {
  scope(name: string): ReadonlyScopedStore
  readText<T>(filename: string): Promise<T | null>
  hasText(filename: string): Promise<boolean>
  listText(): Promise<string[]>
  readAsset(filename: string): Promise<Uint8Array | null>
  hasAsset(filename: string): Promise<boolean>
  listAssets(): Promise<string[]>
  getAssetKey(filename: string): AssetKey
  getAssetUrl(filename: string): string
  listScopes(): Promise<string[]>
}
```

- 不公开 `writeText`、`compareAndSwapText`、`deleteText`、`writeAsset`、`deleteAsset` 或 `clear`。
- Main 进程仅注册只读 IPC 和只读 asset protocol，并将逻辑 scope 映射到固定 builtin 资源根目录。
- 读取层不接受调用方提供的绝对路径或相对路径字符串。

### 仓储目录格式

```text
userData/
└─ template-editor/
   ├─ templates/
   │  └─ <template UUID>/
   │     └─ .text/template.json
   └─ function-libraries/
      ├─ local/
      │  └─ <library UUID>/
      │     └─ .text/library.json
      ├─ imported/
      │  └─ <library UUID>/
      │     └─ releases/
      │        └─ v<version>/
      │           └─ .text/library.json
      └─ builtin/
         └─ <builtin library key>/
            ├─ .text/active.json
            └─ releases/
               └─ v<version>/
                  └─ .text/library.json
```

- 逻辑 ID `builtin:basic` 中的 `builtin:` 是类型前缀，不直接作为 File Store scope；物理目录使用经过严格校验的内置 key，例如 `basic`。
- 本地函数库只有一份持续编辑的 `library.json`，使用文档 `revision` 和 CAS 保存。
- 导入和内置函数库保存不可变 release；版本目录使用 `v<正整数>`，同一函数库的不同版本允许并存。
- `active.json` 只用于指出当前安装的软件版本应使用哪个内置 release，不复制函数库正文。
- Template 继续单独存储；已经复制进 Template 的函数依赖闭包不依赖函数库仓储。
- 应用尚未发布，旧的 `function-libraries` 之外的独立 `functions/<functionId>` 格式不做迁移兼容。

### Template 内置 release 初始化

暂定使用以下幂等规则：

1. Template Editor 通过 Builtin Scoped Store 读取当前内置函数库清单。
2. 完整校验清单、函数库结构、稳定 key、版本号和内容哈希；任何一项无效时 Template Editor 初始化失败。
3. 如果用户数据中不存在对应 `libraryId + version`，原子写入该不可变 release。
4. 如果已经存在且内容哈希相同，跳过正文写入。
5. 如果已经存在但内容哈希不同，视为安装资源冲突或用户数据损坏，拒绝静默覆盖并终止初始化。
6. release 全部登记成功后，将各函数库的 `active.json` 更新为本次安装携带的版本。

保留旧的内置 release，而不是每次启动时删除。这样应用升级后，旧版本仍可满足已导入函数库或其他带版本依赖的资源；软件降级时，`active.json` 可以重新指向降级版本，而不会破坏较新 release。

### 工作文档与导出包

```typescript
interface FunctionLibraryDocument {
  libraryId: string
  revision: number
  content: FunctionLibraryContent
  exportState?: {
    version: number
    contentHash: string
  }
}

interface ExportedFunctionLibrary {
  libraryId: string
  version: number
  contentHash: string
  content: FunctionLibraryContent
}
```

- `revision` 只用于本地仓储的并发保存，不是用户可见版本。
- `exportState` 是本地辅助状态，不属于函数库语义内容。
- 导入库和内置库的 release 是不可变数据。
- 版本暂按整个函数库统一管理，而不是为库内每个函数分别生成版本；这样可以保证嵌套函数依赖闭包一致。

### 自动版本规则

1. 对当前函数库的语义内容进行规范化并计算 SHA-256。
2. 从未导出过时使用版本 `1`。
3. 当前哈希等于上次导出哈希时，继续使用原版本号。
4. 当前哈希与上次导出哈希不同时，版本号加 `1`。
5. 成功生成 release 后，更新本地 `exportState`。

如果内容修改后又恢复到上次导出的状态，哈希重新相同，不产生新版本。如果内容与更早版本相同、但与最后一次导出不同，仍产生新的递增版本，以保持版本历史单调。

### 内容哈希范围

内容哈希包含：

- 影响导出和运行结果的函数库元数据。
- 函数定义。
- 函数之间的嵌套引用。
- 完整函数依赖闭包。

内容哈希不包含：

- 仓储 `revision`。
- 编辑器状态。
- `exportState`。
- 不影响语义的 UI 排序和临时状态。

函数列表和对象字段在计算哈希前需要规范化，避免相同语义因为存储顺序不同产生新版本。

### 导入冲突

- UUID、版本号和内容哈希都相同：视为已经导入，幂等跳过。
- UUID 和版本号相同、内容哈希不同：拒绝导入，报告 ID 冲突或导出包损坏。
- UUID 相同、版本号不同：作为同一函数库的不同版本保存，可以并存。
- 导入过程不能静默覆盖现有版本，也不能自动重新生成 UUID。

### 导出一致性

- 应先在应用内部生成并登记不可变 release，再将该 release 写入用户选择的文件。
- release 的版本号与内容哈希需要原子登记，避免同一版本号对应两份不同内容。
- 用户文件写入失败时允许留下未写出的版本号空缺，但不能复用该版本号导出另一份内容。
- 重复导出同一内容时可以重新生成同一版本的相同导出包。

### UI 状态

本地自定义函数库可以显示以下辅助状态：

- `未导出`
- `已导出 v3`
- `v3 后有修改`

这些状态只反映导出历史，不限制本地编辑，也不要求用户先发布才能把函数复制进 Template。

### 内置依赖

- 内置资源本身不可导出。
- 自定义函数引用内置函数时，导出包只记录内置库 key、版本号和函数 key，不复制内置函数内容。
- 导入时检查所需内置库版本是否存在；缺失时应报告依赖错误。
