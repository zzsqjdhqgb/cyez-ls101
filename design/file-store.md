# 文件存储层设计

## 一、职责边界

文件存储层采用 Electron 进程隔离：

- 渲染进程不接触物理路径，只能从顶层 scope 逐层派生 `ScopedStore`。
- preload 只暴露 file-store 白名单 IPC 通道，不暴露完整 `ipcRenderer`。
- 主进程重新校验所有 scope segment 和 filename，负责物理路径映射与文件 I/O。
- 存储根目录通过依赖注入传入，通常为 `app.getPath('userData')`。

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
  getAssetUrl(filename: string): string

  listScopes(): Promise<string[]>
  clear(): Promise<void>
}
```

不公开裸 Key API、IPC 实现类或物理路径转换函数。

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

映射规则：

```text
Text  = Join(baseDir, ...scope, '.text', filename)
Asset = Join(baseDir, ...scope, '.assets', filename)
```

因此相同 filename 可以分别存在于 Text 和 Asset 命名空间中，不会互相覆盖。

`.text` 和 `.assets` 是 file-store 内部保留目录。它们不符合 scope segment 规则，也不会被 `listScopes()` 返回。

## 六、列表与清理

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

## 七、IPC 契约

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

## 八、Asset 自定义协议

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

## 九、包导出边界

```text
@ls101/file-store/main
├── registerFileStoreScheme
└── registerFileStore

@ls101/file-store/renderer
├── fileStore
├── FileStore
└── ScopedStore

@ls101/file-store/shared
├── FILE_STORE_CHANNELS
├── FileStoreChannel
└── FileStoreBridge
```

主进程使用方式：

```typescript
import { app } from 'electron'
import { registerFileStore, registerFileStoreScheme } from '@ls101/file-store/main'

registerFileStoreScheme()

app.whenReady().then(() => {
  registerFileStore({ baseDir: app.getPath('userData') })
})
```
