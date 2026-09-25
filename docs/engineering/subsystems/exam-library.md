<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: exam-library
-->

# 试卷库（exam-library）

## 架构

`packages/exam-library` 是本地试卷库仓储层，唯一实现文件是 `packages/exam-library/src/index.ts`。它只从 `@ls101/exam-package` 导入 `decodeExamPackage` 与 `ExamPackageArchiveError`；`packages/exam-library/package.json` 声明 `@ls101/core-types` 与 `@ls101/exam-package` 两个 workspace 依赖，但源码未导入 `@ls101/core-types`。

- `ExamLibraryRecord`：`formatVersion: 1`、`packageId`、`title`、`importedAt`、`archiveSha256`、`archiveBytes`、`pageCount`、`timelineStepCount`、`resourceCount`（`:7`）。
- `ExamLibraryStore`：仓储使用的存储抽象，`@ls101/file-store` 的 `ScopedStore` 直接满足；测试用内存实现（`:25`、`src/__tests__/repository.test.ts:70`）。
- `ExamLibraryRepository`：`listRecords`、`getRecord`、`importArchive`、`exportArchive`、`deleteExam`（`:36`）。
- `FileExamLibraryRepository`：文件存储实现，内部 `root.scope('exams')`，并持有 `mutationTails` 做按 key 串行化（`:55`）。`mutationTails` 是实例内的 `Map<string, Promise<void>>`，只串行化同一 renderer 进程内对该实例的调用。
- `ExamLibraryError`：带 `code`（`INVALID_ARCHIVE` / `INVALID_STORAGE` / `EXAM_ID_CONFLICT` / `NOT_FOUND`）与可选 `details`（`:44`）。renderer 的 `examErrorMessage` 按 code 映射为中文提示（`packages/renderer/src/features/exams/examUi.ts:4`）。

依赖方向：`renderer` → `exam-library` → `exam-package`。它只存储原始 ZIP 字节与摘要，不解析考试内容之外的字段。`ExamLibraryContext` 的默认值就是 `ExamLibraryRuntime` 的模块级单例，因此所有页面共享同一个仓储实例与其 mutation 队列（`packages/renderer/src/features/exams/ExamLibraryContext.tsx:5`）。

## 运行时与生命周期

- 单例装配：`packages/renderer/src/features/exams/ExamLibraryRuntime.ts` 执行 `new FileExamLibraryRepository(fileStore.scope('exam-library'))`，由 `ExamLibraryContext` 注入 React 页面。
- 列表：`ExamLibraryPage`、`WorkbenchPage` 调 `listRecords()`；返回按 `importedAt` 降序、再按 `packageId` 降序排序的记录，缺 `record.json` 的 scope 被过滤掉（`:63`、`:73`）。`listRecords` 用 `Promise.all` 并行读取各 scope，`readRecord` 返回 `structuredClone`，调用方改写返回值不会影响存储内容（`:65`、`:176`）。
- 导入：`ExamLibraryPage` 的"导入试卷包"与 `TemplateExamGenerationPage` 的"加入试卷库"调用 `importArchive(data)`，返回 `ExamImportResult`（`{ status: 'created' | 'duplicate', record }`，`:19`）。导入流程为：`decodeExamPackage` 完整解码校验 → 计算 storageKey 与归档 SHA-256 → 进入按 key 串行的 mutation → 写归档 asset → `compareAndSwapText(record.json, null, record)` 建记录（`:90`、`:108`）。UI 用返回记录的 `title` 提示、用 `pageCount`/`resourceCount`/`archiveBytes` 显示列表列（`ExamLibraryPage.tsx:148`）。
- 开始考试：`ExamSessionPage` 用 `exportArchive(packageId)` 取回原始字节，再 `decodeExamPackage` 与 `createLocalExamTransport`。
- 删除：`ExamLibraryPage` 确认后调 `deleteExam(packageId)`，删除该 key 的整个 scope（记录与归档一并移除）；记录不存在时是静默 no-op（`:155`、`:161`）。
- 读取单条：`getRecord(packageId)` 读取并校验记录，`record.packageId` 与查询不一致时抛 `INVALID_STORAGE`（`:80`）。
- 错误展示：`ExamSessionPage` 捕获 `exportArchive` 与后续 `decodeExamPackage` 的异常，经 `examErrorMessage` 显示并允许重试（`ExamSessionPage.tsx:39`）。

## 存储与格式

仓储的根 scope 是 `exam-library`，仓储自身再进入 `exams`；每个试卷放在 `exams/<sha256(packageId)>` 子 scope（`:59`、`:226`）。经 `@ls101/file-store` 落盘后为：

```text
<数据目录>/exam-library/exams/<sha256(packageId)>/.text/record.json
<数据目录>/exam-library/exams/<sha256(packageId)>/.assets/package-<archiveSha256>.lsexam
```

- 文本目录 `.text`、资产目录 `.assets` 由 `packages/file-store/src/main/storage.ts:13` 与 `packages/file-store/src/shared/constants.ts:6` 决定；`file-store` 基目录是当前数据目录（`src/main/application-services.ts:40`）。
- `storageKey = sha256(UTF-8(packageId))`，`archiveFilename = package-<archiveSha256>.lsexam`（`ARCHIVE_EXTENSION = '.lsexam'`），`archiveSha256 = sha256(ZIP 原始字节)`，`archiveBytes = data.byteLength`（`:107`、`:119`、`:227`、`:235`）。哈希统一为 64 位小写十六进制，由 `SHA256_PATTERN = /^[0-9a-f]{64}$/` 约束（`:5`）。
- `record.json` 字段与取值来源：`formatVersion: 1`；`packageId = exam.packageId`；`title = exam.examData.title`；`importedAt = new Date().toISOString()`；`pageCount = exam.examData.player.pages.length`；`timelineStepCount = Σ page.timeline.length`；`resourceCount = Object.keys(exam.examData.resources).length`（`:113`）。
- 记录校验 `isExamLibraryRecord`：`formatVersion === 1`、`packageId`/`title` 非空、`importedAt` 可被 `Date.parse`、`archiveSha256` 匹配 SHA-256、`archiveBytes`/`timelineStepCount`/`resourceCount` 为非负整数、`pageCount` 为正整数（`:210`）。
- 去重：同一 packageId 且归档字节哈希一致时，`resolveExisting` 返回 `status: 'duplicate'` 与既有记录，不重复写盘（`:195`）。哈希不同则抛 `EXAM_ID_CONFLICT`，附 `details.packageId`。
- 写入顺序：先 `writeAsset(archiveFilename(hash), new Uint8Array(data))` 落归档，再 CAS 建 `record.json`；归档文件名只由内容哈希决定，重复导入同一字节会覆盖同一路径（`:127`）。
- `record.json` 是 file-store 的文本文件，内容由 `JSON.stringify` 序列化；`importedAt` 为 `new Date().toISOString()`。`archiveBytes` 是 ZIP 压缩后的字节数，UI 用 `formatBytes` 显示（`ExamLibraryPage.tsx:150`）。
- 归档不做二次压缩或解包，`exportArchive` 原样返回存储字节的副本（`new Uint8Array(data)`）。导入时已由 `decodeExamPackage` 确认 manifest 声明的每个资源都存在于 ZIP 中，仓储不再重复校验包内容。

## 失败与恢复

- `INVALID_ARCHIVE`：`importArchive` 入参不是 `Uint8Array`，或 `decodeExamPackage` 抛错。`ExamPackageArchiveError` 的 message 原样透传，其他异常统一为 `无法解析试卷包`（`packages/exam-library/src/index.ts`）。
- `EXAM_ID_CONFLICT`：相同 `packageId` 已存在，但 `record.packageId` 或 `record.archiveSha256` 与本次不同（`packages/exam-library/src/index.ts`）。
- `NOT_FOUND`：`getRecord`/`exportArchive`/`deleteExam` 的 `packageId` 为空字符串时抛 `试卷包编号不能为空`；`exportArchive` 记录缺失或 `record.packageId !== packageId` 时抛 `试卷包不存在：<id>`（`packages/exam-library/src/index.ts`）。
- `INVALID_STORAGE`：scope 名不匹配 `SHA256_PATTERN`（`试卷存储键无效`）、`record.json` 结构非法（`试卷记录无效`）、同 key 下记录 `packageId` 不一致（`试卷存储键冲突`）、CAS 后记录消失（`试卷记录已消失`）、导出时归档缺失或重新计算的 SHA-256 与 `archiveSha256` 不一致（`试卷包缺失或已损坏`）（`packages/exam-library/src/index.ts`）。
- 并发保护：`importArchive` 与 `deleteExam` 通过 `runMutation(storageKey, ...)` 按 storageKey 串行，前一个操作无论成败都不阻塞后一个；最后一个 tail 完成后从 `mutationTails` 删除（`:179`）。`importArchive` 写入后若 CAS 失败，会读取并发写入的记录：归档哈希不同则删除本次刚写的 asset，返回既有记录或抛冲突（`:133`）。导出前无条件重算 SHA-256，因此损坏的 `.lsexam` 不会被当作有效数据返回（`:148`）。
- 导入失败不会创建记录：解码在任何写盘之前完成（`repository.test.ts:60`）。
- 删除后行为：`deleteExam` 成功清空 scope 后，`listRecords` 不再返回该记录，`exportArchive` 抛 `NOT_FOUND`（`repository.test.ts:48`）。

## 运维入口

- 查找数据：数据目录根由 `src/main/data-directory.ts` 管理，当前值见应用"数据目录"设置；试卷库位于 `<数据目录>/exam-library/exams/`。
- 核对记录：每个 `<64hex>` 子目录的 `.text/record.json` 是唯一元数据来源；`.assets/` 下应恰好有一份文件名等于 `package-<archiveSha256>.lsexam` 的归档。
- 手工修复：删除某个 `<64hex>` 目录等同删除该试卷；`listRecords` 会跳过缺少 `record.json` 的 scope，但遇到结构非法的 `record.json` 会抛 `INVALID_STORAGE`，需修复或移除该目录。把归档放回并保证文件名与 `archiveSha256` 一致即可让 `exportArchive` 通过重算校验。
- UI 入口：试卷库页面的导入/删除；删除会一并移除 `.lsexam` 原始包（`ExamLibraryPage.tsx:172`）。
- 备份/迁移：整个 `<数据目录>/exam-library/` 目录即试卷库全部状态；数据目录迁移由 `src/main/data-directory.ts` 以复制 + 文件清单比对完成，成功后才会切换活动目录。

## 代码依据

- `packages/exam-library/src/index.ts`（全部仓储逻辑、错误码、哈希与路径规则）
- `packages/exam-library/package.json`（`@ls101/exam-package`、`@ls101/core-types` 依赖）
- `packages/exam-library/src/__tests__/repository.test.ts`（导入/去重/冲突/删除/损坏归档）
- `packages/renderer/src/features/exams/ExamLibraryRuntime.ts`、`ExamLibraryPage.tsx`、`ExamSessionPage.tsx`、`examUi.ts`（运行时接入与错误提示）
- `packages/renderer/src/pages/WorkbenchPage.tsx`、`packages/renderer/src/features/templates/TemplateExamGenerationPage.tsx`（列表与导入调用方）
- `packages/file-store/src/renderer/ScopedStore.ts`、`packages/file-store/src/main/storage.ts`、`packages/file-store/src/shared/constants.ts`（`.text`/`.assets` 落盘布局）
- `src/main/application-services.ts`、`src/main/data-directory.ts`（数据目录根）
