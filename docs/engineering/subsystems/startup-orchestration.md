<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: startup
-->

# 启动编排

## 架构

启动分为 main 进程与 renderer 两段，二者由一条 IPC 就绪信号串起来：

| 层            | 入口                                                                 | 职责                                                                                                        |
| ------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| main 引导     | `src/main/bootstrap.ts`                                              | 安装 source map、注册协议/窗口控制、单实例锁、创建主窗口、触发应用初始化、记录 main 里程碑                  |
| main 初始化   | `src/main/index.ts`                                                  | 并行启动日志与数据目录，等在窗口显示后导入并注册全部 IPC 服务，resolve 启动结果                             |
| main 服务注册 | `src/main/application-services.ts`                                   | 文件存储、内建存储、配置存储、AIRouter、剪贴板、文件对话框、许可、数据目录、旧数据、renderer 日志、app-info |
| 窗口          | `src/main/window.ts`                                                 | 创建隐藏窗口，`dom-ready` 后显示并上报生命周期事件                                                          |
| 就绪信号      | `STARTUP_CHANNELS.whenReady`（`packages/core-types/src/startup.ts`） | renderer 只能通过它观察 main 初始化结果                                                                     |
| renderer 引导 | `packages/renderer/src/index.tsx`                                    | 绘制启动占位、两帧后再动态加载应用 bundle                                                                   |
| renderer 编排 | `packages/renderer/src/startup-application.tsx`                      | 等待 main 就绪、许可门禁、旧数据门禁、加载活动应用                                                          |
| renderer 内容 | `packages/renderer/src/startup-active-application.tsx`               | 安装标记、内建内容维护、发布说明认领、渲染主界面                                                            |

窗口生命周期与应用外壳的其它细节见 [`../features/application-shell.md`](../features/application-shell.md)；数据目录的初始化与恢复见 [`../features/data-directory.md`](../features/data-directory.md)。本文只描述**顺序、门禁与失败面**。

## 运行时与生命周期

main 进程顺序（括号内是 `MainStartupMilestone`）：

1. 模块求值期同步执行：安装 source map（`installSourceMapSupport()`）、注册 `asset` 与 `builtin` 协议 scheme、注册窗口控制 handler、注册 `startup:when-ready` handler（`bootstrap-loaded`）。
2. 申请单实例锁。未获得则 `app.quit()`；获得后注册 `second-instance`，并 `app.whenReady().then(startApplication)`（`electron-ready`）。
3. `startApplication()`：设置 AppUserModelId、建立 `startupResult` promise 与 `windowShown` promise、注册两个存储协议（baseDir 为惰性回调，内部 await `startupResult`）（`asset-protocols-registered`）。
4. 同步创建主窗口（`window-created`），随后调用 `initializeApplication(windowShown)`（`application-initialization-started`）。
5. `initializeApplication()` 在测试延迟后动态 `import('./index')`（`application-module-imported`），再调用 `index.initializeApplication()`。
6. `index.initializeApplication()` 并发启动三条任务：创建日志器、初始化数据目录、在 `windowShown` resolve 后动态 `import('./application-services')`。
7. 数据目录任务被 await；失败时进入 `recoverDataDirectory()` 弹窗循环，该函数不返回：重试或选择已有目录成功后 `app.relaunch()` + `app.exit(0)`，选择退出则 `app.exit(1)`。
8. 服务导入任务被 await（因此注册被推迟到窗口显示之后）；`registerApplicationServices()` 同步注册全部 IPC handler。
9. 返回 `{ logger, dataDirectory, builtinDataDirectory }`，`startupResult` resolve（`application-initialized`），`startup:when-ready` 的 handler 才能 resolve。

关键时序约束：

- **协议注册先于窗口创建**：`registerFileStoreProtocol` / `registerBuiltinFileStoreProtocol` 在 `createMainWindow()` 之前调用（`tests/main/startup.test.ts` 断言调用顺序）。
- **窗口先于数据目录初始化**：`createMainWindow()` 在 `initializeDataDirectory()` 之前。窗口先显示启动占位，重型初始化随后进行。
- **服务注册在窗口显示之后**：`application-services` 的 import 链在 `windowShown` resolve 后才执行；`shown` 由 `window.ts` 在 `webContents` 的 `dom-ready` + `setImmediate` 中触发（不是 `ready-to-show`，该事件只上报里程碑）。日志器与数据目录初始化**不**等窗口显示，与窗口显示并行。
- **`startup.whenReady()` 是唯一同步点**：handler 在 `startupResult` 尚未建立时抛 `应用启动尚未开始`；结果为失败时抛出其中的 message。renderer 在调用任何业务 bridge 前必须先 await 它。

窗口显示语义：`show: false` 创建，`dom-ready` 触发 `renderer-dom-ready`，随后 `setImmediate` 中若窗口仍存在且不可见则 `window.show()` 并上报 `shown`；显示前被关闭或主框架加载失败分别上报 `destroyed-before-shown` / `load-failed-before-shown`，并 reject `windowShown`。

renderer 顺序（括号内是 `StartupPhase` 或里程碑）：

1. `index.tsx` 记录 `document-script-started`，解析 `#root`，注入 logo 动画（`startup-logo-ready`），开始监听动画结束；两帧 `requestAnimationFrame` 后再请求应用 bundle（`application-bundle-requested`），动态 import `startup-application`（`application-bundle-loaded`）。
2. `startApplication()` 建立 React root 与错误处理（`react-root-created`）。
3. `renderApplication()` 取 `Promise.all([prepareApplication(), logo 动画结束 + 1000 ms])`，因此主界面出现前至少有 1.5 s 动画 + 1.0 s 稳定期。
4. `prepareApplication()`：等待 main 就绪（`main-process-readiness`）→ 打开 renderer 里程碑日志（`main-process-ready`）→ 许可状态（`license-status`）→ 旧数据状态（`legacy-data-status`）。
5. 许可非 `active` 时渲染 `LicenseActivationPage` 并停止主界面流程；旧数据状态不是 `none` / `cleaned` 时先渲染 `LegacyDataMigrationPage`，完成后重回第 6 步。
6. 动态加载 `startup-active-application` 并执行 `initializeActiveApplication()`：`installation-marker` → `builtin-schemas` → `builtin-interfaces` → `builtin-templates-and-functions` → `release-notes`。
7. `renderActiveApplication()` 渲染 `StartupApplicationView`（`main-interface-render-requested`）→ `App`；首帧后再记 `main-interface-first-frame`。

许可校验与内建内容维护都在 **renderer** 的启动阶段执行，main 只提供对应 IPC；`builtin-*` 阶段需要 main 已注册文件/配置存储与内建存储，因此它们排在 `main-process-readiness` 之后。每个 `runStartupPhase` 在开始前 `setTimeout(0)` 让出事件循环，确保占位界面能完成一次绘制，并记录 started / completed / failed 三个阶段日志（含 `durationMs`）。

## 存储与格式

启动流程不持久化自身状态；它产生的是**日志事件、性能标记和启动占位 DOM**：

- main 里程碑：`logger.info('Main startup milestone', { milestone, elapsedMs })`。日志器就绪前的里程碑缓存在内存，`flushMainStartupMilestones()` 在拿到日志器后补写。
- renderer 里程碑：`performance.mark('ls101-startup:<milestone>')` + `logger.info('Renderer startup milestone', { milestone, elapsedMs })`；日志开关由 main 就绪后调用的 `enableRendererStartupTimingLogging()` 控制，之前产生的条目缓存补写。
- renderer 阶段：`logger.info('Renderer startup phase started' | '... completed', { phase, durationMs })`，失败走 `logger.error('Renderer startup phase failed', error, { phase, durationMs })`。
- 启动占位契约在 `packages/renderer/index.html`：`<main class="startupPlaceholder" aria-label="曹二听说101 正在启动">` 内含 `role="progressbar" aria-label="正在加载"` 的进度条；进度条由 CSS 在 `2500ms` 延迟后淡入并循环动画。进度条**不**读取减少动效偏好，因为该偏好在配置存储就绪后才可用。

### 启动占位的设计约束

这些约束来自一次真实的启动卡死：初始化在主线程上的同步工作阻塞了占位的显示与重绘，Windows CI 上出现过 20 秒静止 logo。

- logo 动画保持 1.5 秒；只有在占位仍然存在时，进度条才在 1 秒后开始淡入。
- 初始化成功时同样等待这 1 秒稳定期再替换占位，主界面不会打断动画时序。
- 淡入由初始文档 CSS 驱动，应用 bundle 的加载或执行无法取消它；进度条使用 transform 动画以便合成器执行。
- renderer 初始化拆成主动让出事件循环的阶段，每阶段记录 started / completed / failed 与 `durationMs`，不记录用户数据。
- 覆盖：`tests/integration/startup-progress.spec.ts`（配合 `LS101_INTEGRATION_STARTUP_DELAY_MS` 验证延迟启动）与 `tests/main/startup.test.ts`（阶段时序、让出、失败传播与 logo 动效）。

## 失败与恢复

| 失败点                             | 表现                                              | 恢复路径                                                                                                               |
| ---------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 数据目录初始化失败                 | main 在数据目录对话框循环中                       | `重试` / `选择已有数据目录` / `退出`；重试成功则 `app.relaunch()` + `app.exit(0)`                                      |
| 主窗口显示前被关闭或加载失败       | `windowShown` reject，服务注册短路                | `dialog.showErrorBox('应用启动失败', message)` + `app.exit(1)`；若 renderer 仍在运行，`whenReady()` 收到 reject        |
| 服务注册（含 IPC 注册）抛错        | `initializeApplication()` reject                  | 同上：错误框 + `app.exit(1)`，`startupResult` 为 `{ ok: false }`                                                       |
| renderer 任一启动阶段失败          | 阶段日志记录失败后向上抛                          | `renderStartupError()` 渲染 `role="alert"` 的“应用初始化失败” + message + “重新加载”按钮（`window.location.reload()`） |
| 应用 bundle 动态 import 失败       | `index.tsx` 的 `.catch`                           | `renderBootstrapError()` 直接写 DOM 的“应用初始化失败” + “重新加载”                                                    |
| 许可为 `not-activated` / `expired` | 不是失败：`prepareApplication()` 提前返回许可类型 | 渲染 `LicenseActivationPage`；激活成功后继续旧数据门禁与内容初始化                                                     |
| 存在待整理旧数据                   | 不是失败：返回 `migration` 类型                   | 渲染 `LegacyDataMigrationPage`，完成回调继续加载活动应用                                                               |

测试专用开关：

- `LS101_INTEGRATION_TEST=1`：与应用未打包或版本号含 `-local.` 共同构成 `isLocalIntegrationTest`；它启用许可测试覆盖（`LS101_LICENSE_TEST_CODE_HASH`、`LS101_LICENSE_TEST_NOW`，见 [`../features/license.md`](../features/license.md)），并在 Linux 下调用 `safeStorage.setUsePlainTextEncryption(true)`，使 `@ls101/secret-store` 在无系统密钥环的容器内可读写。
- `LS101_INTEGRATION_STARTUP_DELAY_MS`：只在 `LS101_INTEGRATION_TEST === '1'` 时读取，在导入 `./index` 前延迟应用初始化，取值被限制在 0–30 000 ms；用于 `tests/integration/startup-progress.spec.ts` 验证启动占位。
- `LS101_DISABLE_AUTO_RELAUNCH=1`：无测试门禁，`src/main/license.ts` 与 `src/main/data-directory.ts` 直接读取，用于关闭各自的 `app.relaunch()`。

## 运维入口

- 启动慢或卡住：先看主进程日志中的 `Main startup milestone`（哪个里程碑之间时间差大），再看 `Renderer startup phase completed` 的 `durationMs`；renderer 还可用 DevTools 读取 `ls101-startup:*` performance mark。
- 判断“是否已经可以调用业务 IPC”：等待 `window.startup.whenReady()` resolve；它在 main 服务注册完成前不会 resolve。
- 复现启动占位与最短时长：`tests/integration/startup-progress.spec.ts`（配合 `LS101_INTEGRATION_STARTUP_DELAY_MS`）。启动错误与加载失败路径的单元覆盖在 `tests/main/startup.test.ts`。运行命令与分层见 [`../../testing.md`](../../testing.md)。
- 日志落盘位置与格式由 `@ls101/logger` 决定，见 [`../features/logger.md`](../features/logger.md)；尚未接线的日志项见 [`../todo/logger.md`](../todo/logger.md)。本文不重复。

## 代码依据

- `src/main/bootstrap.ts`（单实例锁、协议注册、窗口创建、里程碑、启动失败处理）
- `src/main/index.ts`（日志/数据目录/服务三条任务与 `isLocalIntegrationTest`）
- `src/main/application-services.ts`（全部 IPC 服务注册）
- `src/main/window.ts`（`MainWindowLifecycleEvent` 与显示时机）
- `src/main/source-map-support.ts`、`src/main/application-worker-urls.ts`（引导期基础设施）
- `src/preload/index.ts`（`startupBridge`）
- `packages/core-types/src/startup.ts`（`STARTUP_CHANNELS`）
- `packages/renderer/index.html`（启动占位 DOM 与进度条动画）
- `packages/renderer/src/index.tsx`、`startup-application.tsx`、`startup-active-application.tsx`、`startup-phase.ts`、`startup-placeholder.ts`、`startup-timing.ts`
- `tests/main/startup.test.ts`、`tests/integration/startup-progress.spec.ts`、`tests/integration/license.spec.ts`、`tests/integration/support/electron-app.ts`
