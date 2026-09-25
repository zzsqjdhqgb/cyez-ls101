<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: submission-library
-->

# 作答工作流（submission-workflow）

## 架构

`@ls101/submission-library`（`packages/submission-library/src/index.ts`）是 renderer 侧的作答记录仓储、评分会话与结算逻辑，单文件实现。它依赖 `@ls101/exam-package` 的 `decodeSubmissionPackage` 解码 `.lssubmission`，依赖 `@ls101/core-types` 的 `SubmissionPackage`/`GradingResult`/`SubmissionSchemaUse` 契约，AI 执行则委托 `@ls101/grading-engine`。

存储通过 `SubmissionLibraryStore` 抽象注入（与 `@ls101/file-store` 的 `ScopedStore` 同形），构造函数把它拆成 `submissions` 与 `settlements` 两个 scope（`FileSubmissionLibraryRepository`，`index.ts:256`）。renderer 在 `packages/renderer/src/features/submissions/SubmissionLibraryRuntime.ts` 用 `fileStore.scope('submission-library')` 构造单例，并由 `SubmissionLibraryProvider`/`useSubmissionLibrary` 注入页面。

关键导出：`FileSubmissionLibraryRepository`、`SubmissionLibraryError`、`objectiveGradingEngine`、`createHumanGradingEngine`、`buildGradingInput`、`buildSubmissionReportMarkdown`，以及记录类型 `SubmissionLibraryRecord`、`SubmissionGradingRecord`、`SubmissionAIGradingRun`、`SubmissionSettlementBatch`、`SubmissionGradingWorkspace`、`SubmissionReport`。`FileSubmissionLibraryRepository` 实现 `SubmissionLibraryRepository` 接口，公开 `listRecords`/`listEntries`/`getRecord`/`importArchive`/`exportArchive`/`deleteSubmission`/`resetGrading`/`listSettlementBatches`/`settleSubmissions`/`startGrading`/`submitGradingResult`/`saveAIGradingRun`/`getGradingRecord`/`getReport`。

存储端口 `SubmissionLibraryStore`（`index.ts:190`）只暴露 `scope`、文本读写/CAS/删除、asset 读写/删除、`listScopes` 与 `clear`；`@ls101/file-store` 的 `ScopedStore` 结构满足该接口，因此测试可用内存实现替换真实磁盘。

## 运行时与生命周期

`importArchive(data)`（`index.ts:316`）先要求 `Uint8Array`，`decodeSubmissionPackage` 失败映射为 `INVALID_ARCHIVE`；随后计算 `storageKey = sha256(submissionId)` 与归档 `sha256`，在 `runMutation(storageKey)` 内先写归档 asset（`package-<hash>.lssubmission`），再以 `compareAndSwapText(RECORD_FILE, null, record)` 落 `record.json`。已存在同 ID 同哈希返回 `{status:'duplicate'}`；同 ID 不同哈希报 `SUBMISSION_ID_CONFLICT` 并清理刚写入的 asset。

`listRecords` 要求每个子 scope 名为 64 位十六进制（否则 `INVALID_STORAGE`），按 `submittedAt` 降序、再按 `submissionId` 降序排序；`listEntries` 为每条记录附加评分摘要与结算摘要（`settlementLookup` 来自 `settlements/index.json`）。

`startGrading(submissionId)`（`index.ts:494`）在 `runMutation(storageKey)` 内：若已结算抛 `ALREADY_SETTLED`；读取归档与现有 `grading.json`；调用 `applyObjectiveGrades` 自动为尚未评分的 `questionType === 'objective'` 单元写入 `engine: 'objective'` 的 `GradingResult`（分数=答对则 `maxScore`，否则 0，评语空串），有变化才写盘；返回 `SubmissionGradingWorkspace {submission, grading, inputs}`。

人工评分：renderer 用 `createHumanGradingEngine` 产出结果，再调用 `submitGradingResult(submissionId, instanceId, 'human', result)`。AI 评分：renderer 通过 `SubmissionAIRouterAdapter` 组装 `SpeechRecognizer`/`SpeechCorrector`/`TextGradingModel`，用 `@ls101/grading-engine` 的 `executeAIGrading(input, dependencies, {signal, onProgress})` 串行处理每条音频作答，过程用 `saveAIGradingRun` 以 `processing` 状态持续落盘，结束后写 `succeeded`，失败写 `failed` 并记录 `error`。

`saveAIGradingRun`（`index.ts:559`）按 `instanceId` 覆盖式替换 `aiRuns`（先 filter 再 append），写入新的 `updatedAt`；objective 单元报 `INVALID_GRADING_RESULT`，未知 `instanceId` 报 `NOT_FOUND`，运行记录形状或分数超上限报 `INVALID_GRADING_RESULT`。

评分状态机由 `gradingRecord`（`index.ts:923`）推导：已评 `instanceId` 集合等于 `submission.schemaUses` 全集时 `status='ready'` 并写入 `readyAt`，否则 `status='grading'`；`totalScore` 为 item 分数和，`maxScore` 为全部 SchemaUse `maxScore` 之和。状态一旦 `ready`，`submitGradingResult` 抛 `GRADING_COMPLETED`。

`getReport`（`index.ts:601`）要求 `status === 'ready'`（否则 `GRADING_NOT_COMPLETED`）且已结算（否则 `GRADING_NOT_SETTLED`），返回 `buildSubmissionReportMarkdown` 生成的 Markdown 与仅含 `kind === 'static'` 的资源。

`buildGradingInput`（`index.ts:775`）为每个 `SubmissionSchemaUse` 生成统一评分输入：复制 `submission.meta`、`schema`、`inputs`，按 `answer.stringAnswerIndex` 取 `answers.strings`（缺失为 `null`），按 `answer.audioAnswerIndex` 取音频并附 `durationMs`；资源集合来自 `gradingResourceKeys`（扫描 inputs 与 fixed-speech 文本里的 `resource:<key>` 引用，加上音频作答的 `resourceKey`），缺失资源或缺失音频作答索引抛 `INVALID_STORAGE`。人工、AI 与客观题引擎都消费同一 `GradingInput`。

`buildSubmissionReportMarkdown`（`index.ts:809`）输出顺序为：标题（考生名 - 试卷名）、考生信息表（姓名/学号/试卷名称/总分/作答时间）、`## 分数概览` 逐题分数表，然后每题一个 `## 第 N 题` 段落，含题目、分数、评语；客观题附正确答案/学生答案/正误与可选解析，主观题附参考答案、逐条学生答案（文本或“录音 时长”）与评分标准。姓名与试卷名经 `escapeInline`/`escapeTable` 转义，时间用 `Intl.DateTimeFormat('zh-CN')` 格式化。

## 存储与格式

物理路径由 file-store 的 scope 展开，文本在 `.text/`、二进制在 `.assets/`（`packages/file-store/src/shared/constants.ts`）：

- `submissions/<sha256(submissionId)>/record.json`
- `submissions/<sha256(submissionId)>/package-<sha256(归档)>.lssubmission`
- `submissions/<sha256(submissionId)>/grading.json`
- `settlements/index.json`

`record.json`（`SubmissionLibraryRecord`）字段：`formatVersion: 1`、`submissionId`、`examPackageId`、`examTitle`、`candidateId`、`candidateName`、`startedAt`、`submittedAt`、`importedAt`、`archiveSha256`、`archiveBytes`、`schemaUseCount`；读取时逐字段校验（`isSubmissionLibraryRecord`）。

`grading.json`（`SubmissionGradingRecord`）字段：`formatVersion: 1`、`submissionId`、`status: 'grading' | 'ready'`、`items: [{instanceId, engine: 'objective'|'human'|'ai', result: {score, comment}, gradedAt}]`、`aiRuns: SubmissionAIGradingRun[]`、`totalScore`、`maxScore`、可选 `readyAt`。`normalizeGradingRecord` 兼容旧格式：接受 `status: 'completed'` 与 `completedAt`，并据此回填 `readyAt`；同时校验 item 与 SchemaUse 对齐、客观题 item 必须等于重算结果、重复 instanceId 与超上限分数一律 `INVALID_STORAGE`。

`SubmissionAIGradingRun` 字段：`instanceId`、`status: 'processing'|'succeeded'|'failed'`、`speechRecognitionModel {providerId, modelId}`、`textModel`、`answers: [{answerId, description, transcript, correction, referenceText?}]`、可选 `prompt`/`rawResponse`/`result`/`error`、可选 `review {mode:'none'|'all'|'sample', selected, reviewed, finalResult?}`、`updatedAt`。形状约束：`succeeded` 必须有 `result` 与 `rawResponse` 且无 `error`；`failed` 必须有非空 `error`；`processing` 不得有 `result` 或 `error`；`review.reviewed === true` 蕴含 `selected === true` 且存在 `finalResult`。

`settlements/index.json`（内部 `SubmissionSettlementIndex`）字段：`formatVersion: 1`、`batches: [{formatVersion:1, batchId, settledAt, records: [{submissionId, totalScore, maxScore}]}]`；校验 batchId 唯一、每条 `submissionId` 全局唯一、`0 <= totalScore <= maxScore`，且 batch 不允许空 `records`。

## 失败与恢复

`SubmissionLibraryError` 枚举（`index.ts:228`）及触发条件：`INVALID_ARCHIVE`（非二进制或解码失败）、`INVALID_STORAGE`（记录/评分/index 结构非法、归档缺失或 sha 不匹配、并发更新、scope 键冲突）、`SUBMISSION_ID_CONFLICT`（同 ID 不同内容）、`NOT_FOUND`（记录或评分单元不存在、空白 ID）、`INVALID_GRADING_RESULT`（分数非有限、越界、评语非字符串；客观题走人工/AI）、`GRADING_RESULT_LOCKED`（该 instanceId 已存在 item）、`GRADING_COMPLETED`（记录已 `ready`）、`GRADING_NOT_COMPLETED`（报告时未 ready）、`GRADING_NOT_READY`（结算时未 ready 或未给 ID）、`GRADING_NOT_SETTLED`（报告时未结算）、`ALREADY_SETTLED`（startGrading 或结算重复提交）、`SETTLEMENT_CONFLICT`（index CAS 失败）。renderer 的 `submissionUi.ts` 把每个 code 映射为中文提示。

`settleSubmissions(submissionIds)`（`index.ts:443`）语义：去重后若为空或含空白 ID 抛 `GRADING_NOT_READY`；在全局 `__settlements__` 互斥段内先**整体校验**所有 ID（已结算 → `ALREADY_SETTLED`；归档或评分缺失/未 ready → `GRADING_NOT_READY`），全部通过后才构造 `{batchId: crypto.randomUUID(), settledAt: ISO, records}` 并以 CAS 追加；任何校验失败都不会产生部分批次。`writeSettlementIndex` 以 `compareAndSwapText` 写入，失败统一抛 `SETTLEMENT_CONFLICT`。

`resetGrading`（`index.ts:408`）删除 `grading.json`，并把该 `submissionId` 从所有批次移除（移除后空批次被丢弃）；若结算写盘失败，用 CAS 恢复原 `grading.json`，恢复失败抛 `INVALID_STORAGE`。`deleteSubmission`（`index.ts:384`）先在同一互斥段内更新结算 index，再 `scope.clear()` 删除整目录；`clear` 失败会回滚 settlements。`exportArchive` 校验归档存在且 `sha256` 与记录一致后才返回字节。

并发：`runMutation`（`index.ts:711`）按 `storageKey` 维护 promise 尾链串行化同一作答的导入、删除、评分、重置；结算使用保留键 `__settlements__`。`writeGrading` 在写前重读并比较现有记录，不一致即 `INVALID_STORAGE`。

AI 失败恢复：单条评分单元异常时仍写入 `status:'failed'` 的运行记录（含 `error`），renderer 收集 `failures` 并显示“重试失败题目”；`runAI` 会跳过模型选择相同且已 `succeeded` 的单元，保留未完成单元继续执行。抽查/审查：`persistReviewPlan` 写入 `review`，审查确认后 `submitGradingResult(..., 'ai', {score, comment})` 并把 `review.reviewed=true` 且 `finalResult` 设为最终分。

AI 会话在 renderer 是显式阶段机 `configure | running | decision | sample | review | submitting`（`SubmissionGradingPage.tsx:412`）：`decision` 提供“完成 / 全部审查 / 抽查”三条路径；`sample` 的规则由 `createReviewSamplingRules` 生成 `total`（默认 1）与 `schema`（默认 0）两组，`selectReviewSamples` 用 `crypto.getRandomValues` 做 Fisher-Yates 抽样并把数量夹到 `[0, 组内题数]`；审查分数经 `validReviewedScore` 限制为 0..maxScore 且最多三位小数。

`listEntries` 的评分摘要字段为 `gradedCount = grading.items.length`、`totalCount = schemaUses.length`、`totalScore`、`maxScore`、可选 `readyAt`；`buildResources` 依据 `entry.packagePath.startsWith('recordings/')` 把资源标记为 `recording`，否则为 `static`（`index.ts:971`）。

归档文件名固定为 `<dataDir>/submission-library/submissions/<sha256(submissionId)>/package-<sha256(归档)>.lssubmission`（`archiveFilename`，`index.ts:1329`）；导出时重新计算 `sha256` 与记录的 `archiveSha256` 比对，不一致即 `INVALID_STORAGE`。

## 运维入口

renderer 路由（`packages/renderer/src/app/register-placeholder-routes.ts`）：`/submissions`（作答记录）、`/submissions/grading?submissionId=...`（批量选择）、兼容旧路径 `/submissions/:submissionId/grade`、`/submissions/settlement?submissionId=...`。作答记录页分“未结算 / 已结算”两个 tab，未结算列表可全选后“开始评分”，已结算按批次分组，提供查看报告、重新评分、导出与删除。

主流程：`导入作答包`（`fileDialog.readBinary`，filter `lssubmission`/`zip`）→ `importArchive` → 选择人工或 AI 评分（`GradingModeChooser`；若预检时全部 `ready` 则直接跳转结算）→ 评分完成后进入 `SubmissionSettlementPage`，仅对“未结算且 ready”的条目调用 `settleSubmissions`，成功后跳转 `/submissions?view=settled&batchId=...` 并展开对应批次。

重新评分入口在已结算批次内“重新评分”按钮，确认文案说明“现有评分、结算结果和报告将被删除”，调用 `resetGrading` 后把视图切回 `view=unsettled`。报告只在 ready 且已结算时可查看（`getReport`）。导出文件名由 `submissionExportName(candidateId, submittedAt)` 生成，对 `\/:*?"<>|` 做替换。

数据修复手段：直接检查对应 scope 的 `.text/record.json`、`.text/grading.json`、`.assets/package-*.lssubmission` 与 `settlements/.text/index.json`；sha 不匹配或结构非法时仓储以 `INVALID_STORAGE` 拒绝读取，可通过重新导入同一 `.lssubmission`（幂等）或 `resetGrading`（删除评分与结算归属）恢复；删除整条记录用 `deleteSubmission`。

## 代码依据

- `packages/submission-library/src/index.ts`
- `packages/submission-library/src/__tests__/repository.test.ts`
- `packages/grading-engine/src/index.ts`
- `packages/grading-engine/src/__tests__/engine.test.ts`
- `packages/core-types/src/submission.ts`
- `packages/exam-package/src/index.ts`
- `packages/file-store/src/main/storage.ts`
- `packages/file-store/src/shared/constants.ts`
- `packages/renderer/src/features/submissions/SubmissionLibraryRuntime.ts`
- `packages/renderer/src/features/submissions/SubmissionLibraryPage.tsx`
- `packages/renderer/src/features/submissions/SubmissionGradingPage.tsx`
- `packages/renderer/src/features/submissions/SubmissionSettlementPage.tsx`
- `packages/renderer/src/features/submissions/SubmissionAIRouterAdapter.ts`
- `packages/renderer/src/features/submissions/reviewSampling.ts`
- `packages/renderer/src/features/submissions/submissionUi.ts`
- `packages/renderer/src/__tests__/SubmissionGrading.test.tsx`
- `packages/renderer/src/__tests__/SubmissionAIRouterAdapter.test.ts`
