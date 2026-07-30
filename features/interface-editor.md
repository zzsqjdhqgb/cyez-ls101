# Interface Editor

## 功能状态

`@ls101/interface-editor` 已实现与 UI 框架无关的 Interface 领域模型、文件仓储、草稿与发布流程、实例编辑、导入导出、builtin 更新和五模块应用门面。

当前代码已具备供 renderer 调用的应用 API，但业务 renderer 尚未创建 bootstrap、React Context、页面或组件，也尚未连接真实 `@ls101/file-store`、`@ls101/file-dialog` 和 AIRouter 实例。测试使用内存仓储、测试文件对话框和测试文本生成流验证应用行为。

## 功能边界

Interface Editor 负责：

- 定义和校验 Interface 草稿、发布内容和字段树。
- 根据规范化内容生成稳定的 SHA-256 Interface ID。
- 管理草稿、用户发布内容、builtin 版本和附属实例。
- 为 UI 提供浏览、草稿、发布详情、实例和导入导出五组应用能力。
- 生成原始提示词、格式限制提示词和拼接后的完整提示词。
- 创建空白实例、整表保存实例、使用 JSON 或 AI 覆盖实例。
- 将 AI 文本增量流适配成通用任务进度句柄。
- 编解码和校验 `.lsinterface` ZIP 交换文件。
- 分类和执行 builtin Interface 更新。

Interface Editor 不负责：

- React 页面、表单、字段树组件、路由、弹窗或剪贴板操作。
- 创建应用级服务单例或向 React Context 注入服务。
- 实现真实 AI Router、模型选择、API Key 管理或供应商协议。
- 当前尚未实现的图片生成和图片资源替换流程。
- Template 引用仓储；builtin 更新通过注入的引用迁移端口调用外部实现。
- 提供底层文件系统 IPC；文件存储和系统对话框由其他 package 实现。

## Package 入口

### UI 应用入口

普通 renderer 代码从根入口导入：

```typescript
import { createInterfaceApplication, editInterfaceDraft } from '@ls101/interface-editor'
```

根入口只公开 UI 应用能力、领域 DTO、草稿编辑操作和公开结果类型，不公开仓储布局、ZIP 编解码、内容哈希 helper 或 builtin 迁移步骤。

### Bootstrap 适配器入口

应用组合层从以下子入口导入：

```typescript
import { FileInterfaceRepository } from '@ls101/interface-editor/adapters'

import { createBuiltinInterfaceApplication } from '@ls101/interface-editor/builtin'
```

`./adapters` 提供仓储接口、文件仓储实现和文件对话框端口。`./builtin` 提供 builtin 更新应用服务及相关计划和结果类型。

## 应用创建

应用工厂接收基础设施依赖：

```typescript
interface InterfaceApplicationDependencies {
  repository: InterfaceRepository
  fileDialog: InterfaceFileDialog
  textGenerator?: InterfaceTextGenerator
}

const interfaces = createInterfaceApplication({
  repository,
  fileDialog,
  textGenerator
})
```

`textGenerator` 可选。未配置时，浏览、草稿、手动实例编辑、JSON 覆盖和导入导出仍可使用；调用 AI 生成会抛出配置缺失错误。

返回的应用按 UI 工作流分为五组：

```typescript
interface InterfaceApplication {
  readonly browser: InterfaceBrowser
  readonly drafts: InterfaceDraftApplication
  readonly published: PublishedInterfaceApplication
  readonly instances: InterfaceInstanceApplication
  readonly transfer: InterfaceTransferApplication
}
```

## 浏览模块

```typescript
interface InterfaceBrowser {
  listDrafts(): Promise<InterfaceDraftSummary[]>
  listPublished(): Promise<PublishedInterfaceSummary[]>
}
```

`listDrafts()` 返回草稿列表摘要：

```typescript
interface InterfaceDraftSummary {
  draftId: string
  name: string
  description: string
}
```

`listPublished()` 返回用户可见的已发布列表：

```typescript
interface PublishedInterfaceSummary {
  interfaceId: string
  name: string
  description: string
  source: { type: 'published' } | { type: 'builtin'; builtinKey: string }
  instanceCount: number
}
```

列表只包含：

- 用户 `published` 分区中的 Interface。
- 每个 builtin 的当前版本。

builtin 历史版本不会作为普通已发布内容列出。

## 草稿模块

```typescript
interface InterfaceDraftApplication {
  create(initial?: Partial<InterfaceContent>): Promise<InterfaceDraft>
  get(draftId: string): Promise<InterfaceDraft | null>
  save(draft: InterfaceDraft): Promise<void>
  delete(draftId: string): Promise<void>
  publish(draftId: string): Promise<PublishDraftResult>
}
```

### 创建与保存

- `create()` 立即生成 UUID v4 `draftId` 并持久化草稿。
- 未提供的初始字段使用空名称、空描述、空提示词和空字段树。
- `save()` 保存完整草稿，不执行发布。
- 草稿允许处于不完整状态，严格业务校验发生在发布时。
- `delete()` 清除草稿目录；不存在的草稿删除保持成功。

### 草稿编辑

草稿本地编辑使用纯函数：

```typescript
const result = editInterfaceDraft(draft, operation)
```

支持操作：

- 修改名称。
- 修改描述。
- 修改提示词。
- 添加字段节点。
- 更新字段节点。
- 重命名字段 key。
- 删除字段节点。

返回值：

```typescript
interface EditInterfaceDraftResult {
  draft: InterfaceDraft
  operationApplied: boolean
}
```

字段路径不存在或操作无法应用时，返回原草稿且 `operationApplied` 为 `false`。该函数不执行 I/O，renderer 可以将返回草稿放入本地状态，再调用 `drafts.save()` 统一持久化。

### 发布

发布执行：

1. 读取草稿。
2. 校验名称、提示词、字段树、变量名、描述和示例。
3. 规范化完整内容并计算 SHA-256 ID。
4. 查询本机是否已经存在相同内容 ID。
5. 不存在时写入用户 `published` 分区。

结果：

```typescript
type PublishDraftResult =
  | {
      status: 'published' | 'already-published'
      interface: PublishedInterfaceSummary
    }
  | {
      status: 'invalid'
      errors: readonly ValidationError[]
    }
```

相同内容已经作为用户发布内容或 builtin 内容存在时返回 `already-published`，不会创建重复副本。发布后草稿保留，不自动删除。

## 已发布 Interface 模块

```typescript
interface PublishedInterfaceApplication {
  get(interfaceId: string): Promise<PublishedInterfaceDetails | null>
  listInstances(interfaceId: string): Promise<InterfaceInstanceSummary[]>
  getPrompts(interfaceId: string): Promise<InterfacePromptBundle>
  getVarManifest(interfaceId: string): Promise<InterfaceVarManifest>
  createBlankInstance(interfaceId: string): Promise<InterfaceInstanceDetails>
  copyToDraft(interfaceId: string): Promise<InterfaceDraft>
}
```

### 查看完整内容

`get()` 返回不可编辑的发布定义和本机来源：

```typescript
interface PublishedInterfaceDetails {
  definition: InterfaceDef
  source: { type: 'published' } | { type: 'builtin'; builtinKey: string }
}
```

`source` 是本机仓储上下文，不参与 Interface 内容 ID，也不写入交换包。

### 提示词

`getPrompts()` 一次返回同一 Interface 的三种提示词：

```typescript
interface InterfacePromptBundle {
  prompt: string
  formatInstructions: string
  fullPrompt: string
}
```

- `prompt` 是教师编写的原始 `promptTemplate`。
- `formatInstructions` 是系统根据字段树生成的 JSON Schema、图片字段约束和示例输出。
- `fullPrompt` 是 `prompt` 与 `formatInstructions` 的拼接结果。

模块只返回字符串。复制到系统剪贴板由 renderer 使用浏览器或 Electron 能力完成。

### 变量清单

`getVarManifest()` 返回供 Template 等模块消费的 `InterfaceVarManifest`，包含 Interface ID、名称和按字段顺序展开的变量信息。跨模块类型定义位于 `@ls101/core-types`。

### 复制为草稿

`copyToDraft()` 深拷贝名称、描述、提示词和字段树，生成新的 UUID v4 `draftId` 并立即保存。发布内容本身不会被修改。

### 创建空白实例

`createBlankInstance()`：

1. 读取 Interface 字段定义。
2. 为全部 `varName` 建立空字符串值。
3. 生成 UUID v4 `instanceId`。
4. 写入所属 Interface 的实例目录。
5. 返回正式实例详情。

空白实例从创建时起就是持久化实体，不存在独立的 `InstanceDraft` 类型。

## 实例模块

```typescript
interface InterfaceInstanceApplication {
  get(interfaceId: string, instanceId: string): Promise<InterfaceInstanceDetails | null>

  save(
    interfaceId: string,
    instanceId: string,
    values: Record<string, string>
  ): Promise<InterfaceInstanceDetails>

  replaceFromJson(
    interfaceId: string,
    instanceId: string,
    json: string
  ): Promise<ReplaceInstanceFromJsonResult>

  startAIGeneration(
    interfaceId: string,
    instanceId: string
  ): Promise<TaskProgressHandle<InterfaceAIGenerationResult>>

  delete(interfaceId: string, instanceId: string): Promise<void>
}
```

### 实例详情

```typescript
interface InterfaceInstanceDetails {
  interfaceId: string
  instance: InterfaceInstance
  assetUrls: Record<string, string>
}
```

`InterfaceInstance` 本体不保存 `interfaceId`；详情 DTO 通过查询上下文补充归属。`assetUrls` 的 value 是 UI 可加载的 URL，不是二进制资源。

### 整表保存

`save()` 接收当前实例全部变量值，不提供单字段保存。

- `instanceId` 和所属 Interface 保持不变。
- values 的 key 集合必须与 Interface 的变量集合完全一致。
- 未显式替换资源时保留现有实例资源和资源清单。
- 保存通过写入同一个 `instance.json` 完成。

renderer 可以在页面内维护未保存表单状态，在用户执行保存时提交完整 `values`。

### JSON 覆盖

`replaceFromJson()` 先解析 JSON，再使用 Interface 字段树生成的 JSON Schema 校验结构。成功后将字段路径映射为 `varName -> value` 并覆盖当前实例全部值。

```typescript
type ReplaceInstanceFromJsonResult =
  | {
      status: 'replaced'
      instance: InterfaceInstanceDetails
    }
  | {
      status: 'invalid-json'
      errors: readonly InstanceDataError[]
    }
```

解析或结构校验失败时不写入实例，原值保持不变。成功覆盖不改变 UUID。

### AI 覆盖

Interface 当前要求文本生成适配器提供增量流：

```typescript
interface InterfaceTextGenerationChunk {
  type: 'reasoning' | 'output'
  delta: string
}

interface InterfaceTextGenerator {
  generate(
    prompt: string,
    options: { signal: AbortSignal }
  ): AsyncIterable<InterfaceTextGenerationChunk>
}
```

该端口表示 Interface 对文本生成的最小需求，不要求 AIRouter 使用相同命名。bootstrap 可以在 AIRouter 实现后提供适配器。

`startAIGeneration()`：

1. 锁定当前实例。
2. 构建完整提示词。
3. 消费 reasoning/output 增量流。
4. 创建通用 `TaskProgressHandle`。
5. 流结束后校验完整 output JSON。
6. 校验成功后覆盖并保存当前实例。
7. 释放实例锁。

任务列表包含：

```text
AI 生成
校验生成结果
保存实例
```

reasoning 和 output 会合并为可展开的 Markdown 日志。AI 失败、取消或输出校验失败时，当前实例原值保持不变。

同一实例被 AI 任务锁定期间，以下操作会被拒绝：

- 再次启动 AI 生成。
- 整表保存。
- JSON 覆盖。
- 删除实例。

取消通过 `AbortController` 传给文本生成流，并在持久化前再次检查取消状态。

### 删除

`delete()` 清除实例目录及附属资源。不存在的实例删除保持成功。正在执行 AI 生成的实例不能删除。

## 导入导出模块

```typescript
interface InterfaceTransferApplication {
  export(interfaceId: string, instances: InstanceSelection): Promise<ExportInterfaceResult>

  beginImport(): Promise<InterfaceImportSession | null>
}
```

实例选择：

```typescript
type InstanceSelection =
  | { mode: 'none' }
  | { mode: 'all' }
  | { mode: 'selected'; instanceIds: readonly string[] }
```

### 导出

导出始终包含 Interface 定义，可以不附带实例、附带全部实例或附带选中的实例。实例资源随实例写入 `.lsinterface` ZIP。

```typescript
type ExportInterfaceResult = { status: 'exported' } | { status: 'cancelled' }
```

用户取消系统保存对话框属于正常 `cancelled` 结果。

### 导入会话

`beginImport()` 打开一次文件选择对话框，读取、解码并完整检查交换包。取消选择时返回 `null`。

成功时返回：

```typescript
interface InterfaceImportSession {
  readonly preview: InterfaceImportPreview
  commit(instances: InstanceSelection): Promise<InterfaceImportResult>
  cancel(): void
}
```

`preview` 包含文件名、Interface 摘要以及附带实例的 UUID、生成时间和资源文件名。UI 不接触原始 ZIP 条目或业务交换包。

会话只能提交一次：

- `commit()` 使用用户选择的实例执行导入，然后使会话失效。
- `cancel()` 使会话失效，不写入仓储。
- 已失效会话再次提交会抛出错误。

导入结果：

```typescript
interface InterfaceImportResult {
  interfaceId: string
  importedInstanceIds: string[]
  skippedInstanceIds: string[]
}
```

## 交换文件

`.lsinterface` 当前格式版本为 2，ZIP 固定包含：

```text
manifest.json
interface.json
instances/
└── <instanceId>/
    ├── instance.json
    └── assets/
        └── <resource files>
```

解码时会检查：

- manifest 格式和版本。
- Interface 内容 ID 与内容摘要一致。
- UUID、资源文件名和路径合法。
- 未出现未知、重复或路径穿越条目。
- manifest 与实际文件一致。
- 文件数量和解压后总大小不超过限制。
- JSON 和 UTF-8 内容合法。

本地已存在相同 Interface ID 时，导入拒绝整个 Interface，不创建重复用户副本。实例 UUID 冲突规则由仓储执行：同 UUID、不同内容拒绝；同 UUID、相同内容且已归属其他 Interface 时跳过，不改变现有归属。

## 存储与身份

### Interface ID

已发布 Interface 的 ID 格式为：

```text
sha256:<64 lowercase hexadecimal characters>
```

哈希输入包含：

- `name`
- `description`
- `promptTemplate`
- 保留顺序的完整字段树

字段树的每一层存储为 `{ order: string[], nodes: Record<string, FieldNode> }`。`order` 是显示、遍历和哈希的唯一顺序来源，必须无重复且与 `nodes` 的 key 集合完全一致；草稿保存、发布和导入都会拒绝不一致的数据。

文本统一换行为 LF并执行 Unicode NFC 规范化。字段树按显式 `order` 编码为有序条目数组，结构对象再通过 `fast-json-stable-stringify` 按 key 字典序、无缩进序列化，最后以 UTF-8 字节计算 SHA-256。该过程不依赖对象属性声明顺序或平台默认编码。实例不参与 Interface ID。

### 实例身份

实例使用 UUID v4实体身份。不同 UUID 即使 values 完全相同，也视为不同实例。

实例本体当前包含：

```typescript
interface InterfaceInstance {
  instanceId: string
  generatedAt: string
  values: Record<string, string>
}
```

空白实例创建、手动保存、JSON 覆盖和 AI 覆盖都保留同一 UUID。导入和 builtin 迁移也保留原 UUID。

### 物理分区

```text
interfaces/
├── drafts/<draftId>/draft.json
├── published/<digest>/
│   ├── interface.json
│   └── instances/<instanceId>/
└── builtin/<builtinKey>/
    ├── current.json
    └── versions/<digest>/
        ├── interface.json
        └── instances/<instanceId>/
```

同一个 Interface ID 不能同时存在于用户发布分区和 builtin 分区。实例始终存放在所属 Interface 目录下，删除 Interface 时一并删除实例和资源。

## Builtin 更新

bootstrap 从 `@ls101/interface-editor/builtin` 创建维护应用：

```typescript
const builtinInterfaces = createBuiltinInterfaceApplication({
  repository,
  references
})
```

公开能力：

```typescript
interface BuiltinInterfaceApplication {
  check(builtinKey: string, next: InterfaceDef): Promise<BuiltinUpdatePlan>

  apply(plan: BuiltinUpdatePlan, choice?: ManualBuiltinUpdateChoice): Promise<BuiltinUpdateResult>
}
```

分类：

- `none`：内容 ID 未变化。
- `automatic`：变量契约和 JSON 结构保持不变。
- `manual`：变量契约不变，但 JSON 路径、层级或顺序变化。
- `invalid-contract`：`varName + type` 契约发生变化。

手动更新选择：

- `migrate`：迁移实例、Template 引用和当前版本指针。
- `backup-old`：将旧 builtin 内容及实例物理备份到用户发布分区。

`apply()` 执行前会重新检查当前 builtin 状态，拒绝已经失效的旧计划。

Template 引用迁移通过以下端口注入：

```typescript
interface InterfaceReferenceMigrator {
  replaceInterfaceReferences(fromInterfaceId: string, toInterfaceId: string): Promise<void>
}
```

当前仓库尚无 Template 持久化实现，因此真实引用迁移尚未接线。

## 错误与取消

应用层使用两种错误表达：

- 用户可处理的预期业务分支使用判别联合，例如草稿校验失败、JSON 无效、AI 输出无效和文件对话框取消。
- 缺失实体、实例繁忙、会话重复提交、仓储损坏和 I/O 失败当前通过异常传播。

仓储适配器定义 `InterfaceRepositoryError`，错误码包括：

```text
INVALID_ID
INVALID_DATA
NOT_FOUND
IDENTITY_CONFLICT
MISSING_ASSET
```

根 UI 入口不公开仓储错误类；bootstrap 和基础设施测试可以从 `./adapters` 导入。renderer 需要在应用边界捕获未建模异常并显示通用错误反馈。

## 当前限制

- renderer 尚未创建 Interface 页面、Context、Hooks 或 bootstrap 接线。
- `@ls101/file-store` 和 `@ls101/file-dialog` 尚未在业务应用入口连接到 Interface 应用。
- AIRouter 尚未实现真实文本生成流；当前只有需求注释和 Interface 端口。
- 图片字段的二次图片生成、资源保存和字段 URL 替换尚未实现。
- 实例时间字段仍名为 `generatedAt`，空白实例也会在创建时写入该时间。
- 实例整表更新依赖底层单文件 `writeText()`；File Store 当前不声明临时文件加 rename 的原子写保证。
- 应用层部分错误仍使用普通 `Error` 文本，尚未统一为稳定错误码。
- builtin 引用迁移没有真实 Template 仓储适配器。
- 没有删除已发布 Interface 前的 Template 引用影响检查应用用例。
- 导入导出一次性在内存中处理完整 ZIP，没有流式 I/O。

## 验证覆盖

当前自动化测试覆盖：

- 草稿保存、读取、发布、内容去重和校验拒绝。
- SHA-256 内容身份、换行和 Unicode 规范化。
- 字段树查询、不可变编辑和校验。
- JSON Schema、示例、提示词和变量清单生成。
- 用户发布与 builtin 物理分区。
- 实例 UUID 唯一性、变量集合校验、资源保存和删除。
- 空白实例创建、整表保存和 JSON 原子覆盖。
- AI 流日志、任务状态、成功覆盖和实例级并发拒绝。
- 导入导出选择、ZIP 往返、安全校验和取消语义。
- builtin 自动更新、手动迁移、物理备份、回滚和契约拒绝。
- 五模块应用门面的主要成功路径。

当前未覆盖：

- 真实 Electron、File Store、File Dialog 和 AIRouter 端到端集成。
- renderer 页面交互和任务进度展示。
- 图片生成。
- 实例更新时底层文件写入中断。
- 多 renderer 或多进程同时修改同一实例。

## 代码依据

- `packages/interface-editor/src/index.ts`
- `packages/interface-editor/src/application.ts`
- `packages/interface-editor/src/types.ts`
- `packages/interface-editor/src/repository.ts`
- `packages/interface-editor/src/id.ts`
- `packages/interface-editor/src/validation.ts`
- `packages/interface-editor/src/conversions.ts`
- `packages/interface-editor/src/exchange.ts`
- `packages/interface-editor/src/zip.ts`
- `packages/interface-editor/src/fileExchange.ts`
- `packages/interface-editor/src/builtin.ts`
- `packages/interface-editor/src/adapters.ts`
- `packages/interface-editor/src/builtin-entry.ts`
- `packages/interface-editor/src/__tests__/`
- `packages/core-types/src/interface.ts`
- `packages/core-types/src/task-progress.ts`
