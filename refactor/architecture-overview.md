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
│  ├─ Template │  配置    │                        │
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
│  评分系统 ── Schema ── Schema 配置                │
│  (分数计算)    (结构)      (提示词)               │
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
│  ├── schemas/    (评分 Schema + 配置)              │
│  └── config/     (AI 配置、API Key)               │
└──────────────────────────────────────────────────┘
```

## 模块职责

| 模块 | 位置 | 职责 |
|------|------|------|
| Section 引擎 | 渲染进程 | 参数树 → Question[] 展开。纯函数，可单独测试 |
| Interface | 渲染进程 | 题型管理：参数定义、AI 生成提示词模板、调用 LLM API、数据实例管理 |
| Template | 渲染进程 | 模板管理：Section 结构定义、数据来源绑定（Interface 实例或自定义） |
| Schema | 渲染进程 | 评分项结构、录音映射、配置格式定义 |
| Schema 配置 | 渲染进程 | 评分提示词/参数填充 |
| 考试播放器 | 渲染进程 | React 组件，fixed 覆盖层。接收 ExamPackage，产出 SubmissionPackage |
| AI 引擎 | 渲染 + 主进程 | 云 API（渲染进程直接 fetch），本地推理（主进程 IPC） |
| 存储 | 主进程 | 文件读写、导入导出 ZIP、系统对话框 |

## 关键数据流

```
出卷:
  教师操作 UI → Interface 模块拼 prompt → fetch LLM API
  → 数据实例保存（IPC: file:write）
  → Template 组装 Section 结构 + 绑定数据实例
  → 展开为 ExamPackage → 保存（IPC: file:write）

考试:
  主体 App 加载 ExamPackage → 传给 <ExamPlayer />
  → 学生作答 → MediaRecorder 录音
  → onFinish 回调返回 SubmissionPackage
  → 主体 App 保存（IPC: file:write）

批改:
  导入作答（IPC: file:unzip）
  → Schema 匹配 gradingInfo
  → 转写录音（IPC: ai:sttTranscribe 或云 API fetch）
  → LLM 预评分（fetch）
  → 教师确认 → 结算 → 导出成绩
```

## 关键设计决策

1. **渲染进程重，主进程薄。** 业务逻辑绝大多数是纯数据操作，放在渲染进程避免 IPC 膨胀。主进程只桥接文件系统和本地模型推理。

2. **Section 引擎是渲染进程中的纯函数。** 参数树展开不依赖任何原生能力——遍历、映射、生成 Question[] 全在 JS 里完成。

3. **云 API 调用不走主进程。** LLM 和云端 STT 是 HTTP 请求，渲染进程直接 fetch。API Key 通过 IPC 从主进程的加密存储中获取。

4. **考试播放器是独立组件。** CSS Modules 隔离样式，fixed 覆盖层独占全屏，props 进 callback 出，无任何 IPC 依赖（除了录音保存时调一次 file:write）。
