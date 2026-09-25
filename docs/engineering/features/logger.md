<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: logger
-->

# 应用日志（Logger）

`@ls101/logger` 是 main、preload 和 renderer 共用的日志设施。当前形态是：main 进程把结构化事件写入 JSONL 日志文件并镜像到控制台，renderer 通过 preload bridge 单向转发事件。

## 功能状态

已实现并接入的部分：

- `shared` 导出 `LogEvent` / `LogLevel` 类型、IPC 通道常量和 renderer 事件的边界校验函数。
- main 端 `MainLogger` 将事件追加写入 `application.log`，按大小轮转并保留固定数量文件；写文件失败只写控制台，不抛给调用方。
- main 端 `ConsoleLogger` 在无法建立文件 sink 时作为降级实现。
- main 端 `registerRendererLogger()` 接收 renderer 事件，经 `RendererLogGate` 校验和限流后写入同一个 `MainLogger`。
- preload 暴露 `window.logger` bridge；renderer 从 `@ls101/logger/renderer` 导入 `logger`。
- renderer 启动里程碑、启动阶段和全局 `error` / `unhandledrejection` 已接入该 logger。

接入点：`src/main/index.ts` 创建 logger，`src/main/bootstrap.ts` 记录启动里程碑与致命错误，`src/main/window.ts` 记录窗口生命周期，`src/main/application-services.ts` 注册 renderer 通道，`src/preload/index.ts` 暴露 bridge，`packages/renderer/src/startup-timing.ts`、`startup-phase.ts`、`startup-application.tsx` 产生 renderer 事件。

## 功能边界

负责：级别过滤、main 文件落盘与轮转、控制台镜像、renderer→main 转发、renderer 事件的大小与深度校验、按 webContents 限流。

不负责：敏感字段脱敏、日志级别的用户配置、用户可见的诊断导出、远程上报、`ipcMain` 处理器的统一计时包装、存储/仓储边界的自动埋点。后几项的实现状态见「与 todo 的对照」。

## 公共接口

```typescript
// packages/logger/src/shared/types.ts
type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEvent {
  level: LogLevel
  message: string
  timestamp?: string
  context?: Record<string, unknown>
  error?: { name: string; message: string; stack?: string }
}

interface LoggerBridge {
  write(event: LogEvent): void
}

const LOGGER_CHANNELS = { write: 'ls101:logger:write' }
```

`@ls101/logger/main` 导出 `MainLogger`、`ConsoleLogger`、`createMainLogger()`、`createConsoleLogger()`、`serializeError()`、`RendererLogGate`、`registerRendererLogger()`、`DEFAULT_MAX_LOG_FILE_BYTES`、`DEFAULT_MAX_LOG_FILES` 和 `MAX_RENDERER_LOG_*` 常量：

```typescript
interface MainLoggerOptions {
  directory: string
  filename?: string // 默认 application.log
  minimumLevel?: LogLevel // 默认 info
  maxFileBytes?: number // 默认 5 * 1024 * 1024
  maxFiles?: number // 默认 3
}

interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, error?: unknown, context?: Record<string, unknown>): void
  errorSync(message: string, error?: unknown, context?: Record<string, unknown>): void
  write(event: LogEvent): void
}
```

`@ls101/logger/renderer` 只导出单例 `logger`，方法为 `debug` / `info` / `warn` / `error`（`error` 接受 `error: unknown`）；没有 `errorSync`、`write` 或 `flush`。

main 侧 `registerRendererLogger(logger)` 监听 `ls101:logger:write`，不接受其他 logger IPC。preload 侧 `window.logger.write(event)` 在转发前再次调用 `validateRendererLogEvent()`，校验失败的事件被静默丢弃。

## 日志级别

| 级别    | 权重 | 控制台方法      | 默认最低级别 `info` 下的行为 |
| ------- | ---- | --------------- | ---------------------------- |
| `debug` | 10   | `console.debug` | 丢弃                         |
| `info`  | 20   | `console.info`  | 写入文件并输出               |
| `warn`  | 30   | `console.warn`  | 写入文件并输出               |
| `error` | 40   | `console.error` | 写入文件并输出               |

`write()` 按权重比较 `minimumLevel`，低于阈值直接返回（控制台也不会看到）。`errorSync()` 不做级别过滤，始终输出并同步落盘。

## 进程与存储边界

- 只有 main 进程写日志文件；renderer 与 preload 没有文件系统能力。
- 文件路径是 `join(app.getPath('logs'), 'application.log')`。应用未调用 `app.setAppLogsPath()`：macOS 默认 `~/Library/Logs/<AppName>`，Linux 和 Windows 默认位于 `userData` 目录内。
- 每条事件写成一行 JSON（JSONL）。新文件以权限 `0600` 创建；已存在的文件保持原权限。
- 文件与控制台同时输出：`MainLogger.write()` / `errorSync()` 和 `ConsoleLogger.write()` 都会调用对应的 `console.*`。
- 轮转在每次追加前按「当前文件大小 + 本次行字节数 > `maxFileBytes`」触发，保留 `application.log`、`application.log.1` … `application.log.(maxFiles-1)`。`maxFiles <= 1` 时只删除当前文件。配置非正整数时回退到默认值。
- 异步写入经内部 promise 队列串行化；`flush()` 等待队列完成，但应用代码不调用 `flush()`。
- `createMainLogger()` 初始化失败（例如 logs 目录不可写）时，`src/main/index.ts` 退回 `createConsoleLogger()` 并记录一条错误；此后不再尝试文件落盘。

## 数据语义

- `timestamp`：renderer 已提供时间戳时原样保留；缺失时由 main 补 `new Date().toISOString()`。
- renderer 事件进入文件前会被 `registerRendererLogger()` 合并 `context.process = 'renderer'` 和 `context.webContentsId`，同名键被覆盖。
- `serializeError()`：`Error` → `{ name, message, stack? }`；其他非空值 → `{ name: 'UnknownError', message: String(error) }`；`null` / `undefined` 省略 `error` 字段。
- `safeStringify()` 将循环引用替换为 `[Circular]`；序列化整体失败时写入一条固定的降级记录。

renderer 事件在 preload 和 main 各校验一次，限制如下：

| 限制                         | 值                     |
| ---------------------------- | ---------------------- |
| 单条事件序列化后字节数       | 64 KiB                 |
| `message` 长度               | 非空且不超过 4096 字符 |
| 单个字符串长度               | 32 KiB                 |
| `context` / `error` 嵌套深度 | 8                      |
| 对象或数组元素数             | 100                    |

校验失败返回 `malformed`、`too-large` 或 `too-deep`；非有限数字、函数、symbol、循环引用、非纯对象原型都会被判为 `malformed`。

`RendererLogGate` 额外按 webContents 限流：默认 60 秒窗口内最多 120 条，包含被判定非法的事件。超出后丢弃，并针对每种拒绝原因在每个窗口内最多向 logger 记一条 `warn`。webContents 销毁时清除限流状态。

## 验证覆盖

- `packages/logger/src/__tests__/logger.test.ts`：JSONL 写入、错误对象序列化、`errorSync` 同步落盘、轮转后仅保留配置数量、文件 sink 初始化失败时的 console 降级。
- `packages/logger/src/__tests__/renderer.test.ts`：renderer `logger.error` 经 `window.logger` bridge 转发并序列化 `Error`。
- `packages/logger/src/__tests__/validation.test.ts`：renderer 事件的边界校验。
- `tests/main/startup.test.ts`：以 mock logger 断言 main 启动里程碑按顺序记录。
- 未覆盖：启动成功后的文件写入失败、renderer 全局 `error` / `unhandledrejection` 的端到端转发、任何读取真实 `application.log` 的 Electron 集成测试。

## 与 todo 的对照

[`../todo/logger.md`](../todo/logger.md) 的首段四项（shared logger、main 文件 sink、preload bridge、renderer 与全局错误转发）已实现；其「deferred」清单逐项状态如下：

| todo 项                                                             | 状态   | 依据                                                                                                                        |
| ------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------- |
| 为每个 `ipcMain.handle` / `ipcMain.on` 包装操作名、耗时和规范化错误 | 未实现 | 只有 `ls101:logger:write` 被包装，其余 IPC 直接透传                                                                         |
| 用共享 logger 替换业务 `console.*`，为长任务加请求 ID               | 未实现 | `src/main/data-directory.ts`、`src/preload/index.ts` 仍有 8 处 `console.*`；共享 logger 未被业务模块引用                    |
| 在存储与仓储边界埋点，包括当前被吞掉的降级错误                      | 未实现 | `packages/file-store`、`packages/config-store`、`packages/airouter`、`packages/submission-library` 均不依赖 `@ls101/logger` |
| 对 API Key、prompt、作答内容和用户文件路径定义并执行脱敏            | 未实现 | 代码中不存在 `redact` / `sanitize`；校验只限制大小与深度                                                                    |
| 诊断导出流程；按需把保留策略做成可配置                              | 未实现 | 没有导出入口或设置项；保留策略只以 `MainLoggerOptions` 形式存在于代码中，应用使用默认值                                     |
| 补充启动后写入失败与浏览器全局错误转发的测试                        | 部分   | 有初始化失败降级和轮转单测；无启动后写入失败测试，renderer 测试未覆盖全局错误监听                                           |

## 已知限制 / 未决

- 没有任何脱敏层。当前 main 侧调用点只记录启动里程碑、窗口生命周期和错误对象，没有记录 API Key、邀请码或作答内容；但 renderer 的任何模块都可以通过 `logger.*` 提交任意 `context`，这些内容会原样进入日志文件。
- `Logger` 接口不暴露 `flush()`，应用退出前不等待写入队列；致命路径改用 `errorSync()` 同步落盘。
- 最低级别、文件大小和保留数量只能在构造时决定，应用使用写死的默认值，没有运行时或用户可见的开关。
- 控制台镜像始终开启，打包应用下输出位置取决于启动方式。
- 浏览器预览没有 preload bridge，此时只有 `error` 级别会退化为 `console.error`，`info` / `warn` / `debug` 丢失。
- `docs/engineering/subsystems/README.md` 把 `logger.md` 列为待建立的子系统文档，覆盖同一 `packages/logger`；该子系统文档尚未建立，本文只描述特性契约。

## 代码依据

- `packages/logger/src/shared/types.ts`
- `packages/logger/src/shared/validation.ts`
- `packages/logger/src/main/logger.ts`
- `packages/logger/src/main/renderer-log-gate.ts`
- `packages/logger/src/main/index.ts`
- `packages/logger/src/renderer/index.ts`
- `packages/logger/src/__tests__/`
- `src/main/index.ts`
- `src/main/bootstrap.ts`
- `src/main/window.ts`
- `src/main/application-services.ts`
- `src/preload/index.ts`
- `packages/renderer/src/startup-timing.ts`
- `packages/renderer/src/startup-phase.ts`
- `packages/renderer/src/startup-application.tsx`
