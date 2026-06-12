<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 数据存储结构

## 概述

曹二听说101所有持久化数据存储在 Electron 的 `userData` 目录下（`app.getPath('userData')`），按功能分为五个子目录：`exams`、`submissions`、`templates`、`drafts`、`grading`。应用首次启动时自动创建所有目录。

## 目录结构

```
{userData}/
├── exams/                    # 已导入的考试包
│   ├── initialized           # 首次初始化标记文件
│   └── {eid}/               # 目录名为考试 SHA-256 哈希
│       ├── exam.json         # 考试配置文件
│       └── media/            # 媒体资源（音频、图片、视频）
│           ├── *.mp3
│           ├── *.wav
│           ├── *.png
│           └── *.mp4
│
├── submissions/              # 学生作答记录
│   └── {submissionId}/      # 目录名为 UUID v4
│       ├── meta.json         # 作答元数据
│       ├── exam/             # 考试数据副本
│       │   └── exam.json
│       └── recordings/       # 录音文件
│           └── {recordIndex}.mp3
│
├── templates/                # 试卷模板
│   ├── initialized           # 首次初始化标记文件
│   └── {templateId}/        # 目录名为 UUID v4
│       ├── template.json     # 模板配置
│       └── media/            # 模板固定媒体文件
│           └── ...
│
├── drafts/                   # 试卷草稿
│   └── {draftId}/           # 目录名为 UUID v4
│       ├── template.json     # 模板副本
│       ├── draftState.json   # 草稿状态（文本值、文件值、标题）
│       ├── media/            # 模板固定媒体文件
│       └── uploads/          # 用户上传的文件
│           └── {sha256前12位}{ext}
│
└── grading/                  # 批改数据
    ├── records.json          # 所有批改记录（键为 RID）
    ├── batches/              # 结算批次
    │   └── {batchId}/       # 目录名为 UUID v4
    │       └── batch.json    # 批次元数据
    └── {rid}/               # 目录名为 SHA-256 哈希（RID）
        ├── meta.json         # 原始作答元数据
        ├── exam/             # 考试数据副本
        │   └── exam.json
        └── recordings/       # 录音文件
            └── {recordIndex}.mp3
```

## 各目录详解

### 1. exams/ — 考试包

考试的唯一标识 EID 通过 `computeEid()` 函数计算（`src/main/utils.ts:113-119`）：

```typescript
function computeEid(examPackage: ExamPackage): string {
  const content = JSON.stringify({
    title: examPackage.title,
    questions: examPackage.questions
  })
  return createHash('sha256').update(content).digest('hex')
}
```

这确保了：
- 相同内容的考试包只存储一次
- 导入时自动去重（EID 相同则跳过）
- 媒体资源不会被重复存储

预置考试在应用首次启动时从开发环境的 `exams/` 目录或打包后的 `resources/exams/` 目录复制到 `userData/exams/`。复制完成后创建 `initialized` 标记文件。

### 2. submissions/ — 作答记录

每个作答记录包含：
- **meta.json**：学生信息（`StudentInfo`）、关联的 EID、提交时间戳
- **exam/**：考试数据副本，确保即使原始考试被删除也能查看作答
- **recordings/**：按 `recordIndex` 命名的 MP3 录音文件

作答 ID 为随机 UUID v4。

### 3. templates/ — 试卷模板

模板存储为 `template.json` + 可选的 `media/` 目录。模板 ID 为随机 UUID。

`template.json` 结构：
```typescript
interface ExamTemplate {
  examData: Record<string, unknown>    // 考试数据（含占位符）
  editableData: EditableDataItem[]     // 可编辑数据项列表
}
```

预置模板在应用首次启动时从开发环境的 `templates/` 目录或打包后的 `resources/templates/` 目录复制到 `userData/templates/`。

### 4. drafts/ — 试卷草稿

草稿由模板创建而来，包含：

- **template.json**：模板数据副本
- **draftState.json**：草稿编辑状态
  ```json
  {
    "templateId": "模板 UUID",
    "textValues": { "占位符ID": "文本内容" },
    "fileValues": { "占位符ID": "加盐文件名" },
    "title": "自定义标题（可选）",
    "updatedAt": "ISO 时间戳"
  }
  ```
- **media/**：模板固定媒体文件副本
- **uploads/**：用户上传的文件，文件名经 SHA-256 哈希加盐后存储

### 5. grading/ — 批改数据

**records.json** 结构（键为 RID）：

```typescript
interface GradingRecord {
  rid: string                  // 批改记录 ID
  status: 'ungraded' | 'grading' | 'completed'
  student: StudentInfo         // 学生信息
  examTitle: string
  eid: string
  scores: Record<number, GradingScoreEntry>
  totalScore?: number
  maxScore?: number
  batchId?: string
  gradedAt?: string
  submittedAt?: string
}

interface GradingScoreEntry {
  gradingInfoId: number   // 对应 GradingInfoItem.id
  score: number           // 得分（保留一位小数）
  comment: string         // 评语
}
```

**每条记录的目录（{rid}/）：** 从作答包导入时创建，包含 `meta.json`、`exam/` 和 `recordings/`。

**batches/** 目录：每次结算创建一个批次目录，`batch.json` 记录 `batchId`、`gradedAt` 和 `rids[]`。

## 重要标识符

| 标识符 | 算法 | 用途 | 源文件 |
|--------|------|------|--------|
| EID | `title` + `questions` 的 SHA-256 | 考试包去重 | `src/main/utils.ts:113` |
| RID | `学生姓名 + 学号 + eid + questions` 的 SHA-256 | 批改记录去重 | `src/main/services/grading-service/import.ts:30` |
| Submission ID | UUID v4 (`randomUUID()`) | 作答记录标识 | `submission-service.ts` |
| Template ID | UUID v4 | 模板标识 | `template-service.ts` |
| Draft ID | UUID v4 | 草稿标识 | `draft-service.ts` |
| Batch ID | UUID v4 | 批改批次标识 | `src/main/services/grading-service/settlement.ts:27` |

## 路径获取 API

主进程通过 `src/main/utils.ts` 中的工具函数获取各目录路径：

| 函数 | 返回值 | 行号 |
|------|--------|------|
| `getExamsPath()` | `{userData}/exams` | 31 |
| `getSubmissionsPath()` | `{userData}/submissions` | 35 |
| `getTemplatesPath()` | `{userData}/templates` | 39 |
| `getDraftsPath()` | `{userData}/drafts` | 43 |
| `getGradingPath()` | `{userData}/grading` | 47 |

## 内存状态

除了持久化存储，批改系统的会话状态保存在主进程内存中（非持久化），由 `GradingSession` 类管理（`src/main/services/grading-service/session.ts:46-49`）：

```typescript
sessionRids: string[] = []
sessionCurrentGradingItemIndex: Record<string, number> = {}
sessionSettlementRids: string[] = []
```

会话状态在暂停批改、本次结算、下次结算或重新开始批改时清空。

## 数据重置

开发者选项中的"重置数据"功能会删除整个 `userData` 目录。具体实现通过批处理脚本（Windows `rmdir /s /q`）在应用退出后执行。生产环境下，重置后还会自动重启应用。
