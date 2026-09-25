<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: builtin-content
-->

# 内置内容生命周期（builtin-content）

## 架构

内置内容随应用分发在只读资源树 `resources/builtin/`，应用在每次启动时把它对账（reconcile）或播种（seed）到用户数据目录。四类内置对象由三个领域包负责：

| 内置对象           | 资源清单                                                                  | 初始化入口                                                                                             | 落地位置                                          |
| ------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| 评分单元（Schema） | `resources/builtin/schema-editor/.text/builtin-schemas.json`              | `initializeBuiltinSchemas`（`packages/schema-editor/src/builtin-initializer.ts`）                      | 用户 Schema 仓储的 `published` 分区               |
| 题型（Interface）  | `resources/builtin/interface-editor/builtin/<builtinKey>/`                | `createBuiltinInterfaceApplication(...).reconcile`（`packages/interface-editor/src/builtin-entry.ts`） | 用户 Interface 仓储的 `builtin` 分区              |
| 试卷模板           | `resources/builtin/template-editor/.text/builtin-templates.json`          | `initializeBuiltinTemplates`（`packages/template-editor/src/builtin-initializer.ts`）                  | 用户 Template 仓储的 `builtin-templates`          |
| 函数库             | `resources/builtin/template-editor/.text/builtin-function-libraries.json` | `initializeBuiltinFunctionLibraries`（同上）                                                           | 用户 Template 仓储的 `function-libraries/builtin` |

只读读取链：

- 主进程在 `src/main/index.ts:50` 计算 `builtinDataDirectory`：打包后为 `process.resourcesPath/builtin`，开发态为 `app.getAppPath()/resources/builtin`。`electron-builder.yml` 的 `extraResources` 把 `resources/builtin` 复制为打包资源目录下的 `builtin`。
- `src/main/application-services.ts:41` 调 `registerBuiltinFileStoreHandlers({ baseDir: builtinDataDirectory })`。`packages/file-store/src/main/builtinHandlers.ts` 只注册读取类 IPC（`builtin-file:read-text` / `has-text` / `list-text` / `read-asset` / `has-asset` / `list-assets` / `list-scopes`），没有写入 channel。
- preload 用 `allowedBuiltinChannels` 白名单暴露 `window.builtinFileStore`（`src/preload/index.ts:70`）；renderer 端 `BuiltinScopedStoreImpl` 实现 `ReadonlyScopedStore`，资产地址走独立的 `builtin-asset://local/...` 协议（`packages/file-store/src/shared/constants.ts:3`）。
- 内置清单的读取不经过用户数据目录，renderer 也没有改写 `resources/builtin` 的通道。

`resources/builtin` 只有 `interface-editor/`、`schema-editor/`、`template-editor/` 三棵树。AIRouter 自身的内置提供商（例如 `packages/airouter/src/shared/constants.ts` 的 `builtin-facebook-phoneme`）不由本子系统分发。

## 运行时与生命周期

启动顺序固定在 `packages/renderer/src/startup-active-application.tsx:40`：

1. `builtin-schemas` → `initializeSchemaApplication`
2. `builtin-interfaces` → `builtinInterfaceMaintenance.initialize()`
3. `builtin-templates-and-functions` → `templateApplication.initialize()`

三步都由 `runStartupPhase`（`packages/renderer/src/startup-phase.ts`）包裹：让出一次事件循环、记录 `phase` 与 `durationMs`、失败时把异常继续上抛。异常最终由 `startup-application.tsx` 渲染成启动错误页，恢复手段是重新加载应用。

初始化不是"首次运行复制一次"的安装步骤，而是每次启动都从 bundle 对账；每个入口用模块级 promise 记忆化，因此同一 renderer 会话内只执行一次：

- Schema：`initializeSchemaApplication`（`packages/renderer/src/features/schemas/SchemaApplicationRuntime.ts`）读 `builtin-schemas.json` 后逐个 `registerBuiltinSchema`。
- Interface：`reconcile` 先用 `FileBundledInterfaceRepository.loadAll()` 读取全部 `builtinKey`，逐 key 决策，再为 bundle 中已消失的 key 生成移除计划。
- Template 与函数库：`templateApplication.initialize()` 逐个注册 release，然后用清单中的 `{id, version}` 重写 `active.json`。

### 覆盖、重建与保留策略

| 对象              | 判定                                                  | 结果                                                        |
| ----------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Schema            | 目标 `schemaId` 不存在                                | CAS 写入 bundle 定义并标记为内置                            |
| Schema            | 已存在且 `structureHash` 相同                         | 保留现有内容，仅标记为内置                                  |
| Schema            | 已存在但内容非法或 `structureHash` 不同               | CAS 覆盖为 bundle 定义，不保留副本                          |
| Interface         | `previous.id === next.id`（内容寻址 ID 相同）         | `none`，`saveBuiltinInterface` 幂等返回后保留               |
| Interface         | 变量契约相同、字段 JSON 结构相同                      | `automatic`，自动迁移题组与 Template 引用后删除旧 Interface |
| Interface         | 变量契约相同、字段 JSON 结构不同                      | `manual`，进入待处理对话框，由用户选择迁移或保留旧版        |
| Interface         | 变量契约不同                                          | `invalid-contract`，拒绝自动更新，保留旧 Interface          |
| Interface         | 磁盘上存在、bundle 中已无该 `builtinKey`              | 生成移除计划，由用户选择删除或转存为用户题型                |
| Template / 函数库 | 同 `id` + 同 `version` 且 releaseHash、规范化内容一致 | 幂等保留                                                    |
| Template / 函数库 | 同 `id` + 同 `version` 但内容不同                     | 抛 `RELEASE_CONFLICT`，对应启动阶段失败                     |
| Template / 函数库 | 新的 `version`                                        | 写入新 release 并切换 `active.json`                         |

模板与函数库按发布版本累积：`setActive...` 只重写活动清单，不删除磁盘上的旧版本目录。Interface 的 `manual` / `invalid-contract` / 移除计划通过 `BuiltinInterfaceMaintenanceCoordinator` 暴露成内存快照（`packages/renderer/src/features/interfaces/BuiltinInterfaceMaintenance.ts`）。

## 存储与格式

### bundle 侧

```text
resources/builtin/interface-editor/builtin/<builtinKey>/.text/current.json
resources/builtin/interface-editor/builtin/<builtinKey>/versions/<sha256>/ .text/interface.json
resources/builtin/schema-editor/.text/builtin-schemas.json
resources/builtin/template-editor/.text/builtin-templates.json
resources/builtin/template-editor/.text/builtin-function-libraries.json
```

- `current.json` 恰好两个字段：`builtinKey` 与 `currentInterfaceId`；`currentInterfaceId` 形如 `sha256:<64hex>`，`versions/` 下的目录名就是该摘要（`packages/interface-editor/src/bundled.ts`）。目录名必须匹配 `[a-zA-Z0-9][a-zA-Z0-9_-]*`。
- Schema 清单恰好一个字段 `schemas`；Template 清单恰好一个字段 `templates`；函数库清单恰好一个字段 `libraries`。三份清单都会拒绝重复 ID，并对每项做结构与密码学校验。
- 当前 bundle 内容：14 个评分单元、3 个 `builtinKey`（共 5 个 Interface 版本）、12 个模板 release、7 个函数库 release。

### 用户数据目录侧

```text
<data>/schema-editor/published/<schemaId>/.text/schema.json
<data>/interfaces/builtin/<builtinKey>/.text/current.json
<data>/interfaces/builtin/<builtinKey>/versions/<sha256>/.text/interface.json
<data>/interfaces/published/<sha256>/.text/interface.json
<data>/template-editor/builtin-templates/releases/<templateId>/v<version>/.text/template.json
<data>/template-editor/builtin-templates/.text/active.json
<data>/template-editor/function-libraries/builtin/<id>/releases/v<version>/.text/library.json
<data>/template-editor/function-libraries/builtin/.text/active.json
```

`.text` 与 `.assets` 目录名来自 `packages/file-store/src/shared/constants.ts`；file-store 基目录即当前数据目录（`src/main/application-services.ts:40`）。

标识语义：

- Schema `schemaId` 是 UUID v4，另有 `structureHash`（`sha256:` + SHA-256）；`structureHash` 只覆盖 `questionType`、`answerFormat`、`templateInputs`，不含 `data`。
- Interface ID 是内容寻址的 `sha256:<64hex>`；`packages/interface-editor/src/id.ts` 的 `verifyInterfaceId` 在读取时重算校验。
- Template release 有稳定 UUID `templateId`、从 1 递增的 `version` 和 `releaseHash`；函数库 release 有 `libraryId`（内置为 `builtin:<slug>`）、`version` 和 `contentHash`。
- 内置函数 `functionId` 必须匹配 `builtin:[a-z0-9][a-z0-9_-]*`；内置函数库 ID 必须匹配 `builtin:([a-z0-9][a-z0-9_-]*)`（`packages/template-editor/src/repository.ts:28`）。

## 失败与恢复

- 清单缺失或格式非法：`initializeSchemaApplication` 抛 `Builtin Schema manifest is missing`；解析层另有 `BuiltinSchemaInitializationError`、`BundledInterfaceRepositoryError`、`BuiltinTemplateInitializationError`、`BuiltinFunctionLibraryInitializationError`，均使对应启动阶段失败。
- 模板/函数库同版本内容冲突：抛 `TemplateRepositoryError('RELEASE_CONFLICT')`。升级内容必须同时在清单里提升 `version`。
- Interface 更新失败回滚：`applyBuiltinUpdate` 先移动题组、再迁移 Template 引用、再切 current、最后删旧 Interface；任一步失败时按相反顺序回滚已完成的步骤。`backup-old` 选择若转存失败，会把 current 切回旧 Interface 后抛错。移除计划在转存失败时用原定义重新安装内置 Interface（`packages/interface-editor/src/builtin.ts`）。
- Interface `invalid-contract`：不写盘，旧 Interface 继续作为 current；对话框只提供"知道了"，`dismiss` 仅从内存快照移除该计划，不持久化，下次启动会再次出现。
- Schema 覆盖无备份：`registerBuiltinSchema` 在结构变化或现有内容非法时直接 CAS 覆盖同 ID 的 `published` 记录，不写冲突日志或备份。`data` 字段变化不触发覆盖，因为 `structureHash` 不含它。
- 会话内不重试：三个初始化入口记忆化的是同一个 promise，一次失败后在同一 renderer 会话中再次调用得到同一个拒绝结果；恢复方式是重新加载/重启应用。

## 运维入口

- 确认 bundle：直接查看 `resources/builtin/`；`resources/builtin/interface-editor/README.md` 记录当前 `builtinKey` 及来源。
- 确认已播种内容：在“数据目录”设置指向的目录下查看上表路径。`active.json` 是模板/函数库的活动版本清单。
- 用户可见入口：
  - Schema：`SchemaBrowserPage` 的“内置 / 我的评分单元”页签与“内置”徽标；`SchemaDefinitionPage` 对内置项显示“内置 · r<n>”，隐藏删除按钮，把保存按钮替换为“复制并修改”（`readOnly` 绑定内置标志）。
  - Interface：`InterfaceListPage`/`InterfaceDetailsPage` 的“内置”徽标；导入/导出页显示“内置题型 · <builtinKey>”。待处理计划由 `BuiltinInterfaceMaintenanceDialog` 以模态框呈现，挂载在 `packages/renderer/src/app/App.tsx:51`。
  - Template：`TemplateBrowserPage` 的“内置模板”页签，每项提供“查看”“创建副本”“生成试卷”；`TemplateDocumentPage` 对内置模板显示“内置模板 · 只读”，只留“创建副本”。函数库列表中 `source === 'builtin'` 的库不显示重命名、编辑或删除操作。
  - 内置对象不能就地编辑/删除：Schema 仓储对内置 ID 抛 `BUILTIN_SCHEMA`；Interface 仓储拒绝把已属于内置分区的 ID 另存为用户内容，并拒绝删除 current 内置 Interface；模板与函数库的内置 release 与用户内容分属不同 scope，编辑路径只作用于用户 scope。
- 维护入口：修改评分单元/Template/函数库内容时，同步更新对应清单；Template/函数库必须提升 `version`。修改内置 Interface 内容会产生新的 `sha256` ID，需同步更新 `current.json` 与 `versions/` 目录。
- 验证覆盖：`packages/renderer/src/__tests__/BuiltinContentContract.test.ts`（加载三份清单、把每个内置模板编译成合法试卷包、校验内置库/函数 ID）、`packages/schema-editor/src/__tests__/schema-domain.test.ts`、`packages/interface-editor/src/__tests__/bundled.test.ts`、`packages/template-editor/src/__tests__/builtin-initializer.test.ts`、`builtin-template-initializer.test.ts`、`packages/renderer/src/__tests__/startup-phase.test.ts`。

## 已知限制 / 未决

- Schema 升级只比较 `structureHash`，因此 bundle 中只改 `data`（名称、说明、答案描述等）不改变结构时，已播种副本不会更新。
- Schema 覆盖没有冲突提示、备份或用户可见记录；同 ID 的本地内容会被静默替换并转为内置，之后不可编辑/删除。
- Interface 的“保留旧版”会把旧 Interface 移到 `published` 分区作为用户题型；`manual`/`invalid-contract`/移除三类计划只在内存中，`dismiss` 不持久化。
- 内置 Template 与函数库从清单移除时不会生成任何用户提示：`active.json` 只是不再包含它，旧 release 目录仍留在磁盘，也没有删除入口。这与 Interface 的移除计划不一致。
- bundle 整体没有统一的版本号或索引文件；Schema/Template/函数库用固定文件名发现，Interface 用 `listScopes()` 发现。
- 三个初始化入口的 promise 记忆化使单会话失败后无法重试，只能重启。
- `packages/editor-kit` 与 `packages/section-engine` 是空壳包；内置内容的加载与对账不依赖二者。

## 代码依据

- `resources/builtin/interface-editor/README.md`、`resources/builtin/**`（内置资产与三份清单）
- `src/main/index.ts`、`src/main/application-services.ts`、`src/main/bootstrap.ts`（内置目录与只读 file-store 注册）
- `src/preload/index.ts`、`packages/file-store/src/main/builtinHandlers.ts`、`packages/file-store/src/renderer/BuiltinScopedStore.ts`、`packages/file-store/src/shared/constants.ts`、`packages/file-store/src/shared/assetKey.ts`（只读通道与资产协议）
- `packages/schema-editor/src/builtin-initializer.ts`、`repository.ts`、`identity.ts`（Schema 播种与保护）
- `packages/interface-editor/src/bundled.ts`、`builtin.ts`、`builtin-entry.ts`、`repository.ts`（Interface 对账、升级、移除与保护）
- `packages/template-editor/src/builtin-initializer.ts`、`repository.ts`、`types.ts`（模板与函数库 release 注册、活动清单与保护）
- `packages/renderer/src/startup-active-application.tsx`、`startup-phase.ts`、`features/schemas/SchemaApplicationRuntime.ts`、`features/interfaces/BuiltinInterfaceRuntime.ts`、`features/interfaces/BuiltinInterfaceMaintenance.ts`、`features/interfaces/BuiltinInterfaceMaintenanceDialog.tsx`、`features/templates/TemplateApplicationRuntime.ts`（启动接线与 UI 接入）
- `electron-builder.yml`（`extraResources` 中的 `resources/builtin` → `builtin`）
