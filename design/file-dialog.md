# 系统文件对话框设计

## 一、职责边界

`@ls101/file-dialog` 用于在 Electron 应用中调用系统原生文件对话框，并完成用户所选文件的读取或写入。

它与 `@ls101/file-store` 的职责不同：

- `file-store` 管理应用私有 `userData` 目录中的 scope 数据。
- `file-dialog` 负责用户主动选择的外部文件，用于导入、导出等文件交换场景。
- `file-dialog` 不提供 scope、文件列表、删除或持续管理能力。
- renderer 不接触用户文件的绝对路径。主进程在用户完成选择后直接执行文件 I/O。

`file-dialog` 不集成到 `ScopedStore`，也不允许 renderer 传入任意路径进行读写。

## 二、进程分层

模块沿用 Electron 进程隔离：

```text
renderer
  fileDialog 单例
      ↓
preload
  固定方法的 FileDialogBridge
      ↓
main
  Electron dialog + Node.js 文件 I/O
```

各层职责：

- renderer 提供二进制和 UTF-8 文本的便捷接口，并在 IPC 前校验参数。
- preload 只暴露 `read()` 和 `write()` 两个固定桥接方法，不暴露完整 `ipcRenderer`。
- main 重新校验所有参数，弹出系统对话框，并完成磁盘读取或写入。
- main 根据 IPC 请求的 `event.sender` 查找父窗口，使对话框归属于发起请求的窗口；找不到父窗口时使用无父窗口对话框。

## 三、公共接口

renderer 公开一个 `fileDialog` 单例和必要类型：

```typescript
export interface FileDialogFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

export interface ReadFileOptions {
  readonly title?: string
  readonly filters?: readonly FileDialogFilter[]
}

export interface WriteFileOptions {
  readonly title?: string
  readonly defaultName?: string
  readonly filters?: readonly FileDialogFilter[]
}

export interface SelectedFile<T> {
  readonly name: string
  readonly data: T
}

export interface FileDialog {
  readBinary(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  readText(options?: ReadFileOptions): Promise<SelectedFile<string> | null>
  writeBinary(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
  writeText(data: string, options?: WriteFileOptions): Promise<boolean>
}
```

导入方式：

```typescript
import { fileDialog } from '@ls101/file-dialog/renderer'
```

`FileDialogImpl` 是内部实现类，不从 package 入口导出。调用方使用模块提供的唯一 `fileDialog` 实例。

## 四、读取语义

### 二进制读取

```typescript
const selected = await fileDialog.readBinary({
  title: '导入 Interface 包',
  filters: [{ name: 'Interface 包', extensions: ['lsinterface'] }]
})

if (selected) {
  console.log(selected.name)
  consumePackage(selected.data)
}
```

读取流程：

1. main 调用 Electron `dialog.showOpenDialog()`。
2. 对话框固定使用 `openFile`，当前只允许选择一个文件。
3. 用户取消时返回 `null`。
4. 用户选择文件后，main 读取完整文件内容。
5. renderer 只收到文件 basename 和 `Uint8Array`，不收到绝对路径。

### 文本读取

```typescript
const selected = await fileDialog.readText({
  filters: [{ name: 'JSON 文件', extensions: ['json'] }]
})
```

`readText()` 复用 `readBinary()`，在 renderer 使用以下规则解码：

```typescript
new TextDecoder('utf-8', { fatal: true })
```

文本编码固定为 UTF-8。无效 UTF-8 会抛出错误，不使用替换字符静默修复文件内容。

## 五、写入语义

### 二进制写入

```typescript
const saved = await fileDialog.writeBinary(data, {
  title: '导出 Interface 包',
  defaultName: 'interface.lsinterface',
  filters: [{ name: 'Interface 包', extensions: ['lsinterface'] }]
})
```

写入流程：

1. main 调用 Electron `dialog.showSaveDialog()`。
2. `defaultName` 作为系统保存框的建议文件名。
3. 用户取消时返回 `false`。
4. 用户选择保存位置后，main 将完整 `Uint8Array` 写入目标文件。
5. 写入成功返回 `true`。

`defaultName` 只能是文件名，不能包含 `/`、`\`、NUL 或 `.`、`..`。调用方不能通过它指定目录。

### 文本写入

```typescript
await fileDialog.writeText(JSON.stringify(value, null, 2), {
  defaultName: 'data.json',
  filters: [{ name: 'JSON 文件', extensions: ['json'] }]
})
```

`writeText()` 在 renderer 使用 `TextEncoder` 将字符串编码为 UTF-8，再复用 `writeBinary()`。main 和 IPC 层只处理二进制数据，不维护另一套文本文件协议。

## 六、文件过滤器

过滤器采用与 Electron 对话框兼容的最小数据结构，但 shared 类型不直接依赖 Electron 类型：

```typescript
{
  name: '图片',
  extensions: ['png', 'jpg', 'jpeg', 'webp']
}
```

校验规则：

- `name` 必须是非空字符串。
- `extensions` 必须是非空数组。
- 每个扩展名必须匹配 `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`。
- 扩展名不带前导点，例如使用 `json`，不能使用 `.json`。
- 扩展名不能包含路径分隔符或路径片段。
- 不传 `filters` 表示不限制文件类型。

## 七、取消与错误

用户取消是正常交互，不作为异常：

| 操作            | 取消返回值 | 成功返回值                 |
| --------------- | ---------- | -------------------------- |
| `readBinary()`  | `null`     | `SelectedFile<Uint8Array>` |
| `readText()`    | `null`     | `SelectedFile<string>`     |
| `writeBinary()` | `false`    | `true`                     |
| `writeText()`   | `false`    | `true`                     |

以下情况抛出错误：

- options、标题、默认文件名或过滤器不合法。
- `writeBinary()` 收到的值不是 `Uint8Array`。
- `writeText()` 收到的值不是字符串。
- 系统对话框调用失败。
- 文件读取或写入失败。
- `readText()` 读取到无效 UTF-8。

模块内部不显示错误弹窗。业务 UI 负责捕获错误并决定用户提示方式。

## 八、IPC 契约

主进程只注册两个通道：

```text
file-dialog:read
file-dialog:write
```

preload 桥接接口：

```typescript
export interface FileDialogBridge {
  read(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  write(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
}
```

文本方法只存在于 renderer façade。这样主进程、preload 和 IPC 始终只有一套二进制读写实现。

IPC handler 具有重复注册保护。`registerFileDialog()` 可被重复调用，但只会在首次调用时注册 handler。

## 九、包导出边界

```text
@ls101/file-dialog/main
└── registerFileDialog

@ls101/file-dialog/renderer
├── fileDialog
├── FileDialog
├── FileDialogFilter
├── ReadFileOptions
├── WriteFileOptions
└── SelectedFile

@ls101/file-dialog/shared
├── FILE_DIALOG_CHANNELS
├── FileDialogBridge
├── FileDialogFilter
├── ReadFileOptions
├── WriteFileOptions
└── SelectedFile
```

主进程注册：

```typescript
import { app } from 'electron'
import { registerFileDialog } from '@ls101/file-dialog/main'

app.whenReady().then(() => {
  registerFileDialog()
})
```

preload 暴露固定 bridge：

```typescript
contextBridge.exposeInMainWorld('fileDialog', fileDialogBridge)
```

## 十、当前限制

当前版本有意保持最小能力：

- 只支持选择单个文件。
- 不支持选择目录。
- 不支持向 renderer 返回物理路径。
- 不支持 renderer 指定默认目录。
- 文本只支持 UTF-8。
- 不提供 JSON 解析或业务格式校验。
- 不提供流式 I/O、进度回调或文件大小限制。

JSON、ZIP 和业务交换包的解析、编码及运行时校验应由各业务模块负责，`file-dialog` 只负责系统对话框和原始文件内容交换。
