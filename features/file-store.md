# File Store

## 功能状态

`@ls101/file-store` 已实现应用私有目录中的分层文件存储，并已接入 Electron main 与 preload。

当前应用使用 `app.getPath('userData')` 作为存储根目录。renderer 公共 API 已可用，但当前业务 renderer 尚未发现对 `fileStore` 单例的实际调用；`@ls101/interface-editor` 定义了与 `ScopedStore` 兼容的仓储接口，但尚未在应用入口中连接真实 file store。

## 功能边界

File Store 负责：

- 管理应用私有 `userData` 目录中的持久化数据。
- 使用逐层派生的 scope 隔离业务数据。
- 分别存储 JSON 文本数据和二进制资源。
- 为 Asset 生成可传递的只读位置 Key，并支持通过 Key 读取资源。
- 以同目录临时文件加原子重命名的方式写入 Text 和 Asset。
- 为单个 Text 文件提供跨 renderer 的原子 compare-and-swap。
- 通过受限 IPC 在 renderer 与 main 之间传递存储请求。
- 为二进制资源生成 `asset://local/...` URL。

File Store 不负责：

- 打开系统文件选择或保存对话框。
- 导入、导出用户主动选择的外部文件。
- 业务数据的运行时 schema 校验。
- 多文件事务、面向业务的锁管理或流式 I/O。

## 公共接口

renderer 从 `@ls101/file-store/renderer` 导入唯一的 `fileStore` 实例：

```typescript
import { fileStore } from '@ls101/file-store/renderer'

const draft = fileStore.scope('interfaces').scope('drafts').scope('draft-abc123')
```

公开接口如下：

```typescript
interface FileStore {
  scope(name: string): ScopedStore
  readAsset(key: AssetKey): Promise<Uint8Array | null>
  getAssetUrl(key: AssetKey): string
}

interface ScopedStore {
  scope(name: string): ScopedStore

  readText<T>(filename: string): Promise<T | null>
  writeText<T>(filename: string, data: T): Promise<void>
  compareAndSwapText<T>(filename: string, expected: T | null, data: T): Promise<boolean>
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

main 从 `@ls101/file-store/main` 导出：

```typescript
registerFileStoreScheme(): void
registerFileStore(options: { baseDir: string }): void
```

shared 从 `@ls101/file-store/shared` 导出 IPC 通道常量和 bridge 类型。

## Scope 模型

每个 scope 由一个或多个独立 segment 构成。调用方只能逐层派生 scope，不能传入组合路径：

```typescript
fileStore.scope('interfaces') // 合法
fileStore.scope('interfaces/drafts') // 非法
fileStore.scope('../interfaces') // 非法
```

内部和 IPC 使用 segment 数组表示位置，例如：

```typescript
['interfaces', 'drafts', 'draft-abc123']
```

scope segment 必须匹配：

```regex
^[a-zA-Z0-9][a-zA-Z0-9_-]*$
```

filename 必须匹配：

```regex
^[a-zA-Z0-9][a-zA-Z0-9_.-]*$
```

因此 scope 不允许点号或路径分隔符，filename 可以包含扩展名点号，但不能以点号开头或包含路径分隔符。renderer 在 IPC 前校验，main 在解析物理路径时再次校验。

## 存储布局

每个 scope 使用两个保留目录隔离数据类型：

```text
<baseDir>/
└── <scope...>/
    ├── .text/
    │   └── <filename>
    ├── .assets/
    │   └── <filename>
    └── <child-scope>/
```

映射规则：

```text
Text  = Join(baseDir, ...scope, '.text', filename)
Asset = Join(baseDir, ...scope, '.assets', filename)
```

相同 filename 可以同时存在于 Text 和 Asset 命名空间。`.text` 和 `.assets` 不符合 scope 命名规则，也不会由 `listScopes()` 返回。

## 原子写入

`writeText()` 和 `writeAsset()` 在 main 进程统一使用单文件原子替换流程：

1. 在目标文件所在目录创建名称唯一的隐藏临时文件。
2. 将完整内容写入临时文件并执行文件 `fsync`。
3. 关闭临时文件后，以同文件系统内的 `rename` 原子替换目标文件。
4. 在平台和文件系统支持时同步父目录，使重命名元数据持久化。

写入、同步、关闭或重命名在替换前失败时，旧目标文件保持不变，临时文件会尽力清理。进程在清理前被强制终止可能留下 `.file-store-*.tmp`，这些名称不符合公开 filename 规则，不会出现在 `listText()` 或 `listAssets()` 中，并会随 scope 清理而删除。

该保证针对单个文件，依赖本地文件系统提供同目录 `rename` 的原子替换语义。普通 `writeText()` 的多个成功并发写入仍采用最后执行者生效的语义；File Store 不提供跨文件事务。

## Text compare-and-swap

`compareAndSwapText(filename, expected, data)` 在 renderer 分别序列化期望值和新值，在 main 进程的同一个 mutation 队列中完成“读取原始文本、比较、原子替换”。当前值与期望值完全相同时写入并返回 `true`，否则不修改文件并返回 `false`。`expected: null` 表示期望文件不存在，可用于原子创建。

Text 和 Asset 的写入、删除以及 scope 清理与 CAS 使用同一个 main 进程 mutation 队列。因此多个 renderer/window 即使各自创建业务仓储实例，也无法同时以同一旧值成功交换；普通修改也不会插入 CAS 的读取和替换之间。该队列只协调当前应用 main 进程中的 File Store 请求，不防止其他进程直接修改存储目录。

## Text 语义

- `writeText()` 在 renderer 使用 `JSON.stringify()` 序列化数据。
- `compareAndSwapText()` 对期望值和新值使用相同序列化规则；期望文件不存在时传入 `null`。
- 序列化结果为 `undefined` 时抛出 `TypeError`；其他 JSON 序列化错误原样传播。
- main 只保存 UTF-8 字符串，不执行 JSON 解析或业务校验。
- `readText()` 在 renderer 使用 `JSON.parse()` 解析数据。
- 文件不存在时返回 `null`。
- 文件内容不是合法 JSON 时，`JSON.parse()` 错误直接传播。
- 泛型参数 `T` 只提供编译期类型，不提供运行时验证。

## Asset 语义

- `writeAsset()` 只接受 `Uint8Array`，renderer 和 main 都会执行类型检查。
- `readAsset()` 返回 `Uint8Array`，文件不存在时返回 `null`。
- `getAssetUrl()` 同步校验 filename，并返回编码后的 `asset://local/...` URL。
- URL 生成不检查目标文件是否存在。
- `getAssetKey()` 返回版本化、可序列化的位置型 Key：`asset-key://v1/<scope...>/<filename>`。
- `fileStore.readAsset(key)` 允许调用方无需重新构造 scope，直接读取 Key 指向的 Asset。
- `fileStore.getAssetUrl(key)` 将 Key 转换为现有的 `asset://local/...` 展示 URL。
- Key API 不提供 Asset 写入、删除或任何 Text 访问能力。
- Asset Key 编码当前 scope；资源迁移到其他 scope 后，旧 Key 失效。

示例：

```text
asset://local/interfaces/drafts/draft-abc123/cover.png
```

协议处理器只映射 `.assets`。它要求 scheme 为 `asset`、host 为 `local`，并拒绝认证信息、端口、query、fragment、空路径段和非法编码路径。URL 校验或路径解析失败时返回 `403 Forbidden`。

### Asset 协议的跨平台实现

`asset://` 和 `builtin-asset://` 协议在 main 进程中解析并校验 URL，然后使用 Node.js `readFile()` 读取目标文件并返回 `Response`。协议不再把目标路径转换为 `file://` URL 交给 Chromium 读取。

这样可以避免 Windows 上 `userData` 路径叠加内置题型多层 scope 后过长，导致 Chromium 返回 `net::ERR_FILE_NOT_FOUND`。当前响应会设置常见图片的 MIME 类型；非法 URL 返回 `403`，文件不存在返回 `404`，其他文件系统错误返回 `500`。

当前实现按完整文件读取，不提供显式的 `Range`、`206 Partial Content`、`HEAD` 或条件缓存响应。File Store 的展示资源目前主要是 AI 生成图片，适用于该使用场景；若以后承载音视频、PDF 或其他大文件，应改为基于 `stat()` 和 `createReadStream()` 的流式协议，并补充 Range 测试。

## 列表、删除与清理

- `listText()` 和 `listAssets()` 只返回当前命名空间中的合法普通文件。
- `listScopes()` 只返回合法的直接子目录。
- 列表不包含符号链接，并按名称排序。
- 目标目录不存在时，列表返回空数组。
- `deleteText()` 和 `deleteAsset()` 对不存在的文件保持成功。
- `hasText()` 和 `hasAsset()` 在文件不存在时返回 `false`。
- `clear()` 递归删除当前 scope、数据文件和全部后代 scope。
- `clear()` 不删除父 scope 或兄弟 scope，对不存在的 scope 也是幂等操作。
- 清理后的 `ScopedStore` 仍可继续写入，所需目录会自动重建。

直接按名称执行的文件操作没有额外的 `realpath` 包含性检查，因此当前实现不声明针对已存在符号链接路径的完整隔离保证。

## Electron 集成

主进程在 Electron ready 前注册自定义 scheme，并在 ready 后注册存储能力：

```typescript
registerFileStoreScheme()

app.whenReady().then(() => {
  registerFileStore({ baseDir: app.getPath('userData') })
})
```

preload 只暴露 `FILE_STORE_CHANNELS` 中允许的通道，通过 `window.fileStore.invoke()` 调用 `ipcRenderer.invoke()`；不支持的通道会在 preload 中被拒绝。

已实现通道：

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

## 错误与缺失数据

| 场景 | 结果 |
| --- | --- |
| Text 或 Asset 不存在 | `read*()` 返回 `null` |
| 文件不存在 | `has*()` 返回 `false` |
| 列表目录不存在 | 返回 `[]` |
| 删除或清理目标不存在 | 操作成功 |
| scope 或 filename 非法 | 抛出校验错误 |
| JSON 无法序列化或解析 | 原错误传播 |
| 文件系统发生非 `ENOENT` 错误 | 原错误传播 |
| preload bridge 不存在 | 抛出 bridge unavailable 错误 |

模块没有定义业务错误码或错误 UI。

## 验证覆盖

当前自动化测试覆盖：

- scope 与 filename 校验。
- Text 和 Asset 的物理路径映射及命名空间隔离。
- 缺失数据语义、列表排序和递归清理。
- asset URL 解析与非法 URL 拒绝。
- renderer 的 scope 派生、IPC 参数和 asset URL 生成。
- 单文件原子替换、临时文件清理和替换失败时保留旧内容。
- 打包 Electron 中的真实 File Store IPC、`asset://` 协议读取和图片字节返回。

当前未覆盖并发写入、进程在系统调用中间被终止的故障注入、Range/HEAD 响应和符号链接路径攻击。

## 代码依据

- `packages/file-store/src/renderer/index.ts`
- `packages/file-store/src/renderer/ScopedStore.ts`
- `packages/file-store/src/shared/pathUtils.ts`
- `packages/file-store/src/main/storage.ts`
- `packages/file-store/src/main/assetUrl.ts`
- `packages/file-store/src/main/protocol.ts`
- `packages/file-store/src/main/handlers.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `packages/file-store/src/__tests__/`
