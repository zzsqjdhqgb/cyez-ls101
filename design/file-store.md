# 文件存储层设计（定稿）

## 一、职责边界与安全原则

为了保证 Electron 应用的安全性与高性能，本设计采用 **"沙盒化前端、高权限后端"** 的进程隔离设计：

- **渲染进程（Frontend）**：
  - **零物理路径感知**：前端代码不持有、不计算、不拼接任何本地物理路径（如 `C:/Users/...`）。
  - **唯一标识符通信**：前端仅持有逻辑 Key（格式为 `domain/filename`），并通过抽象接口读写数据，物理存储细节对前端完全透明。
- **主进程（Backend）**：
  - **安全防线与防御性编程**：主进程负责对所有传入的 Key 进行严格的合规性校验，在物理层阻断路径穿透（Path Traversal）攻击。
  - **文件 I/O 实体**：主进程独占 Node.js 文件系统访问权，负责路径拼接、物理读写、JSON 序列化、以及自定义协议注册。**存储根目录通过依赖注入传入，不在 handler 内部硬编码。**

---

## 二、逻辑 Key 命名规范与校验

为了实现跨平台的路径安全，Key 必须满足以下严格的命名契约，由一个 `/` 字符分割为**恰好两段**：

Key = domain + "/" + filename

### 1. 组成规则
- **`domain`（作用域）**：
  - 正则表达式：`/^[a-zA-Z]+(?:\.[a-zA-Z]+)*$/`
  - 约束：仅允许英文字母和点号 `.`。点号用于划分子目录，且**不允许连续点号（如 `..`）、不得以点号开头或结尾**。
- **`filename`（文件名）**：
  - 正则表达式：`/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`
  - 约束：必须以英文字母或数字开头，后续字符仅允许字母、数字、下划线 `_`、连字符 `-` 和点号 `.`。**严禁包含斜杠 `/` 或反斜杠 `\`**。

### 2. 校验示例
```text
interfaces.drafts/uuid-abc.json     → ✅ 合法
images.generated/img-a1b2c3.png     → ✅ 合法
audio.tts/sentence-1_v2.mp3         → ✅ 合法

a..b/f                              → ❌ 非法（包含连续点号）
.hidden/f                           → ❌ 非法（domain 以点号开头）
a/b/c                               → ❌ 非法（多于一个斜杠 "/"）
a/.hidden                           → ❌ 非法（filename 以点号开头，阻断隐藏文件创建）

> 安全防护原理：由于 domain 和 filename 规则极其严格，物理上排除了斜杠和反斜杠的输入，这在 IPC 边界处完美构筑了防线，100% 免疫 ../ 路径穿透漏洞。

———

## 三、存储服务接口定义

### 1. TextStore（结构化文本存储）

用于存储配置、草稿、Schema 等轻量级 JSON 文本。

export interface TextStore {
  /**
   * 读取并解析 JSON。key 不存在时返回 null。
   * 文件名与后缀完全由 key 中的 filename 决定，主进程不进行任何后缀自动追加。
   */
  read<T>(key: string): Promise<T | null>

  /** 将数据进行 JSON 序列化后写入物理磁盘（若文件不存在则创建，存在则覆盖） */
  write<T>(key: string, data: T): Promise<void>

  /** 删除指定 key 对应的物理文件 */
  delete(key: string): Promise<void>

  /**
   * 检查 key 对应的物理文件是否存在。
   * 注意：若后续需要立即读取数据，请勿先 exists 再 read，应直接 read 并在返回 null 时处理。
   */
  exists(key: string): Promise<boolean>

  /**
   * 列出指定前缀（domain/ 格式）下的所有 key。
   * 返回的 key 列表中保留完整的文件名与后缀。
   * 例：prefix = "interfaces.drafts/" -> 返回 ["uuid-abc.json", "uuid-def.json"]
   */
  list(prefix: string): Promise<string[]>
}

### 2. AssetStore（二进制资源存储）

用于存储图片、音频、视频等流媒体资源。

export interface AssetStore {
  /** 读取原始二进制数据。key 不存在时返回 null */
  read(key: string): Promise<Uint8Array | null>

  /** 将原始二进制数据原样写入物理磁盘 */
  write(key: string, data: Uint8Array): Promise<void>

  /** 删除指定 key 对应的文件 */
  delete(key: string): Promise<void>

  /** 检查 key 对应的物理文件是否存在（推荐在判断本地缓存时使用） */
  exists(key: string): Promise<boolean>

  /**
   * 列出指定前缀下的所有 key。保留文件名原始后缀。
   * 例：prefix = "images.generated/" -> 返回 ["img-a1b2c3.png", "img-d4e5f6.png"]
   */
  list(prefix: string): Promise<string[]>

  /**
   * 【核心 DX 优化】同步返回映射后的 asset:// 虚拟协议 URL，供前端直接在 DOM 中渲染。
   * 此方法为纯字符串同步拼接，不产生任何 IPC 进程间通信。
   * 例：key = "images.generated/img.png" -> 返回 "asset://images.generated/img.png"
   */
  getUrl(key: string): string
}

———

## 四、物理文件系统布局与映射规则

主进程在接收到 Key 后，按照以下映射公式在本地物理路径进行持久化：

### 1. 映射公式

• Raw output mode on: transcript text is shown for clean terminal selection.
TextStore 与 AssetStore 使用统一的映射公式：

Path = Join(baseDir, Replace(domain, ".", "/"), filename)

其中 `baseDir` 由主进程入口通过依赖注入传入（如 `app.getPath('userData')`）。

> *注：Node.js 端的 `path.join` 会在 Windows 系统下自动将 `/` 规范化为反斜杠 `\`。*

### 2. 物理目录结构示意
```text
baseDir/ (主进程入口传入，通常为 app.getPath('userData'))
├── interfaces/
│   ├── drafts/
│   │   ├── uuid-abc.json          ← 对应 Key: "interfaces.drafts/uuid-abc.json"
│   │   └── uuid-def.json
│   └── published/
│       └── uuid-xyz.json          ← 对应 Key: "interfaces.published/uuid-xyz.json"
├── instances/
│   └── inst-1.json                ← 对应 Key: "instances/inst-1.json"
├── config/
│   └── ai.json                    ← 对应 Key: "config/ai.json"
├── audio/
│   ├── uploaded/
│   └── tts/
│       └── sentence-1_v2.mp3      ← 对应 Key: "audio.tts/sentence-1_v2.mp3"
└── images/
    ├── uploaded/
    └── generated/
        └── img-a1b2c3.png         ← 对应 Key: "images.generated/img-a1b2c3.png"
```

---

## 五、项目工程结构与隔离规范 (Monorepo)

为了防止前端打包时误混入 Node.js 模块（如 `fs` / `path`）导致 Vite 等构建工具报错，在 `@ls101/file-store` 包内部实施 **"子路径导出（Subpath Exports）"** 物理隔离。

### 1. 包目录结构
```text
packages/file-store/
├── package.json
└── src/
    ├── shared/                    // 1. 共享通信契约层 (无任何 Node/DOM 依赖)
    │   ├── types.ts               // TextStore, AssetStore 接口定义
    │   ├── constants.ts           // 共享常量 (如 ASSET_PROTOCOL_SCHEME = 'asset')
    │   └── keyUtils.ts            // Key 的正则校验、格式化纯函数 (validateKey 等)
    │
    ├── main/                      // 2. 主进程物理层 (可安全使用 fs, path, ipcMain)
    │   ├── handlers.ts            // 注册并实现所有底层文件读写的逻辑
    │   └── index.ts               // 主进程入口，导出 registerFileStoreHandlers
    │
    └── renderer/                  // 3. 渲染进程转发层 (仅使用 window.ipcRenderer)
        ├── IpcTextStore.ts        // 1:1 无状态 IPC 转发类
        ├── IpcAssetStore.ts       // 1:1 无状态 IPC 转发类
        ├── ScopedAssetStore.ts    // 作用域修饰器 (Namespace 辅助类)
        └── index.ts               // 渲染进程入口，导出 textStore, assetStore 单例
```

### 2. `package.json` 子路径导出配置
```json
{
  "name": "@ls101/file-store",
  "version": "1.0.0",
  "exports": {
    "./main": {
      "types": "./src/main/index.ts",
      "default": "./src/main/index.ts"
    },
    "./renderer": {
      "types": "./src/renderer/index.ts",
      "default": "./src/renderer/index.ts"
    }
  }
}
```

---

## 六、IPC 通信契约

### Handler 注册（依赖注入模式）

主进程 handler 不直接调用 `app.getPath('userData')`，而是通过依赖注入接收 `baseDir`：

```typescript
// @ls101/file-store/main
import { ipcMain } from 'electron'

export function registerFileStoreHandlers(baseDir: string): void {
  ipcMain.handle('file:read', async (_event, key: string) => { ... })
  ipcMain.handle('file:write', async (_event, key: string, data: string) => { ... })
  ipcMain.handle('file:delete', async (_event, key: string) => { ... })
  ipcMain.handle('file:exists', async (_event, key: string) => { ... })
  ipcMain.handle('file:list-text', async (_event, prefix: string) => { ... })
  ipcMain.handle('file:read-binary', async (_event, key: string) => { ... })
  ipcMain.handle('file:write-binary', async (_event, key: string, data: Uint8Array) => { ... })
  ipcMain.handle('file:list-binary', async (_event, prefix: string) => { ... })
}
```

```typescript
// 主进程入口（src/main/index.ts）
import { registerFileStoreHandlers } from '@ls101/file-store/main'
import { app } from 'electron'

app.whenReady().then(() => {
  registerFileStoreHandlers(app.getPath('userData'))
})
```

### 渲染进程侧

渲染进程的实现类（如 `IpcTextStore`）保持**绝对无状态（Stateless）**，前端单例声明即用，不需要执行任何异步 `.init()` 过程：

```typescript
// @ls101/file-store/renderer
import { IpcTextStore, IpcAssetStore } from './core';

// 声明即用，前端不需要关心 baseDir 物理路径
export const textStore: TextStore = new IpcTextStore();
export const assetStore: AssetStore = new IpcAssetStore();
```

### IPC 映射关系表
所有物理路径拼接、JSON 序列化、二进制处理均在主进程后台静默完成，每次操作有且仅有 **1 次 IPC 通信**，不产生多余通信损耗。

| 前端方法 | 触发 IPC 管道 | 传递参数 | 返回数据类型 | 物理处理说明 |
| :--- | :--- | :--- | :--- | :--- |
| `textStore.read(key)` | `file:read` | `(key: string)` | `string \| null` | 物理读取文本，主进程读完返回给前端，前端自行 `JSON.parse` |
| `textStore.write(key, data)` | `file:write` | `(key: string, data: string)` | `void` | 前端 `JSON.stringify` 后传给主进程，主进程原样写入磁盘 |
| `textStore.delete(key)`<br>`assetStore.delete(key)` | `file:delete` | `(key: string)` | `void` | 删除物理文件 |
| `textStore.exists(key)`<br>`assetStore.exists(key)` | `file:exists` | `(key: string)` | `boolean` | 主进程通过 `fs.access` 高性能检索文件是否存在 |
| `textStore.list(prefix)` | `file:list-text` | `(prefix: string)` | `string[]` | 扫描物理目录，在主进程端过滤出对应前缀的所有文件并返回完整文件名列表 |
| `assetStore.read(key)` | `file:read-binary` | `(key: string)` | `Uint8Array \| null` | 读二进制资源。Node 端读出 Buffer，主进程直接返回字节流 |
| `assetStore.write(key, data)` | `file:write-binary` | `(key: string, data: Uint8Array)`| `void` | 写二进制资源。主进程将前端传来的 Uint8Array 直接写入物理磁盘 |
| `assetStore.list(prefix)` | `file:list-binary` | `(prefix: string)` | `string[]` | 扫描物理目录，在主进程端过滤并返回匹配的完整资源文件名列表 |

---

## 七、`asset://` 自定义文件协议工作原理

为了避免在渲染进程中使用慢速且庞大的 Base64 传递流媒体数据，主进程必须在初始化时注册 `asset://` 自定义协议，直接在底层拦截并以文件流形式返回数据：

### 1. 渲染进程视图调用
```tsx
// 纯同步字符串拼接：<img src="asset://images.generated/img-a1b2c3.png" />
return <img src={assetStore.getUrl('images.generated/img-a1b2c3.png')} />;
```

### 2. 主进程底层拦截与安全解析逻辑
主进程收到 Chromium 的网络请求后，解析映射步骤如下：

1. **协议拦截**：拦截到以 `asset://` 开头的网络请求。
2. **提取虚拟路径**：从请求中提取出主机名 `host` 和路径 `pathname`。
   - 示例：`asset://images.generated/img-a1b2c3.png`
   - 解析出：`domain` = `images.generated`, `filename` = `img-a1b2c3.png`
3. **Key 安全校验**：主进程使用共享层 `validateKey('images.generated/img-a1b2c3.png')` 进行合规性检查。**若不合法，直接阻断并返回 403 错误，防止路径穿透读取系统文件**。
4. **物理路径转换**：
   - 将 `domain` 中的 `.` 替换为 `/`，使用统一的映射公式：
   - `Path` = `path.join(baseDir, 'images/generated', 'img-a1b2c3.png')`
5. **高性能流式返回**：
3. **Key 安全校验**：主进程使用共享层 `validateKey('images.generated/img-a1b2c3.png')` 进行合规性检查。**若不合法，直接阻断并返回 403 错误，防止路径穿透读取系统文件**。
4. **物理路径转换**：
   - 将 `domain` 中的 `.` 替换为 `/`，使用统一的映射公式：
   - `Path` = `path.join(baseDir, 'images/generated', 'img-a1b2c3.png')`
5. **高性能流式返回**：
   - 主进程通过内置网络处理器，直接读取该物理路径的文件流，并高速返回给 Chromium 渲染引擎。
```