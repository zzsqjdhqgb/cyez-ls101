<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# Electron 应用测试路径

源文件：[`tests/integration/electron-app.spec.ts`](../../tests/integration/electron-app.spec.ts)

运行命令：

```bash
yarn test:playwright
```

命令先为当前平台执行 `electron-builder --dir`，测试直接启动 unpacked 可执行文件并断言 `app.isPackaged === true`。

所有路径都先执行[公共生命周期](./README.md#公共生命周期)，因此下面不重复描述应用启动、临时目录创建、关闭清理和 renderer 错误检查。

## 覆盖矩阵

| 编号  | 测试名称                                                                      | 主要入口               | 主要覆盖层                                         |
| ----- | ----------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| EA-01 | `starts a hardened application window and exposes every preload bridge`       | Electron 启动          | main、BrowserWindow、preload、renderer sandbox     |
| EA-02 | `round-trips data through file, config, asset protocol, AI and clipboard IPC` | renderer bridge        | preload、IPC handler、存储、自定义协议、系统剪贴板 |
| EA-03 | `navigates through every primary application area`                            | `/` 主导航             | React Router、页面加载、应用 provider              |
| EA-04 | `persists appearance settings through the renderer and config store`          | `/settings/appearance` | UI、配置 IPC、DOM 主题状态、页面重载恢复           |
| EA-05 | `creates, edits and reloads a persisted template`                             | `/templates`           | 模板 UI、文件存储、版本更新、页面重载恢复          |
| EA-06 | `routes window controls through preload to the owning BrowserWindow`          | 自定义标题栏           | renderer、preload、窗口控制 IPC、应用退出          |

## EA-01 应用安全启动与 preload 完整性

测试路径：

```text
启动 Electron -> 获取 BrowserWindow -> 检查 webPreferences
                -> 进入 renderer -> 枚举 preload bridge
```

操作流程：

1. 从主进程取得当前唯一的 BrowserWindow、应用信息和应用菜单。
2. 读取窗口最后使用的 `webPreferences`。
3. 核对应用名称、窗口标题、可见状态和测试用户数据目录。
4. 在 renderer 中枚举 `airouter`、`appInfo`、`configStore`、`fileDialog`、`fileStore`、`imageClipboard` 和 `windowControls` 的方法。
5. 检查 renderer 全局环境中不存在 Node.js 的 `process` 和 `require`。

测试内容：

- 应用菜单已移除，主窗口标题为“曹二听说101”且窗口可见。
- `app.isPackaged === true`，测试目标确实是 electron-builder 目录产物。
- `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。
- `app.getPath('userData')` 指向当前测试临时目录。
- 每个 preload bridge 暴露的方法集合与契约完全一致。
- renderer 无法直接访问 Node.js 运行时。

覆盖边界：

- `fileDialog` 和 AI 生成方法只验证暴露面，不在本路径触发系统对话框或网络请求。

## EA-02 IPC、存储、自定义协议与剪贴板往返

测试路径：

```text
renderer -> preload bridge -> ipcMain -> File/Config/AI handler
main -> asset:// protocol -> 文件内容
renderer -> clipboard IPC -> Electron clipboard
```

操作流程：

1. 从主进程读取并保存原剪贴板文本。
2. 通过 `fileStore.invoke` 在 `integration/round-trip` scope 写入 `state.json`。
3. 依次执行文本读取、存在性检查、文件列表和 compare-and-swap。
4. 写入字节为 `[10, 20, 30, 40]` 的 `sample.bin` 资源。
5. 通过 `configStore.invoke` 写入并读取 `integration/settings`。
6. 调用一个不在白名单中的 File Store channel，记录拒绝错误。
7. 通过 Clipboard bridge 写入测试文本并读取当前图片。
8. 读取 AI 文本 Provider 和图片 Provider 列表。
9. 调用窗口控制 bridge 获取当前最大化状态。
10. 从主进程使用 `net.fetch` 请求 `asset://local/integration/round-trip/sample.bin`。
11. 核对所有 renderer IPC 结果、自定义协议状态码和资源字节。
12. 在 `finally` 中恢复原剪贴板文本。

测试内容：

- File Store 的写、读、has、list 和原子 compare-and-swap 完整往返。
- Config Store 能保存并返回结构化 JSON。
- preload 对 File Store channel 执行白名单限制。
- `asset://` scheme 已注册，并能从 File Store 的 asset 目录读取正确字节。
- AI Router handler 可达；空文本 Provider 列表和默认“手动生成”图片 Provider 契约正确。
- Clipboard IPC 能修改真实 Electron 剪贴板，纯文本剪贴板不会返回图片。
- Window Controls handler 可达且初始窗口未最大化。

覆盖边界：

- 不保存 Provider API Key，不访问真实 AI 网络。
- 剪贴板内容属于系统级副作用，但测试无论成功失败都会恢复原文本。

## EA-03 主应用区域导航

测试路径：

```text
/ 工作台 -> /interfaces 题型 -> /templates 模板
           -> /settings 设置 -> /settings/about 关于 -> / 工作台
```

操作流程：

1. 从工作台点击主导航“题型”。
2. 确认题型一级标题可见，并等待题型加载提示消失。
3. 点击主导航“模板”。
4. 确认模板一级标题可见，并等待模板加载提示消失。
5. 点击辅助导航“设置”。
6. 确认设置一级标题以及“外观”“AI 引擎”“关于”入口可见。
7. 进入“关于”，确认应用名称和主进程返回的版本号可见。
8. 点击“工作台”，确认返回初始页面。

测试内容：

- 主导航与辅助导航注册完整。
- MemoryRouter 能在四个主要应用区域之间切换。
- 题型和模板 provider 能完成初始异步加载，不停留在 loading 状态。
- 设置注册表包含当前三个设置模块，“关于”页能通过 `appInfo` preload bridge 读取运行版本。

覆盖边界：

- 本路径只验证页面入口和加载完成，不修改题型、模板或 AI 设置。

## EA-04 外观设置持久化

测试路径：

```text
/settings -> /settings/appearance -> 选择深色 -> 等待保存
            -> 启用减少动态效果 -> 等待保存 -> reload -> 再次进入外观
```

操作流程：

1. 从设置首页进入“外观”。
2. 等待主题下拉框可用，选择 `dark`。
3. 轮询 Config Store，直到主题为 `dark` 且 `reduceMotion=false`。
4. 等待减少动态效果开关可用，通过其可见 label 点击开关。
5. 确认开关处于 checked 状态。
6. 检查 `<html>` 的 `data-theme="dark"` 和 `data-reduce-motion` 属性。
7. 再次轮询 Config Store，确认完整设置已保存。
8. 重载 renderer 页面并确认深色主题立即恢复。
9. 再次进入外观页面，确认下拉框和开关恢复保存值。

测试内容：

- 外观设置 UI 与 React provider 状态同步。
- 两次连续配置保存按顺序完成，不发生覆盖竞态。
- Config Store 中保存版本化设置文档。
- DOM 主题属性与设置一致。
- renderer 重载后能从持久化配置恢复 UI 和 DOM 状态。

覆盖边界：

- 重载的是 renderer 页面，不是完整退出并重启 Electron 进程。
- 不依赖操作系统真实的深浅色偏好。

## EA-05 模板创建、编辑与持久化

测试路径：

```text
/templates -> 新建模板 -> /templates/:templateId
           -> 编辑并保存 -> 返回列表 -> reload -> /templates
```

操作流程：

1. 进入模板页面并等待初始加载结束。
2. 点击“新建模板”，进入新模板编辑器。
3. 确认默认名称为“未命名模板”。
4. 将名称改为“集成测试模板”，填写测试描述。
5. 点击保存，确认 revision 从 `0` 更新为 `1`。
6. 返回模板列表，确认新名称可见。
7. 重载 renderer，再次进入模板页面。
8. 确认模板名称和描述仍然存在。

测试内容：

- Template Application、Template Repository 与 File Store 的真实协作。
- 新模板创建时生成有效 ID 和初始文档。
- 编辑保存会更新 revision。
- 列表查询能读取刚保存的模板摘要。
- renderer 重载后模板文件仍可读取，证明数据不是只保存在 React 内存中。

覆盖边界：

- 当前只覆盖模板元数据，不编辑模板节点、函数、接口绑定或资源。
- 数据只需要跨 renderer reload，不跨独立 Electron 测试实例。

## EA-06 自定义窗口关闭路径

测试路径：

```text
自定义标题栏 -> 关闭按钮 -> preload windowControls.close
             -> ipcMain -> 所属 BrowserWindow.close -> ElectronApplication close
```

操作流程：

1. 确认最小化、最大化和关闭三个标题栏按钮均可用。
2. 同时监听 ElectronApplication 的 `close` 事件并点击关闭按钮。
3. 等待应用关闭事件，证明调用已穿过 renderer、preload 和主进程。

测试内容：

- 无原生 frame 时自定义窗口控制按钮仍然可操作。
- `windowControls.close` 调用作用于发送事件的 BrowserWindow。
- 用户关闭路径能结束当前 Electron 应用实例。

覆盖边界：

- 本路径不实际点击最小化和最大化，避免依赖 CI 是否运行窗口管理器。
- 最小化、最大化方法的 preload 暴露及 `getMaximized` handler 已分别在 EA-01、EA-02 验证。
