<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 文件类型与扩展名

CYEZ 英语听说使用自定义文件扩展名来区分不同类型的交换文件。所有自定义文件内部均为标准 ZIP 格式，可使用任意解压工具打开查看。

## 文件类型列表

| 扩展名 | 类型名称 | 所属模块 | 操作 | 内部结构 |
|--------|----------|----------|------|----------|
| `.cyexam` | CYEZ 考试包 | 考试管理 / 草稿导出 | 导入、导出 | `exam.json` + `media/` |
| `.cytmpl` | CYEZ 模板包 | 创建试卷 > 模板 | 导入、导出 | `template.json` + `media/` |
| `.cydraft` | CYEZ 草稿包 | 创建试卷 > 草稿 | 导入、导出 | `template.json` + `draftState.json` + `media/` + `uploads/` |
| `.cysubm` | CYEZ 作答包 | 作答列表 / 批改管理 | 导出、导入 | `{姓名_学号}/meta.json`、试卷数据、`*.mp3` 录音 |
| `.cygrade` | CYEZ 批改记录包 | 批改管理 | 保留扩展名（暂未使用） | — |
| `.csv` | CSV 表格 | 批改管理 | 导出 | UTF-8 BOM 逗号分隔值（标准格式） |
| `.zip` | ZIP 压缩包 | 批改管理 | 导出 PDF | 按考生分组的 PDF 文件（给人解压查阅） |

## 数据流转

```
模板 (.cytmpl)         草稿 (.cydraft)         考试 (.cyexam)
    │                      │                      │
    ├─ 导入 ───────────────┼─ 导入 ───────────────┼─ 导入
    │                      │                      │
    ├─ 基于模板创建草稿 ──→│                      │
    │                      │                      │
    │                      ├─ 导出渲染考试 ───────→│
    │                      │                      │
    └─ 导出 ───────────────└─ 导出 ───────────────└─ 导出
                                                     │
                                                     ▼
                                                  考试 (.cyexam)
                                                     │
                                                     ▼
                                              作答包 (.cysubm)
                                                     │
                                     ┌───────────────┤
                                     │               │
                                  导出              导入
                                     │               │
                                     ▼               ▼
                              作答列表           批改管理
                                                     │
                                                     ├─ 导出 CSV (.csv)
                                                     └─ 导出 PDF (.zip)
```

## 对话框滤镜

每个文件类型在导入/导出文件对话框中显示对应的过滤器：

| 导入/导出场景 | 对话框标题 | 滤镜标签 | 默认文件名示例 |
|-------------|-----------|---------|---------------|
| 导入考试 | 导入考试 | `CYEZ 考试包 (*.cyexam)` | — |
| 导出考试 | 导出考试 | `CYEZ 考试包 (*.cyexam)` | `期中考试.cyexam` |
| 导入模板 | 导入模板 | `CYEZ 模板包 (*.cytmpl)` | — |
| 导出模板 | 导出模板 | `CYEZ 模板包 (*.cytmpl)` | `模板_{id}.cytmpl` |
| 导入草稿 | 导入草稿 | `CYEZ 草稿包 (*.cydraft)` | — |
| 导出草稿 | 导出草稿包 | `CYEZ 草稿包 (*.cydraft)` | `草稿_{id}.cydraft` |
| 导出渲染考试 | 导出渲染后的试卷 | `CYEZ 考试包 (*.cyexam)` | `试卷.cyexam` |
| 导出作答 | 导出作答包 | `CYEZ 作答包 (*.cysubm)` | `作答_{姓名}_{id}.cysubm` |
| 批量导出作答 | 批量导出作答包 | `CYEZ 作答包 (*.cysubm)` | `作答_批_{日期}.cysubm` |
| 导入作答 | 导入作答包 | `CYEZ 作答包 (*.cysubm)` | — |
| 导出批改CSV | 导出批改表格 | `CSV 文件` | `批改记录_{日期}.csv` |
| 导出批改PDF | 导出批改PDF | `ZIP 文件` | `批改记录_PDF.zip` |

## 文件扩展名注册

### 安装时注册

构建安装包时，`electron-builder.yml` 中的 `fileAssociations` 配置会在安装程序中写入系统级文件关联：

- **Windows (NSIS)**：写入注册表 `HKCR` 路径
- **macOS**：写入 `Info.plist` 的 `CFBundleDocumentTypes`
- **Linux**：通过 `.desktop` 文件的 MIME 类型

### 启动时自注册

应用启动时，在 Windows 平台自动检查并补充缺失的注册表项（`HKCU\Software\Classes`），确保即使在便携模式或安装程序未正常写入的情况下也能建立文件关联。

实现位置：`src/main/utils/file-association.ts` → `registerFileAssociations()`

### 注册表结构（Windows）

```
HKCU\Software\Classes\.cyexam
    (默认) = "cyez.cyexam"

HKCU\Software\Classes\cyez.cyexam
    (默认) = "CYEZ 考试包"
    DefaultIcon\ (默认) = "{ico路径}" 或 "{exe路径},0"
    shell\open\command\ (默认) = "{exe路径}" "%1"
```

## 文件图标

### 图标文件位置

```
resources/file-icons/
├── cyexam.png   / cyexam.icns   / cyexam.ico
├── cytmpl.png   / cytmpl.icns   / cytmpl.ico
├── cydraft.png  / cydraft.icns  / cydraft.ico
├── cysubm.png   / cysubm.icns   / cysubm.ico
└── cygrade.png  / cygrade.icns  / cygrade.ico
```

`.ico` 和 `.icns` 文件已加入 `.gitignore`，`.png` 源文件保留在版本控制中。

- `.png` — 源文件，手动设计编辑
- `.ico` — Windows 图标，由 `pnpm install` 时自动从 `.png` 生成
- `.icns` — macOS 图标，目前为应用图标的占位副本

### 图标生成

`pnpm install` 的 `postinstall` 阶段会自动调用 `scripts/generate-icons.js`：

1. 读取 `resources/file-icons/*.png`
2. 生成对应 `.ico` 文件（纯 Node.js 实现，无额外依赖）
3. 每次 install 都会覆盖生成，方便修改源图标后直接生效

### 替换图标

1. 编辑/替换 `resources/file-icons/` 下对应类型的 `.png` 源文件
2. 运行 `pnpm install` 自动重新生成 `.ico`
3. macOS 图标需使用 `iconutil` 或其他工具单独生成 `.icns` 后替换

## 双击打开文件

当用户在文件管理器中双击 `.cyexam` / `.cytmpl` / `.cydraft` / `.cysubm` 文件时：

1. **macOS**：系统通过 `app.on('open-file')` 事件将文件路径传给应用
2. **Windows**：当应用已运行时通过 `app.on('second-instance')` 事件接收参数；首次启动时通过 `process.argv` 获取
3. 应用解析文件扩展名，弹出确认对话框（渲染进程 `window.confirm`）
4. 确认后自动导入到对应模块，并导航到目标页面

| 文件类型 | 导入目标模块 | 导航页面 |
|----------|-------------|---------|
| `.cyexam` | 考试管理 | `/` |
| `.cytmpl` | 创建试卷 > 模板 | `/create/templates` |
| `.cydraft` | 创建试卷 > 草稿 | `/create/drafts` |
| `.cysubm` | 批改管理 | `/grading` |
| `.cygrade` | 不支持直接导入 | — |

## 开发者选项

在开发者选项页面（`/dev-options`，需开启开发者模式）提供了文件扩展名管理功能：

- **移除文件扩展名注册**：清除当前用户 `HKCU\Software\Classes` 下所有 `cyez.*` 注册表项
- **重置文件扩展名缓存**：通过 UAC 提权执行 `ie4uinit.exe -show` 刷新图标缓存，并重启 `explorer.exe`

## 代码位置

| 组件 | 文件 |
|------|------|
| 文件类型常量定义 | `src/shared/file-types.ts` |
| 安装时注册配置 | `electron-builder.yml` → `fileAssociations` |
| 运行时注册/移除 | `src/main/utils/file-association.ts` |
| IPC 处理器 | `src/main/ipc/app.ts`（双击导入）、`src/main/ipc/dev.ts`（开发者选项） |
| 预加载桥接 | `src/preload/bridges/app.bridge.ts`、`dev.bridge.ts` |
| 渲染进程处理 | `src/renderer/src/hooks/useOpenFileHandler.ts` |
| 图标生成脚本 | `scripts/generate-icons.js` |
| 图标文件 | `build/icons/` |
