# File Dialog

## 功能状态

`@ls101/file-dialog` 已实现 Electron 系统原生文件打开与保存能力，并已接入 main 与 preload。

`@ls101/interface-editor` 已使用该模块实现 Interface 二进制包的导入会话和导出应用用例。当前尚未发现业务 renderer UI 对这些用例的实际调用，因此基础设施和业务交换 API 已落地，但 UI 工作流尚未形成可确认的集成事实。

## 功能边界

File Dialog 负责：

- 打开系统原生单文件选择对话框。
- 打开系统原生文件保存对话框。
- 在 main 中读取或写入用户选择的文件。
- 向 renderer 提供二进制和 UTF-8 文本便捷接口。
- 隐藏用户文件的绝对路径。

File Dialog 不负责：

- 管理应用私有持久化数据或 scope。
- 选择目录或一次选择多个文件。
- JSON、ZIP 或其他业务格式校验。
- 流式 I/O、进度报告、文件大小限制或原子写入。
- 向 renderer 返回或接受任意物理路径。

## 公共接口

renderer 从 `@ls101/file-dialog/renderer` 导入唯一的 `fileDialog` 实例：

```typescript
import { fileDialog } from '@ls101/file-dialog/renderer'
```

公开类型与接口：

```typescript
interface FileDialogFilter {
  readonly name: string
  readonly extensions: readonly string[]
}

interface ReadFileOptions {
  readonly title?: string
  readonly filters?: readonly FileDialogFilter[]
}

interface WriteFileOptions {
  readonly title?: string
  readonly defaultName?: string
  readonly filters?: readonly FileDialogFilter[]
}

interface SelectedFile<T> {
  readonly name: string
  readonly data: T
}

interface FileDialog {
  readBinary(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  readText(options?: ReadFileOptions): Promise<SelectedFile<string> | null>
  writeBinary(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
  writeText(data: string, options?: WriteFileOptions): Promise<boolean>
}
```

`FileDialogImpl` 是内部实现，不从 renderer package 入口导出。

main 从 `@ls101/file-dialog/main` 导出：

```typescript
registerFileDialog(): void
```

shared 导出两个 IPC 通道常量、公共 options 类型和 `FileDialogBridge` 类型。

## 读取语义

`readBinary()` 的行为：

1. renderer 校验 options。
2. preload 通过固定的 read channel 请求 main。
3. main 使用 `dialog.showOpenDialog()`，并固定设置 `properties: ['openFile']`。
4. main 根据 IPC sender 查找父 `BrowserWindow`；找不到时使用无父窗口对话框。
5. 用户取消或未返回路径时，结果为 `null`。
6. main 一次性读取完整文件，并只返回 basename 和 `Uint8Array`。

renderer 不会收到绝对路径。

`readText()` 复用二进制读取，并使用严格 UTF-8 解码：

```typescript
new TextDecoder('utf-8', { fatal: true })
```

无效 UTF-8 会抛出错误，不会用替换字符静默修复。

## 写入语义

`writeBinary()` 的行为：

1. renderer 校验数据必须是 `Uint8Array`，并校验 options。
2. preload 通过固定的 write channel 请求 main。
3. main 再次校验数据和 options。
4. main 使用 `dialog.showSaveDialog()` 获取保存位置。
5. 用户取消或未返回路径时，结果为 `false`。
6. main 一次性写入完整数据，成功后返回 `true`。

`writeText()` 要求输入为字符串，使用 `TextEncoder` 编码为 UTF-8，然后复用 `writeBinary()`。

## 参数校验

校验同时发生在 renderer 和 main。options 如存在，必须是非数组对象；未知字段不会被转发给 Electron。

`title` 规则：

- 必须是字符串。
- `trim()` 后不能为空。
- 校验通过后仍转发原始字符串，不自动 trim。

`defaultName` 规则：

- 必须是非空字符串。
- 不能是 `.` 或 `..`。
- 不能包含 `/`、`\` 或 NUL。
- 只作为保存框建议文件名传给 Electron，不能指定目录。

当前校验不是完整的跨平台文件名合法性检查，不限制长度，也不拒绝所有平台保留名称或字符。

`filters` 规则：

- 如提供，必须是非空数组。
- 每个 filter 必须有非空 `name`。
- `extensions` 必须是非空数组。
- 每个扩展名必须匹配 `^[a-zA-Z0-9][a-zA-Z0-9_-]*$`。
- 扩展名不带前导点，例如使用 `json`，不能使用 `.json`。
- 当前不支持 `*` 通配过滤器。

## 取消与错误

取消属于正常结果：

| 操作 | 取消 | 成功 |
| --- | --- | --- |
| `readBinary()` | `null` | `SelectedFile<Uint8Array>` |
| `readText()` | `null` | `SelectedFile<string>` |
| `writeBinary()` | `false` | `true` |
| `writeText()` | `false` | `true` |

以下情况抛出或传播错误：

- options、title、defaultName 或 filters 非法。
- `writeBinary()` 收到非 `Uint8Array` 数据。
- `writeText()` 收到非字符串数据。
- preload bridge 不存在。
- Electron dialog 调用失败。
- 文件读取或写入失败。
- 文本读取遇到无效 UTF-8。

模块不定义业务错误码，也不显示错误 UI；调用方负责捕获并呈现错误。

## Electron 集成

主进程在 `app.whenReady()` 后调用：

```typescript
registerFileDialog()
```

注册函数具有模块级重复调用保护，同一模块实例内只注册一次 handler。

preload 只暴露以下固定 bridge：

```typescript
interface FileDialogBridge {
  read(options?: ReadFileOptions): Promise<SelectedFile<Uint8Array> | null>
  write(data: Uint8Array, options?: WriteFileOptions): Promise<boolean>
}
```

对应 IPC 通道只有：

```text
file-dialog:read
file-dialog:write
```

文本转换只存在于 renderer façade，main 和 preload 始终使用同一套二进制协议。

## Interface 集成

`@ls101/interface-editor` 已通过窄化的 `InterfaceFileDialog` 端口使用 `readBinary()` 和 `writeBinary()`，并由 `createInterfaceApplication()` 注入具体实现。测试可以注入替代文件对话框。

已实现的交换能力包括：

- 导出 Interface ZIP 字节到 `.lsinterface` 文件。
- 提供 `LS101 Interface` 文件过滤器。
- 读取用户选择的 `.lsinterface` 文件并保留 basename。
- 在 File Dialog 返回字节后执行 Interface ZIP 解码和检查，并创建只能提交一次的导入会话。
- 保留读取取消的 `null` 和写入取消的 `false` 语义。

ZIP 编解码、文件名清理和 Interface 业务校验属于 `@ls101/interface-editor`，不属于通用 File Dialog。

## 当前限制

- 只支持单文件选择。
- 不支持目录选择。
- 不向 renderer 返回绝对路径。
- renderer 不能指定默认目录。
- 文本只支持严格 UTF-8。
- 读取和写入都一次性处理完整文件。
- 没有文件大小限制、流式 I/O 或进度回调。
- 写入直接使用 `writeFile()`，没有临时文件加 rename 的原子保存流程。
- 没有 IPC sender 授权策略或内容安全检查。

## 验证覆盖

当前自动化测试覆盖：

- options、defaultName、title 和 filters 校验。
- renderer 的二进制转发。
- UTF-8 文本编码、解码和无效 UTF-8 拒绝。
- 取消结果传递。
- Interface 导入导出逻辑对 File Dialog 抽象的使用。

当前未覆盖真实 Electron dialog、main handler、preload bridge 和文件系统 I/O 的端到端运行，也未直接测试父窗口关联、重复注册保护和 main 侧错误传播。

## 代码依据

- `packages/file-dialog/src/shared/types.ts`
- `packages/file-dialog/src/shared/validation.ts`
- `packages/file-dialog/src/renderer/FileDialog.ts`
- `packages/file-dialog/src/main/handlers.ts`
- `src/main/index.ts`
- `src/preload/index.ts`
- `packages/interface-editor/src/fileExchange.ts`
- `packages/file-dialog/src/__tests__/`
- `packages/interface-editor/src/__tests__/repository.test.ts`
