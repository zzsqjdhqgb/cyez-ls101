<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 系统架构

## 概述

曹二听说101是一个基于 Electron 的桌面应用，采用标准的三进程架构：**主进程（Main Process）**、**预加载脚本（Preload Script）**和**渲染进程（Renderer Process）**。启用上下文隔离（`contextIsolation: true`），禁用 Node 集成（`nodeIntegration: false`），所有进程间通信通过 IPC 通道完成。

## 进程架构

```
┌──────────────────────────────────────────────────────┐
│                   Main Process                        │
│  - 窗口管理 (win.ts)                                   │
│  - IPC 处理器 (ipc/ 目录)                              │
│  - 业务服务层 (services/)                              │
│    · exam-service     考试管理                         │
│    · submission-service  作答管理                       │
│    · template-service  模板管理                        │
│    · draft-service    草稿管理                         │
│    · grading-service/ 批改系统（含session, settlement,  │
│                       import, export子模块）            │
│  - TTS 引擎 (tts/)                                    │
│    · tts.ts          单例 + Worker线程调度             │
│    · tts-worker.ts   WASM合成工作线程                  │
│    · tokenizer.ts    SentencePiece Unigram分词器       │
│    · wav-encoder.ts  PCM 16-bit WAV编码器              │
│  - 自定义协议 (protocols/)                             │
│    · factory.ts      协议工厂（路径遍历防护）            │
│    · exam-resource / grading-resource / app-resource /  │
│      draft-resource                                   │
│  - 工具函数 (utils.ts)                                 │
│    · 路径安全、哈希计算、媒体路径前缀、资源验证           │
└─────────────┬────────────────────────────────────────┘
              │  contextBridge
              │  (preload/index.ts)
┌─────────────▼────────────────────────────────────────┐
│                  Renderer Process                     │
│  - React 19 + TypeScript                             │
│  - react-router-dom (MemoryRouter)                    │
│  - 组件 (components/)                                 │
│    · Layout, Modal (Message/Confirm/Progress/Result),  │
│      DisplayArea, MarkdownRenderer, StatusBar,         │
│      TitleBar, ExportProgressModal                     │
│  - 页面 (pages/)                                      │
│    · HomePage, ExamPage, RecordingsPage                │
│    · CreateExamPage (模板/草稿标签)                    │
│    · DraftEditPage, draft/ 子页面                      │
│    · GradingPage (批改列表/批次), GradingSessionPage,   │
│      GradingSettlementPage                             │
│    · AboutPage, DeveloperOptionsPage                   │
│  - 通过 window.electronAPI 调用主进程功能               │
└──────────────────────────────────────────────────────┘
```

## 模块详解

### 共享类型 (`src/shared/types/`)

| 文件 | 导出类型 | 说明 |
|------|----------|------|
| `exam.ts` | `ContentNode`, `TimeControl`, `Question`, `GradingInfoItem`, `ExamPackage`, `ExamListItem` | 考试领域核心类型 |
| `submission.ts` | `StudentInfo`, `SubmissionMeta`, `SubmissionItem` | 作答领域类型 |
| `template.ts` | `EditableDataItem`, `ExamTemplate`, `TemplateListItem` | 模板领域类型 |
| `draft.ts` | `DraftListItem`, `DraftView` | 草稿领域类型 |
| `grading.ts` | `GradingScoreEntry`, `GradingStatus`, `GradingRecord`, `GradingBatch`, `GradingListItem`, `SettlementRecord` | 批改领域类型 |

`ContentNode` 为联合类型，支持 5 种节点：`text`, `image`, `video`, `audio`, `quad-image`。
`TimeControl` 为联合类型，支持 3 种时间控制：`countdown`, `record`, `content-controlled`。

### 共享验证 (`src/shared/validation.ts`)

纯函数 `validateExamPackage(pkg: unknown): ValidationError[]`，与 Electron / React 无关。逐题验证：
- `questions` 必须是数组
- 每个题目必须有 `id`（字符串）、`content`（非空数组）、`time`（对象）
- 5 种内容节点类型的必填字段检查
- `time.type` 为合法值，`countdown` 必须有 `seconds`，`record` 必须有 `duration`
- `content-controlled` 下必须有且仅有一个 video 或 audio 节点
- `gradingInfo` 若存在：id 严格递增、recordIndex 匹配、无重复、覆盖完整

### 业务服务层 (`src/main/services/`)

**exam-service.ts** — `listExams`, `loadExam`, `importExam`, `exportExam`, `deleteExam`
- 导入时解压 ZIP，验证 exam.json + 资源文件，计算 EID 去重
- 加载时将 `src`/`images` 路径改写为 `exam-resource://` 协议

**submission-service.ts** — `createSubmission`, `saveRecord`, `listSubmissions`, `exportSubmission`, `deleteSubmission`

**template-service.ts** — `listTemplates`, `importTemplate`, `exportTemplate`, `deleteTemplate`
- 导入时执行 `validateTemplate()` 验证 ID 唯一性、占位符完整性、文件引用完整性

**draft-service.ts** — `createDraft`, `loadDraft`, `updateText`, `updateTitle`, `uploadFile`, `removeFile`, `deleteDraft`, `exportExam`, `importDraft`, `exportDraft`
- 导出考试时替换占位符，对缺失的 audio 文件调用 TTS 合成

**grading-service/** — 批改系统子模块：
- `import.ts` — `loadRecords`, `saveRecords`, `computeRid`, `loadExamPackage`, `importSubmissions`
- `session.ts` — `GradingSession` 类，管理内存会话状态（`sessionRids`, `sessionCurrentGradingItemIndex`, `sessionSettlementRids`）
- `settlement.ts` — `settleNow`, `settleLater`, `listBatches`, `getMaxScore`
- `export.ts` — `exportCsv`（含 BOM 的 UTF-8 CSV），`exportPdf`（marked 渲染 HTML → printToPDF → ZIP）

### TTS 引擎 (`src/main/tts/`)

- **tts.ts** — 单例 `getTtsEngine()`，创建 Worker 线程，消息驱动合成请求/响应
- **tts-worker.ts** — Worker 线程，加载 WASM 模块和模型，执行分句→分词→逐块合成→WAV 编码流程
- **tokenizer.ts** — `decodeSentencepieceModel()` 解析 protobuf 格式的 SentencePiece 模型文件，`UnigramTokenizer` 类实现维特比分词
- **wav-encoder.ts** — `encodeWav(samples, sampleRate)` 将 Float32Array 编码为 PCM 16-bit WAV

合成参数：24000 Hz 采样率，单声道，16-bit，每块最多 50 token，块间 0.2 秒静音，温度 0.7，默认 alba 音色。

### 自定义协议 (`src/main/protocols/`)

| 协议 | 用途 | 路径基准 |
|------|------|----------|
| `exam-resource://{examId}/` | 加载考试媒体资源 | `{userData}/exams/{examId}/` |
| `grading-resource://{rid}/` | 加载批改资源 | `{userData}/grading/{rid}/` |
| `app-resource://` | 加载内置应用资源 | 开发 `resources/media/`，生产 `{resourcesPath}/media/` |
| `draft-resource://{draftId}/` | 加载草稿资源 | `{userData}/drafts/{draftId}/` |

`factory.ts` 提供 `createSimpleProtocolHandler(baseDir)` 和 `createResourceProtocolHandler(getBaseDir)` 两个工厂函数，均包含路径遍历防护（`resolve` + 前缀检查）。

### 预加载桥接 (`src/preload/`)

7 个 bridge 模块通过 `contextBridge.exposeInMainWorld` 暴露 `window.electronAPI`：

| 命名空间 | 桥接文件 | 主要 IPC 方法 |
|----------|----------|---------------|
| `exam` | `exam.bridge.ts` | list, load, import, export, delete |
| `submission` | `submission.bridge.ts` | create, saveRecord, list, delete, export, exportMultiple, deleteMultiple |
| `template` | `template.bridge.ts` | list, import, export, delete |
| `draft` | `draft.bridge.ts` | create, list, load, updateText, updateTitle, uploadFile, uploadClipboardImage, removeFile, delete, exportExam, importDraft, exportDraft, onExportProgress |
| `grading` | `grading.bridge.ts` | importSubmissions, list, startGrading, submitScore, pauseGrading, finishGrading, getSettlementInfo, settleNow, settleLater, listBatches, exportCsv, exportPdf, loadAudio, getGradingHtml, onImportProgress, onPdfProgress, onPdfError |
| `window` | `window.bridge.ts` | minimize, maximize, close |
| `dev` | `dev.bridge.ts` | isDev, setDevToolsEnabled, resetData, openDataFolder |

## 路由结构

使用 React Router 的 `MemoryRouter`（不依赖浏览器 URL）。

**带侧边栏布局（Layout 内）：**

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | HomePage | 试卷列表 |
| `/recordings` | RecordingsPage | 作答列表 |
| `/create/templates` | CreateExamPage（模板标签） | 创建试卷 |
| `/create/drafts` | CreateExamPage（草稿标签） | 草稿列表 |
| `/grading` | GradingPage（批改列表） | 批改管理 |
| `/grading/batches` | GradingPage（批次） | 批改记录 |
| `/about` | AboutPage | 关于页面 |
| `/dev-options` | DeveloperOptionsPage | 开发者选项 |

**全屏路由（无侧边栏）：**

| 路径 | 页面 | 说明 |
|------|------|------|
| `/exam/:examId` | ExamPage | 考试播放 |
| `/draft/:draftId` | DraftEditPage | 草稿编辑 |
| `/grading/session` | GradingSessionPage | 批改会话 |
| `/grading/settlement` | GradingSettlementPage | 批改结算 |

## 数据存储

所有持久化数据存储在 `app.getPath('userData')` 下，分 `exams/`, `submissions/`, `templates/`, `drafts/`, `grading/` 五个子目录。详细结构见 [data-storage.md](./data-storage.md)。

## 自适应缩放

应用采用固定 3:2 设计比例（1200×800 像素），通过 CSS `transform: scale()` 实现自适应缩放。在任意窗口大小下，内容保持等比缩放，多余空间以黑色背景填充。

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 桌面框架 | Electron | 39 |
| 前端框架 | React + TypeScript | 19 |
| 构建工具 | electron-vite + Vite | 5.0 / 7.2 |
| 路由 | react-router-dom | 7.14 |
| 打包分发 | electron-builder | 26 |
| TTS 引擎 | Pocket TTS (WASM) | 本地离线 |
| 代码规范 | ESLint 9 + Prettier 3 | |
| 测试框架 | vitest | 4.1.6 |
| 测试工具 | @testing-library/react, @testing-library/jest-dom, jsdom | |

## 测试基础设施

测试框架为 vitest 4.1.6，配置在 `vitest.config.ts`：jsdom 环境，`@vitejs/plugin-react` 用于 JSX 转换，`@renderer` 路径别名。测试环境初始化在 `vitest.setup.ts`（加载 jest-dom matchers、mock electron 模块）。

10 个测试文件，共 127 个测试用例，覆盖共享验证、主进程工具、TTS 引擎、协议工厂、服务层、渲染组件。详见 [testing.md](./testing.md)。

## 第三方依赖

- **Pocket TTS**（MIT）：语音合成模型及 ONNX WASM 导出
- **adm-zip**：ZIP 压缩/解压
- **marked**：Markdown 转 HTML（PDF 导出时使用）
- **react-markdown + remark-gfm**：渲染 Markdown（批改界面）
- **lucide-react**：图标库
