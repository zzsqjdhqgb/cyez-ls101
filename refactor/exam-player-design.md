## 定位

考试播放器是一个纯前端 React 组件。它接收一份固定格式的试卷包作为 props，播放完整考试流程，通过 callback 产出一份固定格式的作答包。组件自包含——样式使用 CSS Modules 隔离，不依赖软件主体的任何全局样式或 UI 组件。

## 一、挂载方式

组件作为 fixed 覆盖层挂载：

- `position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 9999`
- 挂载即独占全屏，原有界面被完全覆盖
- 组件卸载即恢复原界面

```
主体 App
  └── <ExamPlayer
        exam={examPackage}
        onFinish={(submission) => { ... }}
        onClose={() => { ... }}
      />
```

## 二、CSS 隔离

使用 CSS Modules（Vite 原生支持，无需配置）：

- 组件内所有样式写在 `.module.css` 文件中
- 类名自动哈希，不与主体任何样式冲突
- 组件内部显式 reset 关键属性（字体、盒模型、边距）

```css
/* ExamPlayer.module.css */
.root {
  all: initial; /* 阻断外部样式继承 */
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 9999;
  background: #000;
  font-family: sans-serif;
}
```

组件内部不使用任何全局选择器（`body`、`div`、`*`），全部通过 class 定位。

## 三、统一缩放

- 设计基准尺寸：1200 × 800 像素（3:2 比例）
- 所有布局和字体以 px 为单位，基于 1200 × 800 设计
- 通过 CSS `transform: scale()` 等比缩放至视口
- `--scale-factor` = `min(viewportWidth / 1200, viewportHeight / 800)`
- 无响应式断点，无 rem/vw，在任何视口下视觉效果完全一致
- 多余空间填充黑色背景

## 四、组件接口

```typescript
interface ExamPlayerProps {
  exam: ExamPackage // 考试数据、答案捕获计划和作答包副本
  examBaseUrl: string // 以 / 结尾的考试路径，例如 exam://exam-id/

  // 回调
  onFinish: (result: SubmissionBundle) => void
  onClose?: () => void // 中途退出（可选）
  onError?: (error: Error) => void
}

interface SubmissionBundle {
  submission: SubmissionPackage
  // 仅包含本次考试新产生的录音；静态附件由归档写入器从 ExamPackage 复制。
  files: Record<string, Blob>
}
```

`ExamPackage` 和 `SubmissionPackage` 的完整结构以 [题目评分管道、Schema 与资源设计](./question-type-pipeline-notes.md) 为准。

数据直接通过 props 传入，结果通过 `onFinish` callback 传回。`submission` 是可序列化的作答清单，`files` 只保存本次考试新录制的音频 Blob。归档写入器根据作答清单，从 `examBaseUrl` GET 并复制独立批改所需的静态附件，再按规范目录写入归档。播放器不执行 IPC、Schema 解析或批改；ZIP 编码可以由外部归档写入器完成。

## 五、静态考试包与资源加载

ExamPackage 的规范内容是一个可以直接部署的静态目录。ZIP 只是传输形式，解压后必须能被普通静态文件服务器直接提供：

```text
<exam-root>/
├── index.json
└── resources/
    └── <assetKey>/
        └── <filename>
```

`index.json` 是入口文件，清单中的 `packagePath` 只保存相对于 `<exam-root>/` 的安全路径，不保存作者机器路径，也不保存固定的 `http://` 或 `exam://` 地址。播放器启动时先以 GET 请求读取：

```text
GET <examBaseUrl>/index.json
```

所有考试资源都通过同一个考试路径 GET 获取。`examBaseUrl` 只由部署环境决定，例如：

```text
exam://exam-id/
https://example.test/exams/exam-id/
```

Electron 可以注册 `exam://` 自定义协议，静态部署则直接使用 HTTP(S)。运行时通过 `index.json` 把 `resource:<assetKey>` 解析为 `examBaseUrl + packagePath`，因此播放器、Markdown 渲染器和批改系统不需要知道底层文件系统位置。

资源加载器必须拒绝清单外的资源键、绝对路径、路径穿越和不在考试路径下的 URL。资源使用 GET 读取；播放器不把资源复制到应用全局目录，也不依赖解压目录之外的文件。

## 六、作答包生成与交付

静态服务器只能提供考试资源，不能接收学生作答。因此作答包的生成在浏览器或 Electron 本地完成，交付方式由外部 `SubmissionSink` 决定：

```text
ExamPlayer
  → SubmissionBundle（清单 + 新录音）
  → SubmissionArchiveBuilder
  → 下载文件 / Electron 保存 / HTTP 上传
```

播放器仍然只复制 `submissionTemplate`、填充答案池并产生新录音；`SubmissionArchiveBuilder` 根据清单从 `examBaseUrl` GET 独立批改所需的静态附件，再把录音加入最终归档。浏览器端可以生成 ZIP Blob 并下载，Electron 端可以写入本地收卷库，联网环境则可以 POST 到收卷服务。生成作答包不需要播放器解析 Schema，也不要求考试服务器提供写入接口。

## 七、内部状态流转

```
mount → 学生信息输入 → 麦克风测试 → 考试中 → 完成 → onFinish
                                                    → onClose（中途退出）
```

组件内部管理全部考试状态。卸载意味着考试结束或退出，外部只需关心 `onFinish` 的结果。

## 八、内部 UI 结构

基于 1200 × 800 设计基准：

```
┌──────────────────────────────────────────────┐
│  Content Area (主内容区)                      │
│  渲染: text / image / video / audio /        │
│        quad-image 节点                        │
├──────────────────────────────────────────────┤
│  Status Bar (状态栏)                          │
│  显示: 倒计时 / 录音进度条 / 播放状态        │
│        + statusText                          │
└──────────────────────────────────────────────┘
```

风格方向：深色背景 + 高对比度文字，正式考场的严肃感。

## 九、与主体软件的关系

- 宿主或静态启动页负责：GET `index.json`、准备 `ExamPackage`，并向播放器提供 `examBaseUrl`
- `<ExamPlayer>` 接收数据，运行完整考试流程
- `<ExamPlayer>` 按 `answerCapturePlan` 填充字符串和音频答案，复制 `submissionTemplate` 并补充考试元数据
- `onFinish` 回调返回 `SubmissionBundle`，主体软件负责归档、保存、导出或投入批改

播放器组件不知道模板、Section、Interface、Schema 或评分规则。它只知道考试数据、答案捕获计划和待复制的作答包副本。
