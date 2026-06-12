<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 批改系统

## 概述

批改系统是 曹二听说101 的重要组成部分，用于教师对学生提交的作答包进行分项评分、结算并导出批改结果。整个流程包括：导入作答包 → 批改评分 → 结算 → 导出结果。

## 源码结构

```
src/main/services/grading-service/
├── index.ts        # 统一导出
├── import.ts       # 数据加载/保存、RID 计算、作答包导入
├── session.ts      # GradingSession 类（核心批改会话管理）
├── settlement.ts   # 结算（settleNow/settleLater）、批次列表
└── export.ts       # CSV 和 PDF 导出
```

## 数据模型

### 核心类型

```typescript
// src/shared/types/grading.ts

interface GradingScoreEntry {
  gradingInfoId: number   // 对应 GradingInfoItem.id
  score: number           // 得分（保留一位小数）
  comment: string         // 评语
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

### 重要标识符

| 概念 | 算法 | 说明 |
|------|------|------|
| EID | `title` + `questions` 的 SHA-256 | 考试唯一标识 |
| RID | `name + studentId + eid + questions` 的 SHA-256 | 批改记录唯一标识（`import.ts:30-38`） |

### RID 去重机制

同一学生在同一份考试中的作答会计算为相同的 RID，`importSubmissions()` 在 `records[rid]` 已存在时跳过导入，确保不会重复导入同一份作答。

## 数据存储

```
{userData}/grading/
├── records.json          # 所有批改记录（键为 RID）
├── batches/              # 结算批次
│   └── {batchId}/
│       └── batch.json    # { batchId, gradedAt, rids[] }
└── {rid}/
    ├── meta.json         # 原始作答元数据
    ├── exam/             # 考试副本
    │   └── exam.json
    └── recordings/       # 录音文件
        └── {recordIndex}.mp3
```

## 批改流程

### 1. 导入作答包 (`import.ts:81-173`)

`importSubmissions(gradingPath, zipPath, onProgress?)` 返回 `ImportResult`：

```typescript
interface ImportResult {
  success: boolean
  imported: number
  skipped: number
  failures: { student: string; reason: string }[]
  error?: string
}
```

导入过程：
1. 解压 ZIP，识别每个作答子目录
2. 读取 `meta.json` 获取学生信息和考试数据
3. 计算 EID 和 RID
4. RID 已存在 → 跳过（去重）
5. 否则：解压到 `{gradingPath}/{rid}/`，创建 `GradingRecord`（status: `ungraded`）
6. 通过 `onProgress` 回调推送进度（由 IPC 转发为 `grading:import-progress` 事件）

### 2. GradingSession 类 (`session.ts:46-341`)

批改会话的核心类，管理内存中的会话状态：

```typescript
class GradingSession {
  sessionRids: string[]                       // 当前会话中的 RID 列表
  sessionCurrentGradingItemIndex: Record<string, number>  // { rid → 当前批改项 ID }
  sessionSettlementRids: string[]             // 等待结算的 RID 列表
}
```

#### 关键方法

**`start(rids: string[]): StartGradingResult`** (行 93-173)
- 清空上一次会话状态
- 遍历请求的 RID，跳过 `completed` 状态和无效记录
- 查找每个记录的第一个未打分评分项
- 已全部打分但未结算的记录加入 `sessionSettlementRids`
- 若无有效记录 → 返回错误或触发 needsSettlement
- 返回第一个可批改项 `firstItem: GradingItemToGrade`

```typescript
interface GradingItemToGrade {
  rid: string
  gradingInfoItem: GradingInfoItem   // 当前评分项定义
  audioUrl: string                   // grading-resource:// 协议 URL
  existingScore?: { score: number; comment: string }  // 已有评分（恢复进度）
}
```

**`submitScore(rid, gradingInfoId, score, comment): SubmitScoreResult`** (行 175-266)
- 分数四舍五入到一位小数：`Math.round(score * 10) / 10`
- 保存到 `record.scores[gradingInfoId]`
- 状态从 `ungraded` 更新为 `grading`
- 自动查找下一个未打分项：
  1. 当前作答的后续评分项
  2. 下一个作答的第一个未打分项
  3. 跳过已完成的作答
- 全部完成 → 返回 `settle: true`

**`findNextUngradedGradingInfoId(gradingInfo, record, fromId)`** (行 51-65)
- 从指定 ID 开始扫描 `gradingInfo`，返回第一个未打分项的 ID

**`loadGradingItem(rid, gradingInfoId)`** (行 67-91)
- 加载评分项定义、音频 URL、已有打分信息

**`pause()`** (行 268-273) — 清空所有会话状态，保持已保存的分数

**`finish()`** (行 275-298) — 检查会话中所有 RID，将全部打完分的加入结算列表

**`getSettlementInfo()`** (行 300-340) — 生成结算页面所需数据

### 3. 结算 (`settlement.ts`)

**`settleNow(gradingPath, sessionSettlementRids): SettleNowResult`** (行 22-70)
- 为所有已全部打完分的记录：
  - 设置 `status = 'completed'`
  - 计算 `totalScore`（各评分项得分之和，保留一位小数）
  - 分配 `batchId`（UUID v4）
  - 设置 `gradedAt` 时间戳
- 保存 `records.json`
- 创建 `batches/{batchId}/batch.json`

**`settleLater()`** (行 72-74) — 不做持久化变更，仅返回成功

**`listBatches(gradingPath): GradingBatch[]`** (行 76-112)
- 遍历 `batches/` 目录
- 读取每个 `batch.json`
- 加载对应记录，补充 `submittedAt` 和 `maxScore`
- 按 `gradedAt` 降序排列

### 4. 导出 (`export.ts`)

**`exportCsv(gradingPath, batchId): string`** (行 13-53)
- 含 BOM（`\uFEFF`）的 UTF-8 CSV
- 列：姓名、学号、试卷名称、各题得分/满分、总分/满分、作答时间
- 每题分数格式：`8.5/10`

**`exportPdf(gradingPath, batchId, tempDir, onProgress?, onPdfError?): Promise<PdfExportResult>`** (行 63-222)
- 为每个学生：
  1. 生成 Markdown（学生信息、得分表、每题题目和评语）
  2. 使用 `marked` 渲染为 HTML
  3. 写入临时 HTML 文件
  4. 创建隐藏 `BrowserWindow` 加载 HTML
  5. `webContents.printToPDF({ pageSize: 'A4' })` 生成 PDF
  6. 清理临时文件，销毁窗口
- 失败不阻塞其他学生
- 通过进度回调推送状态

```typescript
interface PdfExportResult {
  success: boolean
  errorCount: number
  pdfErrors: { name: string; studentId: string; error: string }[]
  files: { filename: string; buffer: Buffer }[]
}
```

### 5. 会话管理完整状态流转

```
ungraded ──→ grading ──→ completed
   ↑            ↑            ↑
   导入后       首次打分后    结算后
```

- **ungraded**：作答包导入后的初始状态
- **grading**：至少一个评分项已打分，但尚未全部完成或未结算
- **completed**：已完成结算，所有评分项都已打分且总分已计算

会话状态在以下时机被清空：
- `pause()` — 暂停批改
- `start()` — 新批改会话初始化时先清空
- 结算后由 IPC handler 层清空

## GradingInfo 验证

导入考试时通过 `validateExamPackage()` (`src/shared/validation.ts:132-209`) 验证 `gradingInfo`：
1. 必须是数组
2. `id` 从 0 开始严格递增
3. `recordIndex` 必须匹配考试中 `record` 题目的 `recordIndex`
4. `recordIndex` 不能重复
5. `problemInfo` 和 `gradingInfo` 必须为字符串
6. `fullScore` 必须为正数
7. 覆盖的 `recordIndex` 数量必须等于考试中定义了 `recordIndex` 的题目数量

## 资源协议

批改界面使用 `grading-resource://{rid}/` 协议加载录音文件：
```
grading-resource://{rid}/recordings/{recordIndex}.mp3
```
协议处理器从 `{userData}/grading/{rid}/` 加载文件，`factory.ts` 的 `serveFile()` 函数执行路径遍历防护。

## 测试覆盖

| 测试文件 | 测试数 | 覆盖内容 |
|----------|--------|----------|
| `grading-service.test.ts` | 8 | computeRid、loadRecords/saveRecords 的空状态处理 |
| `grading-session.test.ts` | 9 | GradingSession 的 start、submitScore、pause、finish、getSettlementInfo |
