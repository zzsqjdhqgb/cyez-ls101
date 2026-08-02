# Task Progress

## 功能状态

`@ls101/core-types` 已定义跨模块长耗时任务进度契约 `TaskProgressHandle<TResult>`。该契约不提供全局任务管理器或具体实现类，由执行长耗时操作的领域模块创建句柄并维护快照。

`@ls101/interface-editor` 已使用该契约包装 Interface AI 文本生成、结果校验和实例保存流程。题组编辑页已通过 `useSyncExternalStore` 接入该句柄，展示流式日志、步骤状态和取消入口；当前仍未实现跨模块通用进度列表组件。

## 功能边界

Task Progress 负责定义：

- UI 可直接读取的扁平任务项列表。
- 任务项的等待、进行和完成状态。
- 可选的纯文本或 Markdown 流式日志。
- 快照读取和变更订阅协议。
- 取消入口和最终业务结果 Promise。

Task Progress 不负责：

- 启动或调度具体任务。
- 定义 AI Router、文件系统或其他基础设施的流式协议。
- 规定失败、取消或部分成功的统一业务结果类型。
- 保存任务历史或在应用重启后恢复进度。
- 提供 React 组件、弹窗、折叠面板或日志渲染器。
- 自动聚合全应用的并发任务。

## 公共接口

从 `@ls101/core-types` 导入：

```typescript
import type { TaskProgressHandle, TaskProgressItem, TaskProgressSnapshot } from '@ls101/core-types'
```

接口定义：

```typescript
interface TaskProgressItem {
  id: string
  label: string
  status: 'waiting' | 'running' | 'completed'
  log?: {
    format: 'text' | 'markdown'
    content: string
  }
}

interface TaskProgressSnapshot {
  items: readonly TaskProgressItem[]
}

interface TaskProgressHandle<TResult> {
  getSnapshot(): TaskProgressSnapshot
  subscribe(listener: () => void): () => void
  cancel(): void
  readonly completion: Promise<TResult>
}
```

## 任务列表语义

- `items` 是不可嵌套的扁平列表。
- `id` 在同一个句柄的任务列表中应保持稳定，供 UI 作为列表 key 使用。
- `label` 是可直接展示的步骤名称。
- `waiting` 表示步骤尚未开始。
- `running` 表示步骤正在执行。
- `completed` 表示步骤已经结束。
- 当前状态集合不包含 `failed` 或 `cancelled`；失败和取消属于整个业务操作的最终结果，由 `completion` 的结果类型表达。
- 领域实现可以在失败时将正在运行的任务项结束为 `completed`，并在可选日志中记录错误；UI 仍应以 `completion` 结果作为最终业务状态来源。

列表可以在运行过程中增加任务项，但当前契约不提供父子关系、百分比、权重或预计剩余时间。

## 日志语义

`log` 始终可选。

- `format: 'text'` 表示内容按纯文本展示。
- `format: 'markdown'` 表示 UI 可以按受控 Markdown 展示。
- `content` 是当前完整日志快照，不是单次增量。
- 生产者接收到增量事件时负责累积内容并发布新快照。
- `running` 和 `completed` 任务项都可以携带日志。
- 没有可展示文本的任务可以完全省略 `log`。

例如图片生成可以只更新状态：

```typescript
{
  id: 'image-cover',
  label: '生成图片 cover',
  status: 'running'
}
```

完成后：

```typescript
{
  id: 'image-cover',
  label: '生成图片 cover',
  status: 'completed'
}
```

## 快照与订阅

`getSnapshot()` 返回当前完整进度。生产者只在进度内容发生变化时替换快照对象，因此该接口可直接用于 React `useSyncExternalStore`：

```typescript
const snapshot = useSyncExternalStore(handle.subscribe, handle.getSnapshot)
```

`subscribe(listener)` 注册变更监听器，并返回取消订阅函数。监听器只表示快照可能已经变化，调用方应重新调用 `getSnapshot()` 获取数据。

该契约不要求消费者使用 React；其他 UI 框架可以使用等价订阅机制。

## 最终结果与取消

`completion` 的类型由具体业务定义。例如 Interface AI 生成使用：

```typescript
type InterfaceAIGenerationResult =
  | { status: 'completed'; instance: InterfaceInstanceDetails }
  | { status: 'invalid-response'; rawOutput: string; errors: readonly InstanceDataError[] }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' }
```

`cancel()` 只表示请求取消。具体实现负责把取消信号传给底层操作，并最终让 `completion` 返回业务定义的取消结果或明确失败结果。

取消不保证能够中断已经不可撤销的同步步骤。领域实现应在写入持久化数据之前再次检查取消状态，以避免取消后继续提交结果。

## 基础设施边界

基础设施不需要依赖 `TaskProgressHandle`。

例如 AI Router 可以提供自己的增量流：

```typescript
interface TextGenerationChunk {
  type: 'reasoning' | 'output'
  delta: string
}

generateText(
  request: TextGenerationRequest,
  options: { signal: AbortSignal }
): AsyncIterable<TextGenerationChunk>
```

调用 AI Router 的领域模块负责：

1. 消费基础设施流。
2. 累积增量文本。
3. 创建和更新任务项。
4. 追加领域自身的校验、转换和保存步骤。
5. 将基础设施错误转换为领域结果。

图片生成等一次性操作可以使用普通 Promise，领域模块只在 Promise 开始和结束时更新无日志任务项。

## Interface 集成

Interface AI 生成当前建立三个任务项：

```text
AI 生成
校验生成结果
保存实例
```

文本流中的 `reasoning` 和 `output` 会由 Interface 累积为第一个任务项的 Markdown 日志：

```markdown
### 思考

模型提供的思考过程

### 输出

模型输出的 JSON
```

文本流结束后，Interface 依次更新校验和保存步骤。AI Router 不需要知道这些 Interface 领域步骤。

## 当前限制

- 任务列表不支持嵌套。
- 没有百分比、任务权重、耗时、开始时间或结束时间字段。
- 没有全局任务注册表或后台任务中心。
- 没有持久化和恢复能力。
- 没有统一错误对象，最终结果由各领域自行定义。
- 没有通用 React 组件。
- 当前只有 Interface AI 流程创建了实际句柄；renderer 已将 AIRouter 文本流适配到 Interface 生成端口。
- Interface 图片生成尚未实现，当前没有可验证的图片任务进度行为。

## 验证覆盖

当前自动化测试覆盖：

- Interface 将 AI reasoning/output 增量转换为流式 Markdown 日志。
- AI、校验和保存三个扁平任务项的状态推进。
- AI 成功后覆盖当前实例并保留 UUID。
- 同一实例运行 AI 时拒绝第二个生成、整表保存和 JSON 覆盖。
- renderer 在互斥的 AI/JSON 分栏中选择模型、订阅进度句柄、锁定编辑、取消生成并回填完成结果。
- AIRouter 默认模型和显式指定模型的选择与文本增量流转发。

当前未覆盖 Markdown 语义渲染、真实 Provider 端到端流、图片任务以及应用关闭时的任务清理。

## 代码依据

- `packages/core-types/src/task-progress.ts`
- `packages/core-types/src/index.ts`
- `packages/interface-editor/src/application.ts`
- `packages/interface-editor/src/__tests__/repository.test.ts`
- `packages/airouter/src/index.ts`
- `packages/renderer/src/features/interfaces/InterfaceAIRouterAdapter.ts`
- `packages/renderer/src/features/interfaces/InterfaceInstanceEditorPage.tsx`
