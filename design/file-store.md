# 文件存储层设计

## 一、职责边界

文件存储层采用 Electron 进程隔离：

- 渲染进程不接触物理路径；写入、删除和 Text 操作只能通过逐层派生的 `ScopedStore` 完成。
- Asset 可以生成只读位置 Key，持有 Key 的调用方可以直接读取资源或生成展示 URL。
- preload 只暴露 file-store 白名单 IPC 通道，不暴露完整 `ipcRenderer`。
- 主进程重新校验所有 scope segment 和 filename，负责物理路径映射与文件 I/O。
- 存储根目录通过依赖注入传入，通常为 `app.getPath('userData')`。
- 随软件发布的 builtin 资源使用独立的只读根目录和 IPC 白名单；底层只提供读取能力，不执行任何业务复制或初始化。

## 二、Scope 模型

文件系统中的每个业务目录都是一个 scope。package 只是业务层对某个 scope 的称呼，在 file-store 中没有单独的实现。

顶层 scope 只能从 `fileStore.scope(name)` 创建，子 scope 只能从已有 scope 逐层派生：

```typescript
const interfaces = fileStore.scope('interfaces')
const drafts = interfaces.scope('drafts')
const draft = drafts.scope('draft-abc123')
```

调用方不能一次传入复杂路径：

```typescript
fileStore.scope('interfaces') // 合法
interfaces.scope('drafts') // 合法
drafts.scope('draft-abc123') // 合法

fileStore.scope('interfaces/drafts') // 非法
fileStore.scope('interfaces.drafts') // 非法
fileStore.scope('../interfaces') // 非法
```

内部使用不可变的 segment 数组表示 scope：

```typescript
const scope = ['interfaces', 'drafts', 'draft-abc123']
```

IPC 也传递结构化数组，不传递由调用方拼接的物理或逻辑路径。

## 三、命名与校验

### Scope segment

```regex
^[a-zA-Z0-9][a-zA-Z0-9_-]*$
```

允许字母、数字、下划线和连字符，禁止点号、斜杠、反斜杠、空 segment 和隐藏目录名。

合法示例：

```text
interfaces
drafts
draft-abc123
550e8400-e29b-41d4-a716-446655440000
```

非法示例：

```text
.drafts
drafts.current
drafts/current
drafts\current
../drafts
```

### Filename

```regex
^[a-zA-Z0-9][a-zA-Z0-9_.-]*$
```

filename 可以包含扩展名点号，但不能包含路径分隔符，也不能以点号开头。

渲染进程负责尽早报错，主进程必须独立执行相同校验。

## 四、公共接口

renderer 只公开一个 `fileStore` 单例和必要类型：

```typescript
export interface FileStore {
  scope(name: string): ScopedStore
  readAsset(key: AssetKey): Promise<Uint8Array | null>
  getAssetUrl(key: AssetKey): string
}

export interface ScopedStore {
  scope(name: string): ScopedStore

  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  deleteText(filename: string): Promise<void>
  hasText(filename: string): Promise<boolean>
  listText(): Promise<string[]>

  readAsset(filename: string): Promise<Uint8Array | null>
  writeAsset(filename: string, data: Uint8Array): Promise<void>
  deleteAsset(filename: string): Promise<void>
  hasAsset(filename: string): Promise<boolean>
  listAssets(): Promise<string[]>
  getAssetKey(filename: string): AssetKey
  getAssetUrl(filename: string): string

  listScopes(): Promise<string[]>
  clear(): Promise<void>
}
```

`AssetKey` 是可序列化的只读位置键。公共 API 不提供按 Key 写入、删除 Asset
或访问 Text 的能力，也不公开 IPC 实现类或物理路径转换函数。

## 五、Text 与 Asset 隔离

Text 和 Asset 属于同一个 scope，但存放在两个保留子目录中：

```text
baseDir/
└── interfaces/
    ├── .text/
    ├── .assets/
    └── drafts/
        └── draft-abc123/
            ├── .text/
            │   ├── manifest.json
            │   └── content.json
            ├── .assets/
            │   ├── cover.png
            │   └── recording.mp3
            └── media/
                ├── .text/
                └── .assets/
```

Interface 模块的领域仓储在该 scope 模型上采用以下布局。实例属于对应的 Interface，不放在全局实例目录：

```text
interfaces/
├── drafts/
│   └── <draftId>/
│       └── .text/
│           └── draft.json
├── published/
│   └── <interface-sha256-digest>/
│       ├── .text/interface.json
│       └── instances/<instanceId>/
│           ├── .text/instance.json
│           └── .assets/<instance assets>
└── builtin/
    └── <builtinKey>/
        ├── .text/current.json
        └── versions/<interface-sha256-digest>/
            ├── .text/interface.json
            └── instances/<instanceId>/
                ├── .text/instance.json
                └── .assets/<instance assets>
```

同一个 Interface 内容 ID 在本机只能存在于 `published` 或某个 `builtin` 版本目录之一。备份旧内置版本时，仓储复制定义、实例和资源到 `published`，回读验证后删除内置源目录。内置更新迁移实例时采用同样的“复制、验证、删除源”流程。

映射规则：

```text
Text  = Join(baseDir, ...scope, '.text', filename)
Asset = Join(baseDir, ...scope, '.assets', filename)
```

因此相同 filename 可以分别存在于 Text 和 Asset 命名空间中，不会互相覆盖。

`.text` 和 `.assets` 是 file-store 内部保留目录。它们不符合 scope segment 规则，也不会被 `listScopes()` 返回。

## 六、单文件原子写入

Text 和 Asset 的所有写入必须在 main 进程经过同一个原子替换入口。实现按以下顺序执行：在目标同目录创建唯一临时文件、写入全部内容、对临时文件执行 `fsync`、关闭文件、以 `rename` 替换目标，并在文件系统支持时同步父目录。临时文件与目标处于同一目录，禁止跨文件系统重命名。

替换前任一步骤失败时，不得截断或删除旧目标文件，并应尽力清理临时文件。进程被强制终止而遗留的隐藏临时文件不属于公开 Text 或 Asset 列表，并在所属 scope 清理时一并删除。

原子性只覆盖单个文件，不扩展为多文件事务。并发写入不加锁，多个成功写入由最后完成 `rename` 的写入生效。

## 七、列表与清理

- `listText()` 只列出当前 scope 的 `.text` 文件。
- `listAssets()` 只列出当前 scope 的 `.assets` 文件。
- `listScopes()` 只列出当前 scope 的合法子 scope，不包含保留目录。
- 不存在的目录返回空数组。
- 返回结果按名称排序。

所有 scope，包括顶层 scope，都支持 `clear()`：

```typescript
await draft.clear() // 删除单个草稿 scope
await drafts.clear() // 删除全部草稿
await interfaces.clear() // 删除整个 interfaces 数据树
```

`clear()` 的语义：

- 删除当前 scope、其中的 Text、Asset 和所有后代 scope。
- 不删除父 scope 或兄弟 scope。
- scope 不存在时仍然成功，操作幂等。
- 清理后的 `ScopedStore` 对象仍可使用，后续写入自动重建目录。
- 通过一次 IPC 在主进程调用 `fs.rm(path, { recursive: true, force: true })`。

顶层 `clear()` 在存储层是合法能力。业务模块通过控制顶层 `ScopedStore` 对象的可见范围来控制删除权限。

## 八、IPC 契约

文件请求使用结构化位置：

```typescript
interface FileLocation {
  scope: readonly string[]
  filename: string
}
```

通道包括：

```text
file:read-text
file:write-text
file:delete-text
file:has-text
file:list-text

file:read-asset
file:write-asset
file:delete-asset
file:has-asset
file:list-assets

file:list-scopes
file:clear-scope
```

Text 与 Asset 使用不同通道，由主进程决定进入 `.text` 还是 `.assets`。调用方不能通过参数指定保留目录。

## 九、Asset 自定义协议

### Asset Key

Asset Key 由 `ScopedStore.getAssetKey(filename)` 创建，格式为：

```text
asset-key://v1/interfaces/drafts/draft-abc123/cover.png
```

Key 编码完整 scope 和 filename，但不包含 `userData` 等物理路径。`fileStore.readAsset(key)`
将 Key 解析为现有的结构化 `FileLocation`，复用 `file:read-asset` IPC；
`fileStore.getAssetUrl(key)` 则将同一位置转换为展示 URL。

Key 的约束：

- 只用于 Asset 读取和展示 URL 生成。
- 不支持按 Key 写入、删除、列举或清理资源。
- 不支持任何 Text Key 操作。
- renderer 在 IPC 前验证版本、scope segment 和 filename，main 仍独立验证解析后的位置。
- 当前 Key 是位置型引用；资源移动到其他 scope 后，旧 Key 失效。

### 展示 URL

资源 URL 使用固定 host，并把 scope 放入 pathname：

```text
asset://local/interfaces/drafts/draft-abc123/cover.png
```

调用方式：

```tsx
const draft = fileStore.scope('interfaces').scope('drafts').scope('draft-abc123')

return <img src={draft.getAssetUrl('cover.png')} />
```

协议处理器执行以下步骤：

1. 校验 scheme 必须为 `asset`，host 必须为 `local`。
2. 拒绝认证信息、端口、query 和 fragment。
3. 对 pathname 的每个 scope segment 和 filename 分别解码、校验。
4. 固定映射到当前 scope 的 `.assets` 目录。
5. 使用 Electron `net.fetch(fileUrl)` 返回文件流。

协议处理器永远不会映射 `.text`，因此 Text 文件不在 `asset://` 的可达范围内。

## 十、Builtin Scoped Store

`builtinFileStore` 与普通 `fileStore` 使用相同的 scope、`.text`、`.assets`、segment 校验和 filename 校验规则，但只公开读取操作：

```typescript
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

Builtin Reader 不公开写入、删除、CAS 或 `clear()`。Main 进程只把固定 builtin 根目录映射为只读 IPC 和 `builtin-asset://` 协议；Renderer 不接触物理路径。业务模块读取 builtin 数据后，自行决定直接使用、转换、缓存或复制，File Store 不理解业务格式。

`FileStorage` 是 `@ls101/file-store` 的内部 main 进程实现，不属于任何 package export，禁止模块外部直接构造或访问。

## 十一、包导出边界

```text
@ls101/file-store/main
├── registerFileStoreScheme
├── registerFileStore
├── registerBuiltinFileStoreScheme
└── registerBuiltinFileStore

@ls101/file-store/renderer
├── fileStore
├── builtinFileStore
├── AssetKey
├── FileStore
├── ScopedStore
├── BuiltinFileStore
└── ReadonlyScopedStore

@ls101/file-store/shared
├── FILE_STORE_CHANNELS
├── BUILTIN_FILE_STORE_CHANNELS
├── FileStoreChannel
├── BuiltinFileStoreChannel
├── FileStoreBridge
└── BuiltinFileStoreBridge
```

主进程使用方式：

```typescript
import { app } from 'electron'
import {
  registerBuiltinFileStore,
  registerBuiltinFileStoreScheme,
  registerFileStore,
  registerFileStoreScheme
} from '@ls101/file-store/main'

registerFileStoreScheme()
registerBuiltinFileStoreScheme()

app.whenReady().then(() => {
  registerFileStore({ baseDir: app.getPath('userData') })
  registerBuiltinFileStore({ baseDir: resolveBuiltinResourceRoot() })
})
```
