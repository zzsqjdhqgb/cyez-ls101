<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 贡献指南

> **注意：** 本文件仅为未来可能开源而预留。目前本项目为私有软件，**不接受**第三方代码贡献。

## 环境要求

- Node.js >= 18
- pnpm

## 开发环境搭建

```bash
git clone <repo-url>
cd cyez-listening-and-speaking
pnpm install
```

## 启动开发

```bash
pnpm dev
```

启动后 Electron 窗口会自动打开，支持热重载。

### 调试

- **主进程调试**：使用 VSCode 的 "Debug Main Process" 配置（`.vscode/launch.json`）
- **渲染进程调试**：使用 VSCode 的 "Debug Renderer" 配置，在 Chrome 中 attach 到端口 9222
- **关于页面**可切换开发者模式，开启后可在任意页面按 F12 打开 DevTools

## 项目结构

参见 [architecture.md](docs/architecture.md) 中的详细说明。

简化结构：

```
src/
├── main/          # Electron 主进程
│   ├── index.ts   # 入口
│   ├── ipc/       # IPC 处理器
│   ├── tts/       # TTS 引擎
│   └── utils.ts   # 工具函数
├── preload/       # 预加载脚本
│   └── index.ts
├── renderer/      # React 渲染进程
│   └── src/
│       ├── App.tsx
│       ├── types.ts
│       ├── pages/
│       └── components/
└── shared/        # 共享代码
    └── validation.ts
```

## 代码规范

### TypeScript

- 严格模式开启
- 所有新代码必须有类型标注
- 避免使用 `any`，优先使用 `unknown` 和类型守卫

### 代码风格

项目使用 ESLint + Prettier 统一风格：

```bash
# 检查
pnpm lint

# 自动修复
pnpm lint:fix

# 格式化
pnpm format

# 类型检查
pnpm typecheck
```

风格要点：
- 单引号
- 无分号
- 100 字符行宽
- 无尾逗号
- 2 空格缩进

### 提交前检查

建议在提交前运行：

```bash
pnpm typecheck && pnpm lint
```

## 架构原则

### 1. 进程隔离

- **主进程**负责文件系统操作、IPC 处理、TTS 引擎、窗口管理
- **渲染进程**负责 UI 展示，通过 `window.electronAPI`（由 preload 暴露）调用主进程功能
- **禁止**在渲染进程中直接使用 Node.js API（`nodeIntegration: false`）

### 2. IPC 通信模式

- 使用 `ipcMain.handle()` / `ipcRenderer.invoke()` 请求-响应模式
- 长时间运行的操作通过 `webContents.send()` 推送进度
- 所有 IPC 通道名使用 `domain:action` 命名（如 `exam:list`、`draft:exportExam`）

### 3. 数据存储

- 所有持久化数据存储在 `app.getPath('userData')` 下
- 考试和批改记录使用 SHA-256 哈希作为标识符实现去重
- 草稿、模板等使用 UUID v4 作为标识符

### 4. 资源加载

- 不启动本地 HTTP 服务器
- 使用自定义 Electron 协议加载本地资源
- 协议处理器必须验证路径不超出基准目录

## 添加新功能

### 添加新的 IPC 通道

1. 在 `src/main/ipc/` 下添加处理器（或在已有文件中扩展）
2. 在 `src/preload/index.ts` 中通过 `contextBridge` 暴露 API
3. 在 `src/renderer/src/types.ts` 中定义类型（如需）
4. 在 `src/main/index.ts` 中注册处理器

### 添加新页面

1. 在 `src/renderer/src/pages/` 下创建页面组件
2. 在 `src/renderer/src/App.tsx` 中添加路由
3. 如需侧边栏入口，在 `src/renderer/src/components/Layout.tsx` 中添加导航按钮

## 许可证

Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.

本软件为私有且机密，目前不接受第三方贡献。本贡献指南仅为未来可能开源时参考预留。
