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

| 编号  | 测试名称                                                                           | 主要入口               | 主要覆盖层                                         |
| ----- | ---------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------- |
| EA-01 | `starts a hardened application window and exposes every preload bridge`            | Electron 启动          | main、BrowserWindow、preload、renderer sandbox     |
| EA-02 | `round-trips data through file, config, asset protocol, AI and clipboard IPC`      | renderer bridge        | preload、IPC handler、存储、自定义协议、系统剪贴板 |
| EA-03 | `navigates through every primary application area`                                 | `/` 主导航             | React Router、页面加载、应用 provider              |
| EA-04 | `exports a submission containing a large resource through the renderer ZIP worker` | `/exams`               | 试卷导入、播放器、ZIP Worker、大资源完整性         |
| EA-05 | `persists appearance settings through the renderer and config store`               | `/settings/appearance` | UI、配置 IPC、DOM 主题状态、页面重载恢复           |
| EA-06 | `creates, edits and reloads a persisted template`                                  | `/templates`           | 模板 UI、函数库、文件存储、版本更新、重载恢复      |
| EA-07 | `exports a persisted formal Schema through the native save dialog`                 | `/schemas`             | Schema 存储、详情 UI、系统保存对话框、文件内容     |
| EA-08 | `routes window controls through preload to the owning BrowserWindow`               | 自定义标题栏           | renderer、preload、窗口控制 IPC、应用退出          |

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
4. 在 renderer 中枚举 `airouter`、`appInfo`、`configStore`、`fileDialog`、`fileStore`、`imageClipboard` 和 `windowControls` 的方法，其中 AIRouter 必须包含语音识别模型枚举和请求入口。
5. 检查 renderer 全局环境中不存在 Node.js 的 `process` 和 `require`。

测试内容：

- 应用菜单已移除，主窗口标题为“曹二听说101”且窗口可见。
- `app.isPackaged === true`，测试目标确实是 electron-builder 目录产物。
- `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`。
- `app.getPath('userData')` 指向当前测试临时目录。
- 每个 preload bridge 暴露的方法集合与契约完全一致，包括 `listSpeechRecognitionModels` 和 `startSpeechRecognition`。
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
8. 读取 AI 文本 Provider、图片 Provider 和内置语音识别模型列表。
9. 调用窗口控制 bridge 获取当前最大化状态。
10. 从主进程使用 `net.fetch` 请求 `asset://local/integration/round-trip/sample.bin`。
11. 核对所有 renderer IPC 结果、自定义协议状态码和资源字节。
12. 在 `finally` 中恢复原剪贴板文本。

测试内容：

- File Store 的写、读、has、list 和原子 compare-and-swap 完整往返。
- Config Store 能保存并返回结构化 JSON。
- preload 对 File Store channel 执行白名单限制。
- `asset://` scheme 已注册，并能从 File Store 的 asset 目录读取正确字节。
- AI Router handler 可达；空文本 Provider 列表、默认“手动生成”图片 Provider，以及打包资源中的 `builtin-qwen3-asr/qwen3-asr-0.6b` 模型契约正确。
- Clipboard IPC 能修改真实 Electron 剪贴板，纯文本剪贴板不会返回图片。
- Window Controls handler 可达且初始窗口未最大化。

覆盖边界：

- 不保存 Provider API Key，不访问真实 AI 网络，也不在 smoke 中加载 Qwen3 模型执行识别。
- 剪贴板内容属于系统级副作用，但测试无论成功失败都会恢复原文本。

## EA-03 主应用区域导航

测试路径：

```text
/ 工作台 -> /interfaces 题型库 -> /exams 试卷库 -> /templates 试卷模板
           -> /schemas 评分单元 -> /settings -> /settings/about -> / 工作台
```

操作流程：

1. 依次进入题型库、试卷库、试卷模板和评分单元，等待各模块初始加载完成。
2. 在评分单元中核对七个内置 Schema，确认它们没有删除操作。
3. 进入设置和关于页，确认设置入口、应用名称和运行版本。
4. 返回工作台并收起侧栏，检查侧栏、导航按钮和文字的布局状态。
5. 每次切换后检查 CSS module 绑定没有产生无效 class。

测试内容：

- 主导航与辅助导航注册完整，主要业务 Provider 能完成初始异步加载。
- 内置评分单元完整可见且不可删除。
- 关于页能通过 `appInfo` preload bridge 读取运行版本。
- 收起侧栏后宽度、按钮对齐和文字隐藏状态正确。

覆盖边界：

- 本路径只验证入口、加载和只读初始状态，不修改业务数据或 AI 设置。

## EA-04 大资源作答包导出

测试路径：

```text
测试试卷 ZIP -> 系统打开对话框 -> 试卷库 -> 开始考试
             -> 填写考生信息 -> renderer ZIP Worker -> 作答包文件
```

操作流程：

1. 创建包含 200 KB 随机附件的测试试卷包，并将打开对话框指向该文件。
2. 从试卷库导入并启动考试，填写姓名和考生号。
3. 将保存对话框指向测试目录中的作答包路径并完成考试。
4. 解压导出的作答包，核对 manifest 考生信息和附件全部字节。

测试内容：

- 试卷导入、播放器完成和作答包导出形成完整 Electron 路径。
- renderer ZIP Worker 不会截断或改写大附件。
- 保存对话框返回的目标路径被正确写入。

覆盖边界：

- 系统对话框由测试注入确定路径，不覆盖操作系统原生对话框的人工交互和视觉表现。
- 附件用于验证二进制完整性，不作为评分输入。

## EA-05 外观设置持久化

测试路径：

```text
/settings -> /settings/appearance -> 选择深色 -> 等待保存
            -> 启用减少动态效果 -> 等待保存 -> reload -> 再次进入外观
```

操作流程：

1. 从设置首页进入“外观”。
2. 等待主题下拉框可用，选择 `dark`。
3. 轮询 Config Store，直到主题为 `dark` 且 `reduceMotion=false`。
4. 启用减少动态效果，检查 DOM 属性和完整配置。
5. 重载 renderer，再次进入外观页面并确认两个控件恢复保存值。

测试内容：

- 外观设置 UI、React Provider 和版本化 Config Store 文档同步。
- 两次连续配置保存按顺序完成，不发生覆盖竞态。
- DOM 主题属性与设置一致，renderer 重载后能恢复 UI 和 DOM 状态。

覆盖边界：

- 重载的是 renderer 页面，不是完整退出并重启 Electron 进程。
- 不依赖操作系统真实的深浅色偏好。

## EA-06 模板与本地函数库持久化

测试路径：

```text
/templates -> 新建模板 -> 编辑元数据 -> 新建并重命名本地函数库
           -> 新建并编辑函数 -> 删除函数库 -> 返回列表 -> reload
```

操作流程：

1. 新建模板，将默认名称和描述改为测试内容。
2. 核对内置函数库和可添加函数入口。
3. 新建并重命名本地函数库，在其中创建函数、修改函数名称并保存。
4. 返回模板编辑器，确认函数可添加，再删除本地函数库并确认 revision 更新。
5. 返回模板列表并重载 renderer，确认模板名称和描述仍然存在。

测试内容：

- Template Application、Template Repository 与 File Store 的真实协作。
- 本地函数库创建、重命名、函数保存、删除和 revision 更新。
- renderer 重载后模板文件仍可读取，证明数据不是只保存在 React 内存中。

覆盖边界：

- 不编辑模板页面节点、接口绑定或资源。
- 数据只需要跨 renderer reload，不跨独立 Electron 测试实例。

## EA-07 正式 Schema 导出

测试路径：

```text
File Store 写入正式 Schema -> /schemas -> Schema 详情 -> 导出
                             -> 系统保存对话框 -> JSON 文件
```

操作流程：

1. 通过 File Store 写入一个完整的正式 Schema 文档。
2. 将系统保存对话框指向测试目录中的导出路径。
3. 从评分单元列表打开目标 Schema 并执行导出。
4. 检查成功提示，并读取导出文件与原始 Schema 做完整比较。

测试内容：

- 正式 Schema 仓储、详情页面和 file-dialog IPC 正确接线。
- 导出内容保留结构、版本、评分标准和额外提示词，不发生字段丢失。

覆盖边界：

- 系统保存对话框使用测试路径，不验证原生对话框视觉和人工操作。
- 本路径不创建或发布 Schema 草稿。

## EA-08 自定义窗口关闭路径

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
