## 进程分工

```
渲染进程（React）                   主进程（Electron）
─────────────────                   ─────────────────
  所有业务逻辑                      仅桥接原生能力
  所有 UI 状态                      - 文件系统读写
  Section 引擎（纯函数）            - 系统对话框
  Interface / Template 管理         - 本地模型推理（TTS、本地 STT）
  批改系统                          - 配置存储（API Key 等）
  考试播放器
  云 API 调用（直接 fetch）
```

IPC 表面积很小，主进程只暴露以下能力：

| IPC Handler | 用途 |
|-------------|------|
| `file:read` / `file:write` / `file:listDir` | 文件系统读写 |
| `file:zip` / `file:unzip` | ZIP 打包/解压 |
| `dialog:openFile` / `dialog:saveFile` | 系统文件对话框 |
| `ai:ttsSynthesize` | 本地 TTS 合成（调用 WASM Worker） |
| `ai:sttTranscribe` | 本地语音识别（调用 ONNX 模型） |
| `config:get` / `config:set` | 敏感配置读写（API Key 等） |

## 模块分层

```
┌──────────────────────────────────────────────────┐
│  UI 层（渲染进程）                                │
│                                                  │
│  试卷管理    批改管理    设置                      │
│  ├─ 试卷列表 ├─ 作答导入 ├─ AI 引擎配置           │
│  ├─ Interface│─ 评分界面 ├─ 权重文件管理           │
│  │  管理     │─ Schema  │                        │
│  ├─ Template │  管理    │                        │
│  │  编辑器   │─ 成绩导出│                        │
│  └─ 预览     └─ 结算    │                        │
│                                                  │
│  考试播放器 <ExamPlayer /> (fixed 覆盖层)         │
├──────────────────────────────────────────────────┤
│  业务层（渲染进程，纯 TypeScript）                │
│                                                  │
│  Section 引擎 ── Interface ── Template           │
│  (参数树展开)    (AI 生成)    (组装)              │
│                                                  │
│  评分系统 ── Schema                              │
│  (执行管道)    (评分单元定义)                     │
├──────────────────────────────────────────────────┤
│  引擎层                                          │
│                                                  │
│  AI 引擎 (渲染进程: LLM/生图 API fetch)            │
│  AI 引擎 (主进程:   TTS WASM / 本地 STT)          │
├──────────────────────────────────────────────────┤
│  存储层（主进程）                                  │
│                                                  │
│  userData/                                       │
│  ├── exams/     (试卷)                            │
│  ├── submissions/ (作答)                          │
│  ├── interfaces/ (题型 + 数据实例)                 │
│  ├── templates/  (试卷模板)                       │
│  ├── schemas/    (评分 Schema)                     │
│  └── config/     (AI 配置、API Key)               │
└──────────────────────────────────────────────────┘
```

## 模块职责

| 模块 | 位置 | 职责 |
|------|------|------|
| Section 引擎 | 渲染进程 | 参数树 → Question[] 展开。纯函数，可单独测试 |
| Interface | 渲染进程 | 题型管理：参数定义、AI 生成提示词模板、调用 LLM API、数据实例管理 |
| Template | 渲染进程 | 模板管理：Section 结构定义、数据来源绑定（Interface 实例或自定义） |
| Schema | 渲染进程 | 定义评分题型、题型数据、答案格式和 Template 输入契约 |
| 考试播放器 | 渲染进程 | React 组件，fixed 覆盖层。从 examBaseUrl 加载 ExamPackage，产出完整作答归档 Blob |
| AI 引擎 | 渲染 + 主进程 | 云 API（渲染进程直接 fetch），本地推理（主进程 IPC） |
| 存储 | 主进程 | 文件读写、导入导出 ZIP、系统对话框 |

## 领域包与 UI 分层规范

本节适用于所有领域 package，不针对某个具体编辑器或业务模块。

### 分层目标

领域 package 负责与 UI 框架无关的领域模型、业务规则和应用用例；`renderer` 负责 React 组件、页面交互和视觉表现。

纯展示和交互方式变化不应迫使领域 package 修改；业务语义发生变化时，应由领域 package 统一承载规则，UI 只调用相应用例并展示结果。

判断一项规则归属哪一层时，可以将当前 React UI 替换为命令行、Web 或移动端：

- 更换 UI 后仍然成立的规则属于领域 package。
- 只描述当前页面如何展示、选择或反馈的规则属于 `renderer`。

例如，“发布前必须通过业务校验”属于领域规则；“校验错误显示在输入框下方并使用红色文字”属于 UI 规则。

### 领域 Package 的职责

领域 package 可以包含以下内容：

- 领域数据类型和稳定的跨模块数据契约。
- 与 React、Electron 和具体存储无关的纯查询、校验、转换及不可变编辑函数。
- 面向完整用户用例的应用服务，例如创建、发布、生成、导入或导出。
- 应用服务所需的依赖端口，例如持久化、AI 生成、系统文件选择和跨模块引用查询。
- 封装领域特有基础设施知识的适配器，例如该领域的文件布局和交换文件编解码。

领域 package 不应包含：

- React 组件、Hooks、Context、路由或页面布局。
- 弹窗、toast、loading、颜色、文案排版等展示逻辑。
- 当前选中项、展开状态、活动标签等页面临时状态。
- 为了方便 UI 而写入持久化领域对象的视觉或交互字段。

领域 package 并非只能保存数据结构。只要业务行为与具体 UI 无关，就应由领域 package 实现和测试。

### 纯逻辑与应用服务

没有外部依赖和生命周期的逻辑直接使用纯函数，不需要机械地包装成 class 或工厂：

```typescript
const next = editDraft(draft, operation)
const errors = validateDraft(next)
```

需要持久化、AI、系统能力或跨模块协作，并负责完整业务流程的部分，使用应用服务封装：

```typescript
interface DraftApplication {
  create(): Promise<Draft>
  save(draft: Draft): Promise<SaveDraftResult>
  publish(draftId: string): Promise<PublishResult>
}
```

应用服务通常由工厂接收依赖后创建：

```typescript
const drafts = createDraftApplication({ persistence })
```

工厂的价值是注入依赖、确定生命周期和封装业务不变量。如果一个工厂不接收依赖、不管理状态，也不建立任何不变量，它通常只是多余的 namespace，应改为直接导出纯函数。

应用服务对外暴露完整用例，不暴露要求调用方按正确顺序组合的实现步骤。例如 UI 应调用一次 `publish()`，而不是自行依次执行校验、计算 ID、检查冲突和写入仓储。

### Renderer 的职责

`renderer` 统一负责：

- React 页面、组件、路由和布局。
- 表单、树视图、弹窗、toast、loading 和错误展示。
- 当前选中项、搜索条件、展开状态、活动标签等页面临时状态。
- 调用领域应用服务并将结果转换为用户可见反馈。
- 创建 React Context 和 Hooks，将应用服务提供给组件树。
- 在应用启动时组装各领域服务及其基础设施依赖。

UI 不应直接操作仓储、编解码器或底层迁移步骤，也不应复制领域校验和状态转换规则。

### Bootstrap 与组合根

`renderer` 中应有一个明确的 bootstrap，也称 composition root。它负责创建具体基础设施适配器，将其注入领域应用服务，并把组装后的高层能力提供给 UI。

```typescript
export function createApplicationServices(): ApplicationServices {
  const persistence = createFilePersistence(fileStore)
  const application = createDomainApplication({
    persistence,
    textGenerator,
    imageGenerator,
    fileDialog
  })

  return { domain: application }
}
```

bootstrap 是对象组装者，不是新的业务模块。它可以知道具体使用哪个 file-store、AI Router、文件对话框或其他适配器，但不实现领域规则，也不处理日常用户操作。

组装后的服务通常在一次应用运行期间只有一套，属于应用级生命周期。应用级单例不等同于从任意模块直接导入全局实例。推荐在应用入口创建服务，再通过 React Context 或显式参数注入组件：

```tsx
const services = createApplicationServices()

root.render(
  <ApplicationServicesProvider value={services}>
    <App />
  </ApplicationServicesProvider>
)
```

这样组件依赖保持可见，测试、Storybook 和独立页面可以注入替代实现，也不会在模块导入时隐式初始化基础设施。

### 基础设施适配器

领域代码只依赖其声明的窄能力端口，不直接依赖具体基础设施：

```typescript
interface Persistence {
  load(id: string): Promise<Entity | null>
  save(entity: Entity): Promise<void>
}
```

具体适配器可以位于领域 package 的专用子入口或独立 adapter package。领域特有的文件布局、交换格式和迁移规则不应被推给 `renderer` 实现；`renderer/bootstrap` 只负责选择和组装适配器。

推荐的依赖方向为：

```text
renderer/bootstrap
    ├──> renderer UI
    ├──> domain application
    └──> infrastructure adapters

renderer UI
    └──> domain application API

domain application
    ├──> domain logic
    └──> dependency ports

infrastructure adapters
    └──> dependency ports
```

禁止领域 package 反向依赖 `renderer`。纯领域代码也不应依赖 React、Electron 或某个具体存储实现。

### 公共 API 可见性

领域 package 的公共入口是稳定 API 白名单，而不是内部文件的汇总。根入口原则上只暴露：

- 其他模块必须消费的稳定数据契约。
- UI 完成有意义用户操作所需的应用用例。
- UI 本地编辑需要的少量纯领域函数。
- 创建应用服务所需的工厂和公开结果类型。

以下内容通常不应从根入口暴露：

- 哈希、规范化、路径遍历等实现算法。
- 仓储文件结构和存储中间类型。
- ZIP、JSON Schema 或第三方库的低层编解码细节。
- 只用于组合完整用例的步骤函数。
- 要求调用方记住调用顺序才能维持不变量的操作。
- 只供包内实现构造结果的 helper。

组合层确实需要的适配器或系统维护能力，可以通过明确的 package 子入口提供；不要允许调用方直接 deep import `src/*`。

决定一个符号是否公开时，应依次检查：

1. 其他模块是否必须直接理解这段数据？
2. UI 是否能通过该 API 完成一个有意义的用户操作？
3. API 本身是否维护相关业务不变量？
4. 调用方是否必须了解内部步骤和正确执行顺序？
5. 替换存储、编解码库或 UI 框架后，该 API 是否仍应稳定？
6. 项目是否愿意长期兼容这个符号？

如果调用方必须了解内部步骤，通常说明 API 过于面向过程；如果替换基础设施后 API 就失去意义，它通常属于适配器或内部实现，而不是根入口。

### 状态归属

领域状态由领域 package 定义并维护，例如草稿、发布内容、实例和业务操作结果。

UI 状态只存在于 `renderer`，例如：

- 当前选中的树节点。
- 面板、标签和弹窗是否打开。
- 搜索关键字和列表排序方式。
- 页面级 loading、toast 和临时错误展示。

不要将 UI 状态写入领域对象或持久化格式。否则调整页面布局和交互方式会不必要地修改核心模型及数据迁移逻辑。

### 变更边界

遵守以上分层后，应达到以下效果：

- 修改视觉设计、页面布局或 React 组件库时，只修改 `renderer`。
- 更换存储、AI 或系统能力实现时，修改 bootstrap 和对应适配器，不修改领域规则。
- 修改业务校验、身份、发布、删除或迁移语义时，在领域 package 中集中修改。
- 领域逻辑可以脱离 React 和 Electron 单独测试。
- UI 可以通过假的应用服务测试，无需启动真实文件系统或 AI。

架构目标不是保证任何 UI 需求都不修改领域 package，而是保证纯展示与交互变化不影响领域模型；当需求改变业务语义时，领域 package 必须提供相应的完整用例，UI 不得通过拼接底层操作绕过它。

### 长耗时任务进度

AI 生成、导入导出和批量运算等长耗时操作使用 `@ls101/core-types` 中的 `TaskProgressHandle<TResult>` 作为跨模块 UI 契约。

- 进度由不可嵌套的任务项列表组成。
- 任务项状态只有 `waiting`、`running` 和 `completed`。
- `running` 与 `completed` 项可以提供持续更新的纯文本或 Markdown 日志，UI 可折叠展示。
- 句柄提供只读快照、变更订阅、取消操作和最终结果 Promise。
- AI Router 等基础设施提供自己的流式或 Promise 接口，不依赖 `TaskProgressHandle`。领域调用者负责把基础设施事件适配为任务列表，并追加自己的校验、保存等步骤；具体 AI 供应商或编解码库的事件类型不应暴露给 UI。
- 日志始终可选。无法或无需提供流式文本的任务（例如单张图片生成）可以只更新任务项状态，不填写 `log`。
- 任务失败和取消通过最终结果表达；进度状态只表示步骤推进，不额外复制业务结果状态。

该契约只描述可展示的进度，不规定 React 组件。`renderer` 可以使用 `useSyncExternalStore` 订阅，也可以在其他 UI 框架中采用等价机制。

## 关键数据流

```
出卷:
  教师操作 UI → Interface 模块拼 prompt → fetch LLM API
  → 数据实例保存（IPC: file:write）
  → Template 组装 Section 结构 + 绑定数据实例
  → 展开为 ExamPackage → 保存（IPC: file:write）

考试:
  主体 App 加载 ExamPackage → 传给 <ExamPlayer />
  → 按答案捕获计划收集字符串答案和 MediaRecorder 录音
  → 复制 SubmissionTemplate 并补充考生、时间和答案
  → 播放器使用预检缓存中的静态附件生成完整作答归档 Blob
  → onFinish 回调返回 Blob
  → 主体 App 下载、上传或写入收卷库（Electron 保存时使用 IPC: file:write）

批改:
  导入作答（IPC: file:unzip）
  → 逐项读取 SubmissionPackage 中的完整 SchemaUse 批改快照
  → 转写录音（IPC: ai:sttTranscribe 或云 API fetch）
  → LLM 预评分（fetch）
  → 教师确认 → 结算 → 导出成绩
```

## 关键设计决策

1. **渲染进程重，主进程薄。** 业务逻辑绝大多数是纯数据操作，放在渲染进程避免 IPC 膨胀。主进程只桥接文件系统和本地模型推理。

2. **Section 引擎是渲染进程中的纯函数。** 参数树展开不依赖任何原生能力——遍历、映射、生成 Question[] 全在 JS 里完成。

3. **云 API 调用不走主进程。** LLM 和云端 STT 是 HTTP 请求，渲染进程直接 fetch。API Key 通过 IPC 从主进程的加密存储中获取。

4. **考试播放器是独立组件。** CSS Modules 隔离样式，fixed 覆盖层独占全屏，通过兼容 HTTP GET 语义的 `examBaseUrl` 加载考试，callback 输出作答结果，不直接依赖 IPC。最终作答归档的保存或上传由宿主负责。
