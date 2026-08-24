<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# API 接口文档

## 架构概述

CYEZ 英语听说的前后端通信基于 Electron IPC（Inter-Process Communication），采用请求-响应模式 (`ipcMain.handle()` / `ipcRenderer.invoke()`)。预加载脚本通过 `contextBridge.exposeInMainWorld` 将 API 暴露为 `window.electronAPI` 对象。

```
Renderer Process                   Main Process
     │                                  │
     │  ipcRenderer.invoke(channel, args)│
     │ ─────────────────────────────────>│
     │                                  │ ipcMain.handle(channel, handler)
     │  <─────────────────────────────────│
     │           return value             │
     │                                  │
     │  ipcRenderer.on(event, callback)  │
     │  <══════════════════════════════  │
     │    webContents.send(event, data)  │ (push events for progress)
```

使用方式（前端）：
```typescript
// 请求-响应
const exams = await window.electronAPI.exam.list()

// 进度事件监听
const unsubscribe = window.electronAPI.grading.onImportProgress(({ current, total }) => {
  console.log(`进度: ${current}/${total}`)
})
// 取消监听: unsubscribe()
```

---

## 命名空间总览

| 命名空间 | 桥接文件 | IPC 注册 | 方法数 | 事件数 |
|----------|----------|----------|--------|--------|
| `exam` | `preload/bridges/exam.bridge.ts` | `main/ipc/exam.ts` | 5 | 0 |
| `submission` | `preload/bridges/submission.bridge.ts` | `main/ipc/submission.ts` | 7 | 0 |
| `template` | `preload/bridges/template.bridge.ts` | `main/ipc/template.ts` | 4 | 0 |
| `draft` | `preload/bridges/draft.bridge.ts` | `main/ipc/draft/` | 12 | 1 |
| `grading` | `preload/bridges/grading.bridge.ts` | `main/ipc/grading.ts` | 14 | 3 |
| `dev` | `preload/bridges/dev.bridge.ts` | `main/ipc/dev.ts` | 4 | 0 |
| `window` | `preload/bridges/window.bridge.ts` | `main/ipc/window.ts` | 4 | 1 |

---

# 一、exam — 考试管理

## exam:list

列出所有已导入的考试包，按导入时间降序。

```
IPC: exam:list
参数: 无
返回: ExamListItem[]
```

**返回类型：**
```typescript
interface ExamListItem {
  id: string          // EID (考试标题+题目的 SHA-256)
  title: string       // 考试标题
  questionCount: number
  importedAt: string  // ISO 时间戳
}
```

**前端调用：**
```typescript
const exams = await window.electronAPI.exam.list()
```

---

## exam:load

加载考试详情，验证试卷格式和资源文件。返回的 `questions[].content` 中所有 `src` 和 `images` 路径已被改写为 `exam-resource://{eid}/` 协议前缀。

```
IPC: exam:load
参数: examId: string
返回: Record<string, unknown> (ExamPackage)
抛出: Error('考试不存在' | '试卷格式不合法' | '缺少资源文件')
```

**返回类型（实际为 ExamPackage 结构）：**
```typescript
interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
}
```
详见 [exam-format.md](./exam-format.md)。

**前端调用：**
```typescript
const exam = await window.electronAPI.exam.load('abc123...')
```

---

## exam:import

弹出文件选择对话框，导入 ZIP 格式考试包。自动解压、验证、去重（EID 相同则跳过）。

```
IPC: exam:import
参数: 无（弹出文件对话框）
返回: { success: boolean; examId?: string; error?: string }
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | boolean | 是否导入成功 |
| `examId` | string | 成功时返回新导入的考试 EID |
| `error` | string | 失败时返回错误信息（取消/格式不合法/缺少文件等） |

**前端调用：**
```typescript
const result = await window.electronAPI.exam.import()
if (result.success) console.log('导入成功:', result.examId)
else console.error('导入失败:', result.error)
```

---

## exam:export

弹出保存对话框，将考试包重新打包为 ZIP。

```
IPC: exam:export
参数: examId: string
返回: void（用户选择路径后写入文件，取消则无操作）
抛出: 异常时弹出错误对话框
```

**前端调用：**
```typescript
await window.electronAPI.exam.export('abc123...')
```

---

## exam:delete

弹出确认对话框，用户确认后删除考试目录。

```
IPC: exam:delete
参数: examId: string
返回: { success: boolean }
```

**前端调用：**
```typescript
const result = await window.electronAPI.exam.delete('abc123...')
```

---

# 二、submission — 作答管理

## submission:create

创建作答记录。复制考试数据到作答目录，生成 UUID v4 作为 ID。

```
IPC: submission:create
参数: examId: string, student: StudentInfo
返回: string (submissionId UUID)
抛出: Error('考试不存在')
```

**参数类型：**
```typescript
interface StudentInfo {
  name: string        // 学生姓名
  studentId: string   // 学号（6位）
}
```

**前端调用：**
```typescript
const submissionId = await window.electronAPI.submission.create('exam123', {
  name: '张三',
  studentId: '240001'
})
```

---

## submission:saveRecord

保存录音文件到作答目录的 `recordings/{recordIndex}.mp3`。

```
IPC: submission:saveRecord
参数: submissionId: string, recordIndex: number, buffer: ArrayBuffer
返回: void
```

**前端调用：**
```typescript
await window.electronAPI.submission.saveRecord(submissionId, 1, audioBuffer)
```

---

## submission:list

列出所有作答记录，支持筛选。

```
IPC: submission:list
参数: filter?: { studentId?: string; name?: string; examTitle?: string }
返回: SubmissionItem[]
```

**返回类型：**
```typescript
interface SubmissionItem {
  id: string              // UUID v4
  student: StudentInfo
  examTitle: string       // 考试标题
  submittedAt: string     // ISO 时间戳
  recordingCount: number  // 录音文件数
}
```

**筛选说明：** `name` 和 `examTitle` 支持子串匹配，`studentId` 需要完全匹配。

**前端调用：**
```typescript
const all = await window.electronAPI.submission.list()
const filtered = await window.electronAPI.submission.list({ name: '张' })
```

---

## submission:delete

删除单个作答记录。

```
IPC: submission:delete
参数: submissionId: string
返回: { success: boolean }
```

---

## submission:export

弹出保存对话框，将单个作答记录打包为 ZIP。

```
IPC: submission:export
参数: submissionId: string
返回: void（用户选择路径后写入文件）
```

ZIP 内部结构：`{学生姓名}_{submissionId前8位}/meta.json + exam/exam.json + recordings/*.mp3`

---

## submission:exportMultiple

弹出保存对话框，批量导出多个作答记录为单个 ZIP。

```
IPC: submission:exportMultiple
参数: ids: string[]
返回: void
```

**前端调用：**
```typescript
await window.electronAPI.submission.exportMultiple(['id1', 'id2'])
```

---

## submission:deleteMultiple

批量删除作答记录。

```
IPC: submission:deleteMultiple
参数: ids: string[]
返回: { success: boolean; deleted: string[]; notFound: string[] }
```

| 字段 | 说明 |
|------|------|
| `success` | 是否全部成功（至少一个失败则为 false） |
| `deleted` | 成功删除的 ID 列表 |
| `notFound` | 不存在的 ID 列表 |

---

# 三、template — 模板管理

## template:list

列出所有模板。

```
IPC: template:list
参数: 无
返回: TemplateListItem[]
```

**返回类型：**
```typescript
interface TemplateListItem {
  id: string          // UUID v4
  title: string       // 模板标题（从 examData.title 读取）
  description?: string
  createdAt: string   // ISO 时间戳
}
```

---

## template:import

弹出文件对话框导入 ZIP 格式模板。自动执行 `validateTemplate()` 验证。

```
IPC: template:import
参数: 无（弹出文件对话框）
返回: { success: boolean; error?: string }
```

验证规则：
1. `editableData` 中 `id` 不重复
2. 文件路径不冲突（media 已有文件 + editableData 中 fileName 不重复）
3. 占位符完整性（所有 `{{id}}` 都有对应 editableData，所有 editableData 都被引用）
4. `audio` 节点必须有非空 `text` 和 `src`
5. 文件引用完整性（所有 src/images 指向的文件都在 media 或 editableData 中定义）

**前端调用：**
```typescript
const result = await window.electronAPI.template.import()
```

---

## template:export

弹出保存对话框导出模板为 ZIP。

```
IPC: template:export
参数: templateId: string
返回: void
```

---

## template:delete

删除模板。

```
IPC: template:delete
参数: templateId: string
返回: { success: boolean }
```

---

# 四、draft — 草稿管理

## draft:create

基于模板创建草稿，返回新草稿 ID。

```
IPC: draft:create
参数: templateId: string
返回: string (draftId UUID)
抛出: Error('模板不存在')
```

创建过程：复制 template.json + media/ 到草稿目录，初始化空的 textValues/fileValues 映射。

---

## draft:list

列出所有草稿。

```
IPC: draft:list
参数: 无
返回: DraftListItem[]
```

**返回类型：**
```typescript
interface DraftListItem {
  id: string         // UUID v4
  templateId: string
  title: string      // 自定义标题或模板默认标题
  updatedAt: string  // ISO 时间戳
}
```

---

## draft:load

加载草稿详情用于编辑。

```
IPC: draft:load
参数: draftId: string
返回: DraftView
抛出: Error('草稿不存在')
```

**返回类型：**
```typescript
interface DraftView {
  id: string
  templateId: string
  title: string
  editableItems: EditableDataItem[]
  textValues: Record<string, string>       // { placeholderId: textContent }
  fileValues: Record<string, string>       // { placeholderId: hashedFileName }
  fileOriginalNames: Record<string, string> // { placeholderId: originalName }
}
```

---

## draft:updateText

更新草稿中指定可编辑项的文本值。

```
IPC: draft:updateText
参数: draftId: string, id: string, value: string
返回: void
```

---

## draft:updateTitle

更新草稿标题（不影响模板默认标题）。传空字符串可恢复默认标题。

```
IPC: draft:updateTitle
参数: draftId: string, title: string
返回: void
```

---

## draft:uploadFile

弹出文件对话框，上传文件到草稿的 `uploads/` 目录。

```
IPC: draft:uploadFile
参数: draftId: string, id: string (editableData 中的 id)
返回: void（用户取消则无操作）
```

文件以 SHA-256 哈希加盐后的前 12 位重命名存储。

---

## draft:uploadClipboardImage

将剪贴板的 base64 图片数据保存到草稿的 `uploads/` 目录。

```
IPC: draft:uploadClipboardImage
参数: draftId: string, id: string, base64Data: string, ext: string (如 'png')
返回: void
```

---

## draft:removeFile

移除草稿中已上传的文件（同时删除物理文件）。

```
IPC: draft:removeFile
参数: draftId: string, id: string
返回: void
```

---

## draft:delete

删除整个草稿目录。

```
IPC: draft:delete
参数: draftId: string
返回: { success: boolean }
```

---

## draft:exportExam

验证草稿完整性 → 替换占位符 → TTS 合成音频 → 打包为 ZIP → 弹出保存对话框。

```
IPC: draft:exportExam
参数: draftId: string
返回: { success: boolean; error?: string }
```

导出前验证：
1. 所有文本项已填写
2. 所有文件项已上传
3. 文件路径安全检查

导出过程中通过 `draft:exportExam-progress` 事件推送进度。

---

## draft:import

弹出文件对话框导入草稿 ZIP 包。

```
IPC: draft:import
参数: 无（弹出文件对话框）
返回: void
```

验证 ZIP 中必须包含 `template.json` 和 `draftState.json`。

---

## draft:exportDraft

弹出保存对话框导出草稿为 ZIP。

```
IPC: draft:exportDraft
参数: draftId: string
返回: void
```

ZIP 内容：`template.json` + `draftState.json` + `media/` + `uploads/`

---

### draft 事件

**draft:exportExam-progress** — 导出进度（频率：每步触发一次）

```typescript
// 前端监听
const unsubscribe = window.electronAPI.draft.onExportProgress((progress) => {
  console.log(progress.step, progress.current, progress.total)
})

// progress 类型
interface DraftExportProgress {
  step: string      // 当前步骤文本
  current: number   // 当前步骤编号
  total: number     // 总步骤数
}
```

---

# 五、grading — 批改管理

## grading:importSubmissions

弹出文件对话框导入作答包 ZIP。自动计算 RID 去重。

```
IPC: grading:importSubmissions
参数: 无（弹出文件对话框）
返回: ImportResult
```

**返回类型：**
```typescript
interface ImportResult {
  success: boolean
  imported: number    // 成功导入数
  skipped: number     // 去重跳过数
  failures: { student: string; reason: string }[]
  error?: string      // 取消时返回 '已取消'
}
```

导入过程中通过 `grading:import-progress` 事件推送进度。

---

## grading:list

列出所有批改记录，支持筛选。

```
IPC: grading:list
参数: filter?: { studentId?: string; name?: string; examTitle?: string }
返回: GradingListItem[]
```

**返回类型：**
```typescript
interface GradingListItem {
  rid: string              // 批改记录 ID
  studentName: string
  studentId: string
  examTitle: string
  status: 'ungraded' | 'grading' | 'completed'
  totalScore?: number
  maxScore?: number        // gradingInfo 各评分项满分之和
  eid: string              // 考试 EID
  submittedAt?: string     // ISO 时间戳
}
```

说明：`name` 和 `examTitle` 支持子串匹配。

---

## grading:startGrading

开始批改会话。初始化 GradingSession，返回第一个待批改项。

```
IPC: grading:startGrading
参数: rids: string[]
返回: StartGradingResult
```

**返回类型：**
```typescript
interface StartGradingResult {
  success: boolean
  firstItem: GradingItemToGrade | null     // null 表示无待批改项
  ungradedCount: number                    // 总待批改项数
  sessionCount: number                     // 本次会话涉及的作答数
  eid?: string
  error?: string
  needsSettlement?: boolean                // 是否需要直接结算
  settlementRids?: string[]                // 待结算的 RID 列表
  firstSubmissionUngradedCount?: number    // 第一个作答的未批改项数
}

interface GradingItemToGrade {
  rid: string                              // 当前批改记录 ID
  gradingInfoItem: GradingInfoItem         // 评分项定义（problemInfo, gradingInfo, fullScore）
  audioUrl: string                         // grading-resource://{rid}/recordings/{recordIndex}.mp3
  existingScore?: { score: number; comment: string }  // 已有评分（恢复进度）
}
```

**处理逻辑：**
1. 清空上次会话状态
2. 跳过 `completed` 状态的记录
3. 对每条记录查找第一个未打分的评分项
4. 全部打完分但未结算的 → 加入 settlementRids，触发 needsSettlement

---

## grading:submitScore

提交当前评分项的分数和评语，自动跳转到下一项。

```
IPC: grading:submitScore
参数: rid: string, gradingInfoId: number, score: number, comment: string
返回: SubmitScoreResult
```

**返回类型：**
```typescript
interface SubmitScoreResult {
  success: boolean
  nextItem: GradingItemToGrade | null   // 下一个评分项，null 表示当前作答已批完
  settle: boolean                       // true 表示所有作答都已批完，需要进入结算
  error?: string
  currentSubmissionUngradedCount?: number  // 切换到的新作答的未批改项数
}
```

**处理逻辑：**
1. 分数四舍五入到一位小数
2. 保存到 `records.json`
3. 状态从 `ungraded` 更新为 `grading`
4. 自动查找下一项：当前作答后续评分项 → 下一个作答首个未打分项
5. 所有作答全部批完 → `settle: true`

---

## grading:pauseGrading

暂停批改，清空会话状态。已打分数已持久化，下次继续时自动跳过已批题目。

```
IPC: grading:pauseGrading
参数: 无
返回: { success: boolean }
```

---

## grading:finishGrading

完成批改，检查所有会话中的作答，将全部打完分的加入结算列表。

```
IPC: grading:finishGrading
参数: 无
返回: { success: boolean; settlementCount?: number }
```

| 字段 | 说明 |
|------|------|
| `settlementCount` | 可结算的作答数量 |

---

## grading:getSettlementInfo

获取结算页面所需信息，列出每条作答的批改进度。

```
IPC: grading:getSettlementInfo
参数: 无
返回: { success: boolean; records: SettlementRecord[] }
```

**返回类型：**
```typescript
interface SettlementRecord {
  rid: string
  studentName: string
  studentId: string
  examTitle: string
  gradedCount: number      // 已打分项数
  totalItems: number       // 总评分项数
  isFullyGraded: boolean   // 是否全部打完分
  status: 'canSettle' | 'grading' | 'ungraded'
}
```

---

## grading:settleNow

执行结算：为所有已全部打完分的记录创建批次、计算总分、标记为 completed。同时清空会话状态。

```
IPC: grading:settleNow
参数: 无
返回: { success: boolean; batchId?: string }
```

| 字段 | 说明 |
|------|------|
| `batchId` | 新创建的批次 UUID，无记录可结算时为 undefined |

结算操作：
- `totalScore = Math.round(各评分项之和 * 10) / 10`
- `status = 'completed'`
- 分配 batchId 和 gradedAt
- 记录保存到 `records.json`
- 创建 `batches/{batchId}/batch.json`

---

## grading:settleLater

暂不结算，保留评分数据，清空会话状态。

```
IPC: grading:settleLater
参数: 无
返回: { success: boolean }
```

---

## grading:listBatches

列出所有已结算的批改批次。

```
IPC: grading:listBatches
参数: 无
返回: GradingBatch[]
```

**返回类型：**
```typescript
interface GradingBatch {
  batchId: string
  gradedAt: string          // ISO 时间戳
  records: GradingRecord[]  // 该批次的所有记录（含总分、满分、提交时间）
}
```

记录按 `gradedAt` 降序排列。

---

## grading:exportCsv

弹出保存对话框导出批改表格（CSV）。

```
IPC: grading:exportCsv
参数: batchId: string
返回: void（用户选择路径后写入文件，取消则无操作）
```

CSV 格式：
- 含 BOM（`\uFEFF`）确保 Excel 正确识别 UTF-8
- 列：姓名, 学号, 试卷名称, 第1题得分/满分, 第2题得分/满分... 总分/满分, 作答时间

---

## grading:exportPdf

为批次中每个学生生成 PDF 成绩报告，打包为 ZIP 弹出保存。

```
IPC: grading:exportPdf
参数: batchId: string
返回: { success: boolean; errorCount?: number; pdfErrors?: { name: string; studentId: string; error: string }[]; error?: string }
```

**处理流程：**
1. 为每个已完成记录生成 Markdown（学生信息 + 得分表 + 每题题目和评语）
2. `marked` 渲染 Markdown 为 HTML
3. 创建隐藏 BrowserWindow，`printToPDF({ pageSize: 'A4' })`
4. 临时目录存放所有 PDF
5. 打包为 ZIP，弹出保存对话框
6. 导出过程中通过 `grading:pdfProgress` 推送进度，`grading:pdfError` 推送错误

**说明：** 单个学生的 PDF 生成失败不影响其他学生。

---

## grading:loadAudio

加载批改录音文件的本地路径。

```
IPC: grading:loadAudio
参数: rid: string, recordIndex: number
返回: string (file:// 协议的绝对路径)
抛出: Error('无效的录音索引' | '无效的作答 ID' | '音频文件不存在')
```

**安全检查：** recordIndex 必须为非负整数，rid 不能包含 `..`、`/`、`\`。

---

## grading:getGradingHtml

生成某个学生批改记录的完整 HTML（带 CSS 样式），用于 PDF 预览。

```
IPC: grading:getGradingHtml
参数: rid: string
返回: { success: boolean; html?: string; error?: string }
```

HTML 包含：学生信息表格、各题得分/评语、Markdown 渲染的题目信息和评分标准。base href 设置为 `grading-resource://{rid}/exam/`。

---

### grading 事件

**grading:import-progress** — 导入进度（频率：每导入一个作答目录触发一次）

```typescript
// 前端监听
const unsubscribe = window.electronAPI.grading.onImportProgress((progress) => {
  // progress: { current: number; total: number }
})

// 监听返回取消函数
```

**grading:pdfProgress** — PDF 导出进度（频率：每生成一个学生 PDF 前/后触发一次，最后触发"完成"/"保存中..."）

```typescript
const unsubscribe = window.electronAPI.grading.onPdfProgress((progress) => {
  // progress: { current: number; total: number; step: string }
  // step 示例: "正在生成 张三 的PDF (1/15)", "已生成 张三 的PDF", "完成", "保存中..."
})
```

**grading:pdfError** — PDF 生成单个学生失败通知

```typescript
const unsubscribe = window.electronAPI.grading.onPdfError((error) => {
  // error: { name: string; studentId: string; error: string }
})
```

**说明：** 以上三个事件的监听函数都返回取消订阅函数，用于组件卸载时清理。

---

# 六、dev — 开发者工具

## dev:isDev

检查当前是否为开发环境。

```
IPC: dev:isDev
参数: 无
返回: boolean
```

开发环境（`!app.isPackaged`）或开发者模式开启时返回 `true`。

---

## dev:setDevToolsEnabled

设置开发者工具开关状态。

```
IPC: dev:setDevToolsEnabled
参数: enabled: boolean
返回: void
```

---

## dev:resetData

重置所有应用数据并退出。删除 `userData` 目录，生产环境下自动重启。

```
IPC: dev:resetData
参数: 无
返回: void
```

---

## dev:openDataFolder

在系统文件管理器中打开用户数据目录。

```
IPC: dev:openDataFolder
参数: 无
返回: void
```

---

# 七、window — 窗口控制

## window:minimize / maximize / close

窗口最小化、最大化/还原、关闭。

```
IPC: window:minimize  — 参数: 无, 返回: void
IPC: window:maximize  — 参数: 无, 返回: void (Toggle)
IPC: window:close     — 参数: 无, 返回: void
```

---

## window:isMaximized

查询窗口是否已最大化。

```
IPC: window:isMaximized
参数: 无
返回: boolean
```

---

### window 事件

**window:maximize-change** — 窗口最大化/还原状态变化

```typescript
const unsubscribe = window.electronAPI.window.onMaximizeChange((isMaximized) => {
  // isMaximized: boolean
})
```

---

# 八、资源协议

渲染进程通过自定义协议加载本地文件（无需本地 HTTP 服务器）。

| 协议 | URL 格式 | 存储路径 |
|------|----------|----------|
| `exam-resource` | `exam-resource://{eid}/media/xxx.png` | `{userData}/exams/{eid}/` |
| `grading-resource` | `grading-resource://{rid}/recordings/0.mp3` | `{userData}/grading/{rid}/` |
| `app-resource` | `app-resource://media/icon.png` | `resources/media/`（开发）或 `{resourcesPath}/media/`（生产） |
| `draft-resource` | `draft-resource://{draftId}/uploads/xxx.png` | `{userData}/drafts/{draftId}/` |

所有协议：
- 启用流式传输（`stream: true`）、绕过 CSP（`bypassCSP: true`）、支持 Fetch API（`supportFetchAPI: true`）
- 内置路径遍历防护：`resolve()` 后检查路径前缀，拒绝访问基准目录外文件
- 返回 200/206（部分内容）、403（越权）、404（未找到）

**前端使用：**
```typescript
// 在 <img>, <audio>, <video> 等元素中直接使用
<img src="exam-resource://abc123/media/photo.png" />
<audio src="grading-resource://xyz789/recordings/1.mp3" />
```

---

# 共享类型定义

所有类型定义在 `src/shared/types/` 目录，由 `src/renderer/src/types.ts` 重导出供前端使用。

## Exam 领域

```typescript
type ContentNode =
  | { type: 'text'; text: string; bold?: boolean; size?: 'small' | 'normal' | 'large' }
  | { type: 'image'; src: string; width?: string; height?: string }
  | { type: 'video'; src: string }
  | { type: 'audio'; src: string; text: string }
  | { type: 'quad-image'; images: [string, string, string, string]; width?: string }

type TimeControl =
  | { type: 'countdown'; seconds: number }
  | { type: 'record'; duration: number; recordIndex?: number }
  | { type: 'content-controlled' }

interface Question {
  id: string
  content: ContentNode[]
  time: TimeControl
  statusText?: string
}

interface GradingInfoItem {
  id: number
  recordIndex: number
  problemInfo: string
  gradingInfo: string
  fullScore: number
}

interface ExamPackage {
  title: string
  questions: Question[]
  gradingInfo?: GradingInfoItem[]
}

interface ExamListItem {
  id: string
  title: string
  questionCount: number
  importedAt: string
}
```

## Submission 领域

```typescript
interface StudentInfo {
  name: string
  studentId: string
}

interface SubmissionMeta {
  student: StudentInfo
  examId: string
  submittedAt: string
}

interface SubmissionItem {
  id: string
  student: StudentInfo
  examTitle: string
  submittedAt: string
  recordingCount: number
}
```

## Template 领域

```typescript
interface EditableDataItem {
  type: 'text' | 'file'
  id: string
  description: string
  fileName?: string
}

interface ExamTemplate {
  examData: Record<string, unknown>
  editableData: EditableDataItem[]
}

interface TemplateListItem {
  id: string
  title: string
  description?: string
  createdAt: string
}
```

## Draft 领域

```typescript
interface DraftListItem {
  id: string
  templateId: string
  title: string
  updatedAt: string
}

interface DraftView {
  id: string
  templateId: string
  title: string
  editableItems: EditableDataItem[]
  textValues: Record<string, string>
  fileValues: Record<string, string>
  fileOriginalNames: Record<string, string>
}
```

## Grading 领域

```typescript
interface GradingScoreEntry {
  gradingInfoId: number
  score: number
  comment: string
}

type GradingStatus = 'ungraded' | 'grading' | 'completed'

interface GradingRecord {
  rid: string
  status: GradingStatus
  student: StudentInfo
  examTitle: string
  eid: string
  scores: Record<number, GradingScoreEntry>
  totalScore?: number
  maxScore?: number
  batchId?: string
  gradedAt?: string
  submittedAt?: string
}

interface GradingBatch {
  batchId: string
  gradedAt: string
  records: GradingRecord[]
}

interface GradingListItem {
  rid: string
  studentName: string
  studentId: string
  examTitle: string
  status: GradingStatus
  totalScore?: number
  maxScore?: number
  eid: string
  submittedAt?: string
}

interface SettlementRecord {
  rid: string
  studentName: string
  studentId: string
  examTitle: string
  gradedCount: number
  totalItems: number
  isFullyGraded: boolean
  status: 'canSettle' | 'grading' | 'ungraded'
}
```

---

# 完整调用示例

```typescript
// 考试管理
const exams = await window.electronAPI.exam.list()
const exam = await window.electronAPI.exam.load(exams[0].id)
const importResult = await window.electronAPI.exam.import()
await window.electronAPI.exam.export(examId)
const deleteResult = await window.electronAPI.exam.delete(examId)

// 作答管理
const submissionId = await window.electronAPI.submission.create(examId, { name: '张三', studentId: '240001' })
await window.electronAPI.submission.saveRecord(submissionId, 1, audioBuffer)
const submissions = await window.electronAPI.submission.list({ name: '张' })
await window.electronAPI.submission.export(submissionId)
await window.electronAPI.submission.exportMultiple([id1, id2])
await window.electronAPI.submission.delete(submissionId)
await window.electronAPI.submission.deleteMultiple([id1, id2])

// 模板管理
const templates = await window.electronAPI.template.list()
await window.electronAPI.template.import()
await window.electronAPI.template.export(templateId)
await window.electronAPI.template.delete(templateId)

// 草稿管理
const draftId = await window.electronAPI.draft.create(templateId)
const drafts = await window.electronAPI.draft.list()
const draft = await window.electronAPI.draft.load(draftId)
await window.electronAPI.draft.updateText(draftId, 'sentence_1', 'Hello')
await window.electronAPI.draft.updateTitle(draftId, '自定义标题')
await window.electronAPI.draft.uploadFile(draftId, 'picture_file')
await window.electronAPI.draft.uploadClipboardImage(draftId, 'img', base64data, 'png')
await window.electronAPI.draft.removeFile(draftId, 'picture_file')
await window.electronAPI.draft.delete(draftId)
const exportExamResult = await window.electronAPI.draft.exportExam(draftId)
await window.electronAPI.draft.import()
await window.electronAPI.draft.exportDraft(draftId)

// 批改管理
const importSubResult = await window.electronAPI.grading.importSubmissions()
const gradingList = await window.electronAPI.grading.list()
const startResult = await window.electronAPI.grading.startGrading([rid1, rid2])
const submitResult = await window.electronAPI.grading.submitScore(rid, 0, 8.5, 'Good')
await window.electronAPI.grading.pauseGrading()
const finishResult = await window.electronAPI.grading.finishGrading()
const settlementInfo = await window.electronAPI.grading.getSettlementInfo()
await window.electronAPI.grading.settleNow()
await window.electronAPI.grading.settleLater()
const batches = await window.electronAPI.grading.listBatches()
await window.electronAPI.grading.exportCsv(batchId)
await window.electronAPI.grading.exportPdf(batchId)
const audioUrl = await window.electronAPI.grading.loadAudio(rid, recordIndex)
const htmlResult = await window.electronAPI.grading.getGradingHtml(rid)

// 进度事件
const unsubImport = window.electronAPI.grading.onImportProgress(({ current, total }) => {})
const unsubPdf = window.electronAPI.grading.onPdfProgress(({ current, total, step }) => {})
const unsubPdfErr = window.electronAPI.grading.onPdfError(({ name, studentId, error }) => {})
const unsubExport = window.electronAPI.draft.onExportProgress(({ step, current, total }) => {})

// 开发者工具
const dev = await window.electronAPI.dev.isDev()
await window.electronAPI.dev.setDevToolsEnabled(true)
await window.electronAPI.dev.resetData()
await window.electronAPI.dev.openDataFolder()

// 窗口控制
await window.electronAPI.window.minimize()
await window.electronAPI.window.maximize()
await window.electronAPI.window.close()
const maximized = await window.electronAPI.window.isMaximized()
const unsubMax = window.electronAPI.window.onMaximizeChange((isMaximized) => {})
```
