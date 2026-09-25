<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: renderer
-->

# 应用外壳与注册式导航

## 功能状态

`@ls101/renderer` 在 v0.4.1 已实现：启动占位与延迟加载的应用 bundle、组合根 `App`、注册式路由与设置注册表、`MemoryRouter`、三种布局等级的应用外壳、侧边栏、自定义标题栏、外观主题运行时和内部通用 UI 组件。

renderer 组合根 `packages/renderer/src/app/App.tsx` 依次挂载 `AppearanceSettingsProvider`、`InterfaceApplicationProvider`、`SchemaApplicationProvider`、`ExamLibraryProvider`、`SubmissionLibraryProvider`、`TemplateApplicationProvider`，再挂载 `MemoryRouter` 与 `RegisteredAppRoutes`，并渲染 `ManualImageGenerationDialog`、`BuiltinInterfaceMaintenanceDialog`、`ReleaseNotesModal` 和 `AppToaster`。

`register-placeholder-routes.ts` 当前注册 26 条路由：7 条进入导航（6 条主导航 + 1 条底部导航），19 条隐藏。全部路由指向 `features/` 或 `pages/` 下的真实页面组件；该文件不引用 `GroupedPlaceholderPage`、`FocusPlaceholderPage`、`ImmersivePlaceholderPage`、`HiddenPlaceholderPage`，这些组件当前没有注册入口。

Electron main 创建无边框主窗口、注册窗口控制 IPC、文件/内建资产协议和单实例锁；preload 通过 `contextBridge` 暴露 13 个独立 bridge；renderer 只通过这些 bridge 访问主进程能力。

## 功能边界

应用外壳负责：创建 React 根节点、绘制启动占位动画并安装应用级错误处理；按注册表生成 React Router 路由并按 `matchRoutes` 结果选择 `standard`、`focus` 或 `immersive`；由导航元数据生成主导航和底部导航；展示品牌、标题栏和窗口控制按钮；在一次 renderer 运行期间保存侧边栏折叠状态；提供设计令牌（`styles/tokens.css`）和内部 UI 组件；把外观设置应用到 `document.documentElement`。

应用外壳不负责：领域数据的加载、保存和校验（由 `App.tsx` 挂载的领域 Provider 及其 application 层承担）；登录、权限、路由守卫或按用户隐藏导航；编辑器内部的脏数据确认和离开拦截；Electron 原生全屏、kiosk 或多窗口工作流；原生窗口的最小化、最大化、关闭实现（位于 main）。

## 进程边界

```text
Electron main   注册存储协议与窗口控制 IPC、创建无边框窗口、初始化服务
      │         最大化状态变化只发给发起窗口
      ▼
preload         contextBridge.exposeInMainWorld 暴露 13 个 bridge
      ▼
renderer       index.tsx → startup-application → startup-active-application
               路由注册表 / 设置注册表 → AppShell(TitleBar/Sidebar/Outlet)
               领域 Provider、页面与内部 UI 组件
```

- `BrowserWindow` 使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 并指定 preload。
- renderer 不导入 Electron，也不接触 `ipcRenderer`；只有 preload 调用 `contextBridge.exposeInMainWorld`。
- `setWindowOpenHandler` 拒绝所有新窗口；`http`/`https` 交给 `shell.openExternal`。
- `will-navigate` 在目标 URL 与当前完整 URL 不同时阻止顶层导航，没有通用站内白名单；`Menu.setApplicationMenu(null)` 移除应用菜单。

## 应用启动与就绪

main 启动顺序（`src/main/bootstrap.ts`）：安装 source map、注册文件存储与内建存储协议、调用 `registerWindowControlHandlers()`、申请单实例锁；`app.whenReady()` 后 `startApplication()` 设置 AppUserModelId、创建主窗口并启动 `initializeApplication()`。`src/main/index.ts` 初始化日志与数据目录；`import('./application-services')` 在 `waitForWindowShown` resolve 后才执行，随后 `registerApplicationServices()` 注册文件存储、内建存储、配置存储、AI 路由、剪贴板、文件对话框、许可、数据目录、旧数据和 renderer 日志服务。`initializeApplication()` 返回后 `startupResult` resolve，`STARTUP_CHANNELS.whenReady` 的 IPC handler 才 resolve。

窗口生命周期（`src/main/window.ts` 的 `MainWindowLifecycleEvent`）：`createMainWindow()` 以 `show: false` 创建窗口，绑定窗口控制事件后加载 `ELECTRON_RENDERER_URL` 或构建产物 `renderer/index.html`。`webContents.once('dom-ready')` 发出 `renderer-dom-ready`，随后在 `setImmediate` 中，若窗口仍存在且不可见则调用 `window.show()` 再发出 `shown`；`ready-to-show` 只发出生命周期事件，不触发 `window.show()`。`shown` resolve 启动流程的 `windowShown`，`destroyed-before-shown` 与 `load-failed-before-shown` 会 reject 并进入启动失败路径。

renderer 启动顺序：`packages/renderer/src/index.tsx` 校验 `#root`、绘制启动 logo、记录 `startup-timing` 里程碑，并在两帧后动态 `import('./startup-application')`。`startApplication()` 用 `createRoot` 创建根并安装 `onUncaughtError`、`onCaughtError`、`onRecoverableError` 以及全局 `error`、`unhandledrejection` 日志。`prepareApplication()` 依次等待 `window.startup.whenReady()`、`window.license.getStatus()`、`window.legacyData.getInfo()`：许可未激活时渲染 `LicenseActivationPage`，存在待整理旧数据时渲染 `LegacyDataMigrationPage`。`initializeActiveApplication()` 调用 `appInfo.ensureInstallationMarker()`，初始化内建 schema、interface、template 内容，再调用 `appInfo.claimReleaseNotesVersion()`。`renderActiveApplication()` 渲染 `StartupApplicationView` → `App`；`startup-active-application` 模块导入时执行 `./app/register-settings` 和 `./app/register-placeholder-routes`。

启动最短时长由 logo 动画结束再叠加 `STARTUP_COMPLETION_DELAY_MS`（`startup-placeholder.ts`，1000ms）决定。`MemoryRouter` 不写入系统 URL，renderer 重载后回到 `/`。

## 公共接口

### 路由注册接口

`packages/renderer/src/app/route-registry.ts`：

```typescript
type RouteLayout = 'standard' | 'focus' | 'immersive'
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
  layout?: RouteLayout
  navigation?: NavigationRegistration
}
function registerAppRoute(registration: AppRouteRegistration): () => void
function useRegisteredRoutes(): readonly AppRouteRegistration[]
```

- 类 `AppRouteRegistry` 用 `useSyncExternalStore` 发布只读快照；注册和注销都生成新快照并同步通知订阅者。
- `id` 或 `path` 重复时同步抛出 `Error`，注册表保持不变；返回的注销函数幂等。
- 该接口只在 renderer 内部使用；`packages/renderer/package.json` 的 package 入口 `./src/index.tsx` 不导出路由注册 API。

### 设置页注册接口

`packages/renderer/src/app/settings-registry.ts`：

```typescript
interface SettingsGroupRegistration {
  id: string
  label: string
  order?: number
}

interface SettingsPageRegistration {
  id: string
  title: string
  description?: string
  icon: LucideIcon
  group: SettingsGroupRegistration
  order?: number
  component: ComponentType
}

function registerSettingsPage(registration: SettingsPageRegistration): () => void
function useRegisteredSettingsPages(): readonly SettingsPageRegistration[]
```

- 页面 `id` 重复时抛错；同一 `group.id` 的 `label` 或 `order` 不一致时抛错，两种情况都不改变注册表。
- `/settings`（`SettingsOverviewPage`）按分组 `order`、组内页面 `order` 排序，并导航到 `/settings/${encodeURIComponent(page.id)}`。
- `/settings/:settingsPageId/*`（`SettingsDetailPage`）从注册表按 `settingsPageId` 查找页面，统一渲染标题、描述和返回入口；未命中时渲染“设置项不存在”空状态。

### 窗口控制契约

`packages/core-types/src/window-controls.ts` 导出：

```typescript
interface WindowControlsBridge {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  getMaximized(): Promise<boolean>
  onMaximizedChange(listener: (maximized: boolean) => void): () => void
}
```

`src/main/window-controls.ts` 的 `registerWindowControlHandlers()` 注册 `WINDOW_CONTROL_CHANNELS` 的 invoke handler；每个 handler 通过 `BrowserWindow.fromWebContents(event.sender)` 定位发起窗口，不使用全局主窗口引用。`bindWindowControlEvents()` 监听 `maximize`/`unmaximize` 并只向该窗口 `webContents` 发送 `WINDOW_CONTROL_EVENTS.maximizedChanged`。`TitleBar` 挂载时调用 `getMaximized()` 并订阅 `onMaximizedChange()`，卸载时取消订阅。

### preload 暴露面

`src/preload/index.ts` 末尾一次性暴露 13 个 bridge：

| 全局名 | 类型来源 | 说明 |
| --- | --- | --- |
| `startup` | `@ls101/core-types` | `whenReady()` 等待 main 启动结果 |
| `fileStore` | `@ls101/file-store/shared` | `FILE_STORE_CHANNELS` 白名单后 `invoke` |
| `builtinFileStore` | `@ls101/file-store/shared` | `BUILTIN_FILE_STORE_CHANNELS` 白名单后 `invoke` |
| `configStore` | `@ls101/config-store/shared` | `CONFIG_STORE_CHANNELS` 白名单后 `invoke` |
| `airouter` | `@ls101/airouter/shared` | 配置、模型、连接测试及流式生成/语音 start/abort |
| `fileDialog` | `@ls101/file-dialog/shared` | 读写文件对话框 |
| `imageClipboard` | `@ls101/clipboard/shared` | 读取剪贴板图片、写入文本 |
| `appInfo` | `@ls101/core-types` | 版本、安装标记、版本说明认领 |
| `license` | `@ls101/core-types` | 许可状态、激活、停用、激活指引 |
| `dataDirectory` | `@ls101/core-types` | 数据目录信息、选择、迁移、清理 |
| `legacyData` | `@ls101/core-types` | 旧数据信息、导出、清理、重试 |
| `windowControls` | `@ls101/core-types` | 窗口最小化/最大化/关闭/订阅 |
| `logger` | `@ls101/logger/shared` | 经 `validateRendererLogEvent` 校验后转发 |

`fileStore`、`builtinFileStore`、`configStore` 对 channel 做白名单校验，`logger` 校验日志事件结构。`packages/renderer/src/env.d.ts` 只为 `startup`、`appInfo`、`dataDirectory`、`legacyData`、`license`、`windowControls`、`logger` 声明可选的 `Window` 全局类型，其余 bridge 由各自 package 的 renderer 入口模块访问。

### 外观运行时

- `features/settings/AppearanceSettingsApplication.ts` 通过 `configStore.scope('appearance')` 的 `settings` 文档持久化 `theme`（`system`/`light`/`dark`）与 `reduceMotion`，文档带 `version: 1`；默认 `light` + `reduceMotion: false`。
- `features/settings/AppearanceSettingsProvider.tsx` 加载、保存、回滚并向下提供 `setTheme`、`setReduceMotion`、`reset`。
- `features/settings/AppearanceSettingsRuntime.ts` 的 `applyAppearanceSettings()` 设置 `document.documentElement` 的 `data-theme` 和 `data-reduce-motion`；`theme === 'system'` 时解析 `prefers-color-scheme: dark` 并订阅 `matchMedia` 的 `change`，每次应用前先移除上一个系统主题监听。
- `styles/tokens.css` 定义 `[data-theme='dark']` 变量，`styles/global.css` 定义 `[data-reduce-motion]` 规则。

## 当前注册

### 路由

`packages/renderer/src/app/register-placeholder-routes.ts` 注册 26 条路由。6 条主导航按 `navigation.order` 升序渲染，`settings` 使用 `placement: 'footer'`。

| id | path | layout | 导航 |
| --- | --- | --- | --- |
| `workbench` | `/` | standard | 工作台（main，order 0） |
| `exams` | `/exams` | standard | 试卷库（main，10） |
| `submissions` | `/submissions` | standard | 作答记录（main，20） |
| `interfaces` | `/interfaces` | standard | 题型库（main，30） |
| `templates` | `/templates` | standard | 试卷模板（main，40） |
| `schemas` | `/schemas` | standard | 评分单元（main，50） |
| `settings` | `/settings` | 省略 = standard | 设置（footer，0） |
| `settings-detail` | `/settings/:settingsPageId/*` | standard | 隐藏 |
| `exam-player` | `/exams/player` | immersive | 隐藏 |
| `submission-grading` | `/submissions/grading` | focus | 隐藏 |
| `submission-grading-legacy` | `/submissions/:submissionId/grade` | focus | 隐藏 |
| `submission-settlement` | `/submissions/settlement` | focus | 隐藏 |
| `template-editor` | `/templates/:templateId` | focus | 隐藏 |
| `template-exam-generation` | `/templates/:templateId/generate` | focus | 隐藏 |
| `builtin-template-viewer` | `/templates/builtin/:templateId` | focus | 隐藏 |
| `builtin-template-exam-generation` | `/templates/builtin/:templateId/generate` | focus | 隐藏 |
| `template-function-editor` | `/templates/libraries/:libraryId/functions/:functionId` | focus | 隐藏 |
| `schema-draft-library` | `/schemas/drafts/:libraryId` | standard | 隐藏 |
| `schema-draft-editor` | `/schemas/drafts/:libraryId/:draftId` | focus | 隐藏 |
| `schema-definition-editor` | `/schemas/:schemaId` | focus | 隐藏 |
| `interface-drafts` | `/interfaces/drafts` | standard | 隐藏 |
| `interface-draft-editor` | `/interfaces/drafts/:draftId` | focus | 隐藏 |
| `interface-details` | `/interfaces/:interfaceId` | standard | 隐藏 |
| `interface-import` | `/interfaces/import` | focus | 隐藏 |
| `interface-export` | `/interfaces/:interfaceId/export` | focus | 隐藏 |
| `interface-instance-editor` | `/interfaces/:interfaceId/instances/:instanceId` | focus | 隐藏 |

注册文件在 `import.meta.hot` 的 `dispose` 中调用全部注销函数，避免 HMR 重复注册。

### 设置页

`packages/renderer/src/app/register-settings.ts` 注册 5 个设置页：`storage`（通用，order 10）、`license`（通用，20）、`ai-router`（AI，页面 order 0）、`appearance`（通用，0）、`about`（通用，100）；分组为 `general`（通用，order 0）和 `ai`（AI，order 10）。同样在 `import.meta.hot.dispose` 中注销。

## 验证覆盖

- `packages/renderer/src/__tests__/route-registry.test.tsx`：注册/注销快照与订阅通知、重复 `id`/`path` 拒绝。
- `packages/renderer/src/__tests__/settings-registry.test.tsx`、`SettingsPages.test.tsx`：设置页注册表与设置页行为。
- `packages/renderer/src/__tests__/App.test.tsx`：主导航与底部导航链接（工作台、题型库、评分单元、试卷库、作答记录、试卷模板、设置）、路由布局映射、侧边栏折叠、版本说明、从工作台进入题型/模板。
- `packages/renderer/src/__tests__/AppearanceSettingsApplication.test.ts`、`AppearanceSettingsPage.test.tsx`、`StartupApplicationView.test.tsx`：外观设置与启动视图。
- Electron 集成测试位于 `tests/integration/`：`electron-app.spec.ts`、`startup-progress.spec.ts`、`data-directory.spec.ts`、`license.spec.ts`、`airouter.spec.ts`、`interface-editor.spec.ts`、`template-preview.spec.ts`。`yarn test:smoke`（容器内 `xvfb-run -a`）重建产物并运行 `electron-app.spec.ts`。

## 已知限制

- 路由注册不支持 lazy component、加载状态、错误边界或页面级元数据。
- 导航只支持 `main` 和 `footer` 两种位置，不支持多级子菜单。
- 路由、导航和设置页注册只存在于 renderer 内存中，不持久化。
- 侧边栏折叠状态不持久化，刷新后恢复展开。
- `Tooltip` 使用当前 DOM 层级定位，不使用 portal，也没有自动避让窗口边缘。
- 标题栏未针对 macOS、Windows、Linux 分别调整窗口控制布局。
- `will-navigate` 只允许与当前完整 URL 相同的顶层导航，没有通用站内白名单。
- 窗口控制按钮不捕获或呈现 IPC 错误；浏览器预览没有 `window.windowControls`，按钮处于禁用状态。
- `registerWindowControlHandlers()` 没有重复注册保护，只在 `src/main/bootstrap.ts` 模块加载时调用一次。
- 布局等级只改变 renderer 外壳，不调用 Electron 原生全屏或 kiosk，也不改变窗口尺寸与系统任务栏。

## 代码依据

- `packages/renderer/src/index.tsx`
- `packages/renderer/src/startup-application.tsx`
- `packages/renderer/src/startup-active-application.tsx`
- `packages/renderer/src/StartupApplicationView.tsx`
- `packages/renderer/src/startup-placeholder.ts`
- `packages/renderer/src/startup-timing.ts`
- `packages/renderer/src/app/App.tsx`
- `packages/renderer/src/app/register-placeholder-routes.ts`
- `packages/renderer/src/app/register-settings.ts`
- `packages/renderer/src/app/route-registry.ts`
- `packages/renderer/src/app/settings-registry.ts`
- `packages/renderer/src/components/shell/AppShell.tsx`
- `packages/renderer/src/components/shell/TitleBar.tsx`
- `packages/renderer/src/components/shell/Sidebar.tsx`
- `packages/renderer/src/pages/SettingsOverviewPage.tsx`
- `packages/renderer/src/pages/SettingsDetailPage.tsx`
- `packages/renderer/src/features/settings/AppearanceSettingsApplication.ts`
- `packages/renderer/src/features/settings/AppearanceSettingsProvider.tsx`
- `packages/renderer/src/features/settings/AppearanceSettingsRuntime.ts`
- `packages/renderer/src/styles/tokens.css`
- `packages/renderer/src/styles/global.css`
- `packages/renderer/src/env.d.ts`
- `packages/core-types/src/window-controls.ts`
- `src/main/bootstrap.ts`
- `src/main/index.ts`
- `src/main/window.ts`
- `src/main/window-controls.ts`
- `src/main/application-services.ts`
- `src/preload/index.ts`
