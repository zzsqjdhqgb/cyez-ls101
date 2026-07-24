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
  all: initial;            /* 阻断外部样式继承 */
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
  exam: ExamPackage              // 试卷数据
  resources: Record<string, string>  // 资源 src → 可访问 URL

  // 回调
  onFinish: (result: SubmissionPackage) => void
  onClose?: () => void           // 中途退出（可选）
  onError?: (error: Error) => void
}

interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
}

interface SubmissionPackage {
  student: { name: string; studentId: string }
  examId: string
  recordings: { [recordIndex: number]: Blob }
  submittedAt: string
}
```

数据直接通过 props 传入，结果通过 `onFinish` callback 传回。没有 postMessage，没有 IPC，没有序列化。

## 五、内部状态流转

```
mount → 学生信息输入 → 麦克风测试 → 考试中 → 完成 → onFinish
                                                    → onClose（中途退出）
```

组件内部管理全部考试状态。卸载意味着考试结束或退出，外部只需关心 `onFinish` 的结果。

## 六、内部 UI 结构

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

## 七、与主体软件的关系

- 主体软件负责：加载试卷数据、转换资源路径、准备 `ExamPackage`
- `<ExamPlayer>` 接收数据，运行完整考试流程
- `onFinish` 回调返回 `SubmissionPackage`，主体软件处理后保存、导出或投入批改

播放器组件不知道模板、Section、Interface、Schema 等概念。它只知道试卷和作答。
