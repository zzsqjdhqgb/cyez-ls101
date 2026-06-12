<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 曹二听说101

基于 Electron + React + TypeScript 的英语听说考试系统，支持多媒体播放、录音、草稿编辑、模板管理、批改评分等功能。

## 核心功能

- **多媒体试卷播放**：支持文本、图片、音频、视频、四宫格图片等多种内容类型
- **三种时间控制模式**：倒计时准备、自动录音、媒体播放控制
- **试卷模板与草稿系统**：基于模板创建草稿，填写文本/上传文件，一键导出完整考试包
- **离线语音合成（TTS）**：内置 Pocket TTS 引擎（WASM），无需网络，7 种英语音色
- **录音功能**：考试过程中自动录音，录音前后有提示音
- **批改系统**：导入作答包 → 分项评分 → 结算 → 导出 CSV/PDF 批改报告
- **自适应缩放**：固定 3:2 比例（1200×800 设计尺寸），在任何窗口大小下等比缩放
- **试卷格式校验**：内置结构合法性检查及资源文件存在性验证
- **开发者模式**：题目序号显示、跳过按钮、F12 DevTools、数据重置等功能

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React + TypeScript | 19 |
| 桌面框架 | Electron | 39 |
| 构建工具 | electron-vite + Vite | 5.0 / 7.2 |
| 代码规范 | ESLint 9 + Prettier 3 | |
| 打包分发 | electron-builder | 26 |
| TTS 引擎 | Pocket TTS (WASM) | 本地离线 |

## 环境要求

- Node.js >= 18
- pnpm

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

此命令会自动执行以下初始化任务：
- 下载 TTS 模型文件
- 下载开发者头像
- 从 `resources/file-icons/*.png` 生成对应 `.ico` 文件

### 2. 下载 TTS 模型文件（可选，但不下载则 TTS 功能不可用）

```bash
node scripts/download-tts-assets.js
```

### 3. 启动开发服务器

```bash
pnpm dev
```

### 4. 预览构建产物

```bash
pnpm start
```

## 项目结构

```
├── assets/                     # TTS 模型文件（需通过脚本下载）
│   ├── tts_b6369a24.safetensors
│   ├── tokenizer.model
│   └── embeddings_v2/          # 7 种音色嵌入向量
├── build/
│   ├── icon.png                # 应用图标
│   └── icon.icns               # macOS 应用图标
├── exams/                      # 预置考试包（首次启动复制到 userData）
├── templates/                  # 预置模板（首次启动复制到 userData）
├── resources/
│   ├── icon.png                # 备用应用图标
│   ├── file-icons/             # 文件类型图标（.png 源文件在 git，.ico/.icns 生成后 gitignore）
│   ├── media/                  # 内置媒体资源（提示音、头像）
│   └── tts/                    # TTS WASM 运行时
├── scripts/                    # 辅助脚本
│   ├── download-tts-assets.js  # 下载 TTS 模型文件
│   ├── setup.js               # 统一下载模型 & 生成图标入口
│   ├── generate-icons.js       # 从 PNG 生成 ICO 文件图标
│   ├── generate_exam.py        # （旧版）MiniMax API 生成试卷
│   └── insert_ready_and_stop.py # （旧版）插入录音提示音
├── src/
│   ├── main/                   # Electron 主进程
│   │   ├── index.ts            # 入口，初始化、协议注册、文件关联
│   │   ├── win.ts              # 窗口管理
│   │   ├── utils.ts            # 文件系统工具函数
│   │   ├── utils/
│   │   │   └── file-association.ts  # 文件扩展名注册/移除
│   │   ├── ipc/                # IPC 处理器
│   │   │   ├── app.ts          # 应用级 IPC（双击打开文件导入）
│   │   │   ├── exam.ts         # 考试管理
│   │   │   ├── submission.ts   # 作答管理
│   │   │   ├── template.ts     # 模板管理
│   │   │   ├── draft/          # 草稿管理（管理/导出/传输）
│   │   │   ├── grading.ts      # 批改管理
│   │   │   └── dev.ts          # 开发者工具
│   │   └── tts/
│   │       └── tts.ts          # Pocket TTS 引擎封装
│   ├── preload/                # 预加载脚本
│   │   └── index.ts            # contextBridge 暴露 API
│   ├── renderer/               # 渲染进程（React）
│   │   └── src/
│   │       ├── App.tsx          # 路由入口
│   │       ├── types.ts         # 类型定义
│   │       ├── hooks/           # 自定义 Hooks
│   │       │   └── useOpenFileHandler.ts  # 双击打开文件处理
│   │       ├── pages/           # 页面组件
│   │       └── components/      # UI 组件
│   └── shared/
│       ├── file-types.ts       # 文件类型常量与工具函数
│       └── validation.ts       # 试卷格式校验
├── docs/                       # 文档
│   ├── file-types.md           # 文件类型与扩展名规范
│   ├── architecture.md         # 系统架构
│   ├── exam-format.md          # 试卷格式规范
│   ├── template-format.md      # 模板格式规范
│   ├── grading-system.md       # 批改系统
│   ├── data-storage.md         # 数据存储结构
│   ├── tts-engine.md           # TTS 引擎
│   ├── user-guide.md           # 用户使用手册
│   ├── troubleshooting.md      # 常见问题排查
│   └── testing-checklist.md    # 测试清单
├── electron-builder.yml        # 打包配置
├── package.json
└── tsconfig.json
```

## 文件类型与扩展名

本应用使用自定义文件扩展名标识不同类型的交换文件。所有自定义文件内部均为标准 ZIP 格式，数据读取与写入由 `adm-zip` 处理。

| 扩展名 | 用途 | 模块 |
|--------|------|------|
| `.cyexam` | 考试包 | 考试管理 |
| `.cytmpl` | 模板包 | 创建试卷 > 模板 |
| `.cydraft` | 草稿包 | 创建试卷 > 草稿 |
| `.cysubm` | 作答包 | 作答列表 / 批改管理 |

文件扩展名在安装时由 `electron-builder` 写入系统关联，启动时由 `src/main/utils/file-association.ts` 补充注册。文件图标在 `pnpm install` 时由 `scripts/generate-icons.js` 自动生成（PNG → ICO）。

详见：[文件类型与扩展名文档 (docs/file-types.md)](docs/file-types.md)

## 试卷格式

试卷使用 JSON 格式定义，包含以下核心结构：

```json
{
  "title": "考试标题",
  "questions": [
    {
      "id": "1",
      "content": [ /* 内容节点数组 */ ],
      "time": { /* 时间控制 */ },
      "statusText": "可选的状态栏文本"
    }
  ],
  "gradingInfo": [ /* 可选：批改评分项 */ ]
}
```

支持五种内容节点：`text`、`image`、`video`、`audio`、`quad-image`。
三种时间控制模式：`countdown`（倒计时）、`record`（录音）、`content-controlled`（内容控制）。

详细的格式规范请参阅：[试卷格式规范 (exam-format.md)](docs/exam-format.md)

## 试卷模板

模板通过占位符（`{{id}}`）定义可定制的试卷。用户基于模板创建草稿，填写文本、上传文件后导出标准考试包。模板中的 `audio` 节点在导出时自动通过内置 TTS 引擎合成音频。

详见：[模板格式规范 (docs/template-format.md)](docs/template-format.md)

## 时间控制模式说明

### 倒计时（countdown）
- 显示倒计时秒数，归零后自动进入下一题
- 适用于准备阶段、审题阶段

### 录音（record）
- 显示录音进度条及剩余秒数
- 播放"准备录音"提示音 → 开始录音 → 超时自动停止 → 播放"停止录音"提示音
- 录音文件按 `recordIndex` 保存为 MP3

### 内容控制（content-controlled）
- 由音频/视频播放结束自动触发下一题
- **必须且只能**包含一个视频或音频节点
- 可同时包含文本、图片等辅助内容

## 批改系统

支持完整的批改工作流：
1. **导入作答包**：教师导入学生提交的作答 ZIP，自动去重
2. **分项评分**：按评分项逐一打分并撰写评语，通过分屏界面播放录音
3. **结算**：全部打分完成后创建批次，计算总分
4. **导出**：批次可导出为 CSV 表格或 PDF 报告

详见：[批改系统文档 (docs/grading-system.md)](docs/grading-system.md)

## 自定义资源协议

应用使用自定义 Electron 协议加载本地资源，无需启动本地 HTTP 服务器：

| 协议 | 用途 |
|------|------|
| `exam-resource://{eid}/` | 加载考试媒体资源 |
| `grading-resource://{rid}/` | 加载批改相关资源（录音、试卷） |
| `app-resource://` | 加载内置应用资源（提示音、头像） |

所有协议均支持流式传输，绕过 CSP，并内置路径遍历防护。

## 自适应缩放

应用固定采用 **3:2** 设计比例（1200×800 像素），通过 CSS `transform: scale()` 实现内容缩放：
- 在任意分辨率和窗口大小下保持内容比例不变
- 多余空间用黑色背景填充
- 所有文字、图片、按钮等元素自动等比缩放

## TTS 引擎

内置 Pocket TTS 语音合成引擎（WebAssembly），离线运行，支持 7 种英语音色（默认使用 alba）。合成参数：24000 Hz 采样率、PCM 16-bit、单声道 WAV 输出。

详见：[TTS 引擎文档 (docs/tts-engine.md)](docs/tts-engine.md)

## 可用脚本

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动开发服务器（热重载） |
| `pnpm start` | 预览构建产物 |
| `pnpm build` | 构建生产版本 |
| `pnpm build:win` | 构建 Windows 安装包 |
| `pnpm build:mac` | 构建 macOS 安装包 |
| `pnpm build:linux` | 构建 Linux 安装包 |
| `pnpm lint` | 运行 ESLint 检查 |
| `pnpm lint:fix` | 自动修复 ESLint 问题 |
| `pnpm format` | 使用 Prettier 格式化代码 |
| `pnpm typecheck` | TypeScript 类型检查 |

## 构建与分发

| 平台 | 命令 | 产物格式 |
|------|------|----------|
| Windows | `pnpm build:win` | NSIS 安装包 |
| macOS | `pnpm build:mac` | DMG |
| Linux | `pnpm build:linux` | AppImage / Snap / deb |

构建输出位于 `dist/` 目录。

## 文档索引

| 文档 | 说明 |
|------|------|
| [file-types.md](docs/file-types.md) | 文件类型与扩展名规范 |
| [architecture.md](docs/architecture.md) | 系统架构概览 |
| [exam-format.md](docs/exam-format.md) | 试卷格式规范 |
| [template-format.md](docs/template-format.md) | 模板格式规范 |
| [grading-system.md](docs/grading-system.md) | 批改系统 |
| [data-storage.md](docs/data-storage.md) | 数据存储结构 |
| [tts-engine.md](docs/tts-engine.md) | TTS 引擎 |
| [user-guide.md](docs/user-guide.md) | 用户使用手册 |
| [troubleshooting.md](docs/troubleshooting.md) | 常见问题排查 |

## 许可证

Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.

本软件为私有且机密。未经著作权人明确授权，严禁以任何媒介复制、修改或分发本软件。

## 第三方组件

- **Pocket TTS**（MIT）：语音合成模型及 ONNX WASM 导出
- **adm-zip**（MIT）：ZIP 压缩/解压
- **marked**（MIT）：Markdown 转 HTML
- **react-markdown + remark-gfm**（MIT）：React Markdown 渲染
