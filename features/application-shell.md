# 应用外壳与注册式导航

## 功能状态

`@ls101/renderer` 已实现可运行的 React 应用入口、注册式路由、自动生成的侧边栏、自定义 Electron 标题栏、基础设计令牌和少量通用 UI 组件。

Electron main 已创建无边框主窗口并注册窗口控制 IPC；preload 已将固定的窗口控制桥接暴露为 `window.windowControls`。renderer 在 Electron 环境中使用该桥接控制当前窗口，在普通浏览器环境中仍可渲染，但窗口按钮会处于禁用状态。

当前工作台和其他页面仅包含轻量占位内容。试卷、批改、Interface、Template 等领域应用尚未接入应用外壳。

## 功能边界

应用外壳负责：

- 创建 React 根节点和 `MemoryRouter`。
- 接收路由注册，并据此生成 React Router 路由。
- 根据路由的导航元数据生成主侧边栏和底部导航。
- 展示应用品牌、自定义标题栏和窗口控制按钮。
- 管理一次 renderer 运行期间的侧边栏展开或收起状态。
- 提供颜色、间距、字号、圆角和布局尺寸等设计令牌。
- 提供当前 renderer 内部复用的按钮、图标按钮、Tooltip、页面结构和空状态组件。

应用外壳不负责：

- 定义最终产品主导航结构。
- 加载、保存或校验任何领域数据。
- 创建 Interface、Template、试卷或批改应用服务。
- 权限控制、登录状态、路由守卫或按用户隐藏导航。
- 编辑器内部布局、未保存内容确认或离开页面拦截。
- Electron 原生全屏、kiosk 或多窗口工作流。
- 暗色主题切换和主题持久化。

## 模块与进程边界

```text
Electron main
  ├── 创建无边框 BrowserWindow
  ├── 注册窗口控制 IPC
  └── 将最大化状态变化发送给发起窗口
          │
          ▼
preload
  └── 暴露 window.windowControls 固定桥接
          │
          ▼
renderer
  ├── 路由注册表
  ├── MemoryRouter
  ├── AppShell
  │   ├── TitleBar
  │   ├── Sidebar
  │   └── Outlet
  └── 页面与内部 UI 组件
```

renderer 不直接导入 Electron，也不能直接调用 `ipcRenderer`。窗口操作只能通过 preload 暴露的 `WindowControlsBridge` 完成。

## 应用启动

renderer 入口为：

```text
packages/renderer/src/index.tsx
```

入口执行顺序：

1. 导入当前内置路由注册模块。
2. 加载设计令牌和全局样式。
3. 查找 `#root`；不存在时抛出错误并停止渲染。
4. 使用 React `StrictMode` 渲染 `<App />`。
5. `<App />` 创建 `MemoryRouter`，并将注册路由放入共享 `<AppShell />`。

使用 `MemoryRouter` 意味着当前页面地址不会写入浏览器地址栏或系统 URL。一次 renderer 重新加载后会重新进入 `/`。

## 路由注册接口

路由注册表位于：

```text
packages/renderer/src/app/route-registry.ts
```

当前接口是 renderer 内部应用接口，尚未从 `@ls101/renderer` package 根入口导出为稳定库 API。

```typescript
interface NavigationRegistration {
  label: string
  icon: LucideIcon
  placement?: 'main' | 'footer'
  group?: string
  order?: number
}

interface AppRouteRegistration {
  id: string
  path: `/${string}`
  component: ComponentType
  navigation?: NavigationRegistration
}

function registerAppRoute(registration: AppRouteRegistration): () => void
```

### 路由字段

| 字段         | 必填 | 语义                                                 |
| ------------ | ---- | ---------------------------------------------------- |
| `id`         | 是   | 注册表内的唯一身份；不显示给用户                     |
| `path`       | 是   | React Router 路径，必须以 `/` 开头；同一注册表内唯一 |
| `component`  | 是   | 路由命中时渲染的无参数 React 组件                    |
| `navigation` | 否   | 存在时生成侧边栏入口；省略时注册为隐藏路由           |

注册表不修改或包装页面组件。页面需要的领域服务、Context 和临时 UI 状态仍由 renderer bootstrap 或页面组件提供。

### 导航字段

| 字段        | 默认值   | 语义                                                      |
| ----------- | -------- | --------------------------------------------------------- |
| `label`     | 无       | 导航可见名称，同时作为链接的无障碍名称和折叠 Tooltip 文本 |
| `icon`      | 无       | Lucide React 图标组件                                     |
| `placement` | `'main'` | `'main'` 位于侧栏主体，`'footer'` 位于侧栏底部            |
| `group`     | 无       | 相同字符串的路由显示在同一导航组，组名显示在第一项上方    |
| `order`     | `0`      | 数值升序排列；相同值保留当前注册顺序                      |

导航先按 `order` 排序，再按 `group` 汇集。分组本身出现的位置取决于该组排序后第一条路由的位置。未填写 `group` 的路由统一进入无标题分组。

### 注册与移除语义

`registerAppRoute()` 同步完成注册并返回移除函数：

```typescript
const unregister = registerAppRoute(registration)
unregister()
```

- 注册成功后生成新的只读路由数组快照，并同步通知全部订阅者。
- 移除成功后同样生成新快照并通知订阅者。
- 同一个移除函数重复调用不会报错，也不会重复通知。
- `useRegisteredRoutes()` 使用 `useSyncExternalStore()` 订阅注册表，运行期间新增或移除路由会触发应用重新渲染。
- 当前注册表只存在于 renderer 内存中，不持久化到文件。

以下情况同步抛出错误，且注册表保持不变：

- `id` 与已有路由重复。
- `path` 与已有路由重复。

当前不会校验空 `id`、空导航名称、路径模式合法性、图标类型或未知字段；这些错误可能在 React Router 或渲染阶段表现出来。

## 注册示例

项目在 `register-placeholder-routes.ts` 中保留四种最小示例。

### 默认主导航

省略 `placement` 时进入主导航：

```typescript
registerAppRoute({
  id: 'workbench',
  path: '/',
  component: WorkbenchPage,
  navigation: {
    label: '工作台',
    icon: PanelsTopLeft,
    order: 0
  }
})
```

### 分组导航

填写 `group` 后显示组标题，并与同名项归入同一组：

```typescript
registerAppRoute({
  id: 'grouped-placeholder',
  path: '/grouped-example',
  component: GroupedPlaceholderPage,
  navigation: {
    label: '分组页面',
    icon: Boxes,
    group: '示例分组',
    order: 10
  }
})
```

### 底部导航

```typescript
registerAppRoute({
  id: 'settings-placeholder',
  path: '/settings',
  component: SettingsPlaceholderPage,
  navigation: {
    label: '设置',
    icon: Settings2,
    placement: 'footer',
    order: 0
  }
})
```

### 隐藏路由

省略 `navigation` 后路由仍可通过 `navigate()` 或链接访问，但不会显示在侧边栏：

```typescript
registerAppRoute({
  id: 'hidden-placeholder',
  path: '/hidden-example',
  component: HiddenPlaceholderPage
})
```

### 热更新清理

模块级注册在 Vite HMR 时需要移除旧注册，避免重新执行模块后产生重复 ID 或路径：

```typescript
const unregisterRoutes = [registerAppRoute(first), registerAppRoute(second)]

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterRoutes.forEach((unregister) => unregister())
  })
}
```

## 工作台

工作台使用固定注册 ID `workbench` 和根路由 `/`，显示在主导航中。

当前工作台只包含统一页面标题、一个进入隐藏路由示例的按钮和空状态。它尚未读取最近编辑内容、待办任务、最近访问记录或快捷操作数据，也没有定义这些数据的跨模块契约。

## 侧边栏行为

侧边栏完全由当前路由快照生成，不保存固定业务导航数组。

- 主导航和底部导航分别渲染。
- 当前路径使用 `NavLink` 判断选中状态；根路径使用精确匹配。
- 展开状态显示图标和完整名称。
- 折叠状态宽度为设计令牌 `--sidebar-collapsed-width`，只显示图标。
- 折叠状态通过 Tooltip 展示导航名称。
- 收起或展开按钮与普通导航项使用相同高度；折叠后缩为图标按钮。
- 折叠状态保存在 `AppShell` React state 中，renderer 刷新后恢复为展开状态。

当前没有自动根据窗口宽度收起侧栏，也没有拖拽调整侧栏宽度。

## 自定义标题栏与窗口

main 创建的 `BrowserWindow` 关键配置：

```typescript
{
  width: 1280,
  height: 800,
  minWidth: 760,
  minHeight: 560,
  frame: false,
  show: false,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

窗口在 `ready-to-show` 后显示，避免首次加载时展示空白内容。开发环境加载 `ELECTRON_RENDERER_URL`，生产环境加载构建后的 `renderer/index.html`。

应用菜单被移除。renderer 创建新窗口的请求始终被拒绝；HTTP 和 HTTPS 地址会交给系统默认浏览器打开。主窗口加载完成后，指向其他地址的顶层导航会被阻止。

### 窗口控制契约

`@ls101/core-types` 导出：

```typescript
interface WindowControlsBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  getMaximized(): Promise<boolean>
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
}
```

preload 将该接口暴露为：

```typescript
window.windowControls
```

每个 IPC handler 都通过 `event.sender` 查找发起请求的 `BrowserWindow`，不会使用全局主窗口引用：

- 找不到有效窗口时，最小化、最大化切换和关闭为无操作。
- 找不到有效窗口时，`getMaximized()` 返回 `false`。
- 最大化与还原事件只发送给被操作窗口的 renderer。
- `onMaximizedChange()` 返回取消订阅函数；TitleBar 在卸载时调用该函数。

窗口操作没有独立的取消过程。IPC 调用或 Electron 操作失败时，Promise 拒绝会传播给调用方；TitleBar 当前没有展示错误反馈。

`registerWindowControlHandlers()` 没有重复注册保护，只应在应用启动期间调用一次。当前 `src/main/index.ts` 在 `app.whenReady()` 中调用一次。

## 设计令牌

设计令牌定义在：

```text
packages/renderer/src/styles/tokens.css
```

令牌覆盖：

- 画布、侧栏、表面、边界和文字颜色。
- 主色、危险色及交互状态颜色。
- 字体栈、间距、圆角和阴影。
- 标题栏高度、展开与折叠侧栏宽度、页面最大宽度。

`:root` 提供浅色主题。`[data-theme='dark']` 已定义对应变量，但当前代码不会设置该属性，也没有主题切换 UI 或持久化逻辑，因此暗色主题尚未形成用户可用功能。

全局样式只负责盒模型、根节点尺寸、基础字体、焦点环和文本选择颜色。组件专属样式使用 CSS Modules。

## 内部 UI 组件

以下组件位于 `packages/renderer/src/components/ui/`，目前仅是 renderer 内部复用组件，没有从 package 根入口导出：

| 组件         | 当前能力                                                                         |
| ------------ | -------------------------------------------------------------------------------- |
| `Button`     | `primary`、`secondary`、`ghost`、`danger` 四种外观；小和中两种尺寸；可选前置图标 |
| `IconButton` | 默认、ghost、danger 三种外观；小和中两种尺寸；强制提供无障碍名称和 Tooltip       |
| `Tooltip`    | 上、右、下、左四个方向；hover 或 focus-within 后显示；可禁用                     |
| `Page`       | 提供统一最大宽度、水平留白和垂直间距                                             |
| `PageHeader` | 页面一级标题和右侧操作区                                                         |
| `EmptyState` | 图标和单行标题的轻量空状态                                                       |

这些组件没有表单状态管理、异步 loading 约定、菜单、对话框、toast、下拉选择或数据表功能。新增组件应基于真实页面需求，而不是预先扩充完整组件库。

## 集成状态

已完成：

- Electron main 创建主窗口。
- main 注册文件存储、文件对话框和窗口控制能力。
- preload 暴露三个独立 bridge。
- renderer 入口、注册表、应用外壳、侧边栏和标题栏接线。
- 工作台、分组导航、底部导航和隐藏路由示例接线。
- 生产构建能够打包 main、preload、renderer 和品牌图标。

尚未完成：

- renderer bootstrap 和领域应用服务 Context。
- Interface Editor 的真实页面和数据接线。
- Template、试卷、考试播放器、批改和设置业务页面。
- 复杂编辑器的专注布局或播放器的沉浸布局。
- 真实 Electron 环境中的自动化端到端测试。

## 已知限制

- 所有注册路由共用同一种标题栏加侧边栏布局。
- 路由注册不支持 lazy component、加载状态、错误边界或页面级元数据。
- 导航只支持两种固定位置，不支持多级子菜单。
- 路由和导航注册只存在于内存中。
- 侧边栏折叠状态不持久化。
- Tooltip 使用当前 DOM 层级定位，不使用 portal，也没有自动避让窗口边缘。
- 自定义标题栏没有针对 macOS、Windows 和 Linux 分别调整窗口控制布局。
- `will-navigate` 当前只允许与当前完整 URL 相同的顶层导航，没有通用站内 URL 白名单。
- 窗口控制按钮不捕获或呈现 IPC 错误。
- 浏览器预览不会提供窗口控制 bridge，因此窗口按钮禁用。

## 验证覆盖

自动化测试覆盖：

- 注册后生成新快照并通知订阅者。
- 移除后清空路由并再次通知订阅者。
- 重复路由 ID 和路径被拒绝。
- 主导航、分组导航和底部导航能够从注册信息生成。
- 隐藏路由不出现在侧边栏，但可通过程序导航进入。
- 路由切换后页面内容更新。
- 折叠侧边栏后展开按钮仍然存在。

项目级验证已运行：

- TypeScript 类型检查。
- ESLint。
- Vitest 全量测试。
- electron-vite 生产构建。

当前未自动覆盖：

- 真实 Electron 窗口创建和窗口按钮点击。
- 最大化状态事件的 main、preload、renderer 端到端传播。
- CSS 布局截图、Tooltip 边界避让和不同操作系统显示效果。
- 外部链接打开与顶层导航阻止行为。

## 代码依据

- `packages/renderer/src/index.tsx`
- `packages/renderer/src/app/App.tsx`
- `packages/renderer/src/app/route-registry.ts`
- `packages/renderer/src/app/register-placeholder-routes.ts`
- `packages/renderer/src/components/shell/`
- `packages/renderer/src/components/ui/`
- `packages/renderer/src/styles/`
- `packages/renderer/src/pages/`
- `packages/renderer/src/__tests__/`
- `packages/core-types/src/window-controls.ts`
- `src/main/index.ts`
- `src/main/window.ts`
- `src/main/window-controls.ts`
- `src/preload/index.ts`
