<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: exam-package
-->

# ExamPackage / SubmissionPackage 归档

## 架构

`packages/exam-package` 是试卷包与作答包的 ZIP 编解码与 manifest 契约校验层，唯一实现文件是 `packages/exam-package/src/index.ts`。依赖为 `@ls101/core-types`（数据契约）、`@ls101/schema-editor`（`parseSchemaDefinition`、`validateSchemaDefinition`、`deriveSchemaStructureHash`、`SCHEMA_REFERENCE_ANSWER_INPUT_ID`）与 `fflate` 的 `zip`/`unzip`（`packages/exam-package/package.json`）。

职责边界：

- 定义并校验两种 manifest：`ExamPackage`（`format: 'ls101-exam'`、`formatVersion: 1`）与 `SubmissionPackage`（`format: 'ls101-submission'`、`formatVersion: 1`），字段定义在 `packages/core-types/src/exam.ts` 与 `packages/core-types/src/submission.ts`。
- 把 `manifest.json` 与资源文件打成单个 ZIP；解码时校验归档内文件集合与 manifest 资源清单完全一致（不允许缺文件，也不允许未声明文件）。
- 解码时升级旧归档缺少的内置参考答案输入（见"失败与恢复"）。

导出符号：`encodeExamPackage`、`decodeExamPackage`、`encodeSubmissionPackage`、`collectSubmissionPackageFiles`、`decodeSubmissionPackage`、`validateExamPackage`、`validateSubmissionPackage`、`ExamPackageArchiveError`，以及接口 `ExamArchive`（`{ exam, resources }`）与 `SubmissionArchive`（`{ submission, files }`）。

依赖方向：`renderer` / `exam-player` / `exam-library` / `submission-library` → `exam-package` → `core-types`、`schema-editor`。本包不做任何 SHA-256 计算。

## 运行时与生命周期

编码（生成试卷）：

- `packages/renderer/src/features/templates/TemplateExamGeneration.ts` 的 `runGeneration` 在收集完 `compiled.resourceSources` 后调用 `encodeExamPackage(examPackage, resources)`，把返回的 `Uint8Array` 作为生成结果；`exportGeneratedExam` 以 `.lsexam` 扩展名写盘。
- `encodeExamPackage` 先执行 `validateExamPackage`，再用 `resourceFiles` 把资源按 `packagePath` 映射为 ZIP 条目。传入的 resources 键集合必须与 manifest 完全一致：缺键抛 `Missing resource bytes`，多键抛 `Archive contains a file without a manifest resource entry`（`packages/exam-package/src/index.ts:44`、`:743`）。

编码（生成作答包）：

- `packages/exam-player/src/ExamPlayer.tsx` 的 `finishSubmission` 先用 `collectSubmissionPackageFiles(submission, loaded.resources, recordingBytes)` 从考试资源与本次录音中取文件，再调用 `encodeSubmissionPackage`。`collectSubmissionPackageFiles` 按 `submission.resources[key].packagePath.startsWith('recordings/')` 决定取录音还是取考试资源；缺任一资源抛 `Missing ... resource`，传入未被 manifest 引用的录音抛 `Unused recording supplied for SubmissionPackage`（`:69`）。

解码：

- `decodeExamPackage` 返回 `{ exam, resources }`，`decodeSubmissionPackage` 返回 `{ submission, files }`；两者都先 `unzipArchive`，再 `upgradeLegacyArchiveSchemas`，再 validate，最后 `readResources` 按 assetKey 回填字节（`:53`、`:93`）。
- `packages/exam-library/src/index.ts` 的 `importArchive` 与 `packages/submission-library/src/index.ts` 的 `importArchive` 用对应 decode 做导入校验；`packages/exam-player/src/loading.ts` 的 `loadExam` 直接对已解压目录里的 `manifest.json` 调用 `validateExamPackage`，不经过 ZIP。
- `packages/renderer/src/features/exams/ExamSessionPage.tsx` 在 `exportArchive` 取回字节后调用 `decodeExamPackage`，再交给 `createLocalExamTransport`。

## 存储与格式

ZIP 入口固定为 `manifest.json`（`MANIFEST_PATH`），其余条目名等于资源清单里的 `packagePath`。ZIP 由 `fflate.zip` 以压缩级别 6 生成；manifest 用 `JSON.stringify(value, null, 2)` 加尾随换行后以 UTF-8 编码（`:17`、`:825`、`:838`）。

`ExamPackage` 字段：`format`、`formatVersion`、`packageId`、`examData{ title, player, resources }`、`answerCapturePlan`、`submissionTemplate`。`SubmissionPackage` 字段：`format`、`formatVersion`、`meta{ submissionId, examPackageId, examTitle, candidate{ candidateId, displayName }, startedAt, submittedAt }`、`answers{ strings: Array<string | null>, audios: Array<{ resourceKey, durationMs }> }`、`schemaUses`、`resources`。

- 资源条目（`ExamResourceEntry` / `SubmissionResourceEntry`）为 `{ filename, packagePath, mediaType? }`。`filename` 不得含 `/` 或 `\`；`packagePath` 必须安全、URL 规范、不等于 `manifest.json`，且必须以 `/${encodeURIComponent(filename)}` 结尾（`:717`）。
- assetKey 必须匹配 `^[A-Za-z0-9][A-Za-z0-9_.:%-]*$`；逻辑地址写作 `resource:<assetKey>`（`:20`、`:739`）。
- `examData.resources` 与 `submissionTemplate.resources` 只允许 `resources/` 前缀；`SubmissionPackage.resources` 允许 `resources/` 或 `recordings/`（`matchesResourcePathKind`，`:734`）。录音资源必须落在 `recordings/`（`:159`）。
- `answerCapturePlan.strings[{ stringAnswerIndex, choiceIndex }]` 与 `answerCapturePlan.audios[{ audioAnswerIndex, recordIndex }]`：每类中目标索引和来源索引各自唯一，目标索引取值落在 `[0, 该类条目数)`，因此每类索引从 0 连续分配（`isCaptureEntries`，`:675`）。
- `submissionTemplate` 与 `SubmissionPackage` 共用 `SubmissionSchemaUse`：`instanceId` 在包内唯一；`inputs` 必须覆盖 schema 全部 required `templateInputs` 且 `inputId` 不重复；`answers` 的 `answerId` 集合与类型必须与 `schema.structure.answerFormat` 完全一致；`text` 引用 `stringAnswerIndex`，`fixed-speech` 带 `text` 与 `audioAnswerIndex`，`free-speech` 带 `audioAnswerIndex`（`:404`、`:149`）。
- `schemaUses` 中 `inputs[].value` 与 `fixed-speech` 的 `text` 里出现的 `resource:<key>` 必须指向 `resources/` 下的资源（`:213`）。
- 解码边界：最多 10 000 个文件、解压后总计 512 MiB（`MAX_FILES`、`MAX_UNCOMPRESSED_BYTES`），`unzip` 的 `filter` 在超限时截断，随后再判定超限（`:18`、`:844`）。

## 失败与恢复

所有失败统一抛 `ExamPackageArchiveError`（`name = 'ExamPackageArchiveError'`，`:37`），调用方按 message 分类：

- 归档层：非 `Uint8Array`、无法解压、文件过多、解压后过大、重复文件路径、不安全路径（`..`、绝对路径、反斜杠、空段）、缺失资源文件、未声明文件、重复资源路径、非法 UTF-8 JSON。
- manifest 层：格式串/版本号错误、`packageId` 为空、player 结构非法、资源路径种类不符、capture plan/索引非法、SchemaUse 非法。
- 交叉校验（`validateExamPackage`，`:101`）：`submissionTemplate.meta.examPackageId === packageId`、`examTitle === examData.title`；`choiceIndex` 必须存在于 `choiceMeta.questions`；`recordIndex` 必须存在于 `recordingIndices`；`submissionTemplate.schemaUses` 的答案索引必须落在 capture plan 池内。player 侧还要求：至少一页且每页时间线非空、录音时长 `> 0`、`recordingIndices` 无重复且与时间线 `record` 步的 `recordIndex` 集合相等、`play`/`image` 的 `resource:` 键存在于 `examData.resources`、choiceMeta 的 `choiceIndex` 唯一、viewport 的 `choiceIndex`/页码范围有效。
- `validateSubmissionPackage`（`:134`）：`meta.submittedAt >= startedAt` 且两者严格 ISO 8601；音频答案引用的 `resourceKey` 必须存在且位于 `recordings/`；SchemaUse 答案索引不得越出答案池。

旧归档升级（`upgradeLegacyArchiveSchemas` / `upgradeLegacySchemaUse`，`:488`）：仅对能解析且 `questionType !== 'objective'` 的 schema 生效。当缺少 `templateInputs` 中的 `reference-answer`，或旧 schema 的 `data.inputDescriptions` 把 `reference-answer` 当自定义输入时：

1. 补 `{ inputId: 'reference-answer', type: 'text', required: true }`，并用 `deriveSchemaStructureHash` 重算 `structureHash`；
2. 删除 `data.inputDescriptions['reference-answer']`；
3. 若 `inputs` 缺该输入：`fixed-reading` 用全部 `fixed-speech` 答案的 `text` 以换行拼接，否则填入占位常量 `无参考答案`（`:23`、`:534`）。

升级发生在校验之前，因此旧归档可被 `decodeExamPackage` / `decodeSubmissionPackage` 接受，但升级前的原始对象仍会被 `validateExamPackage` 拒绝（见 `packages/exam-package/src/__tests__/archive.test.ts:223`、`:322`）。

## 运维入口

- 判定一份归档是否损坏：用 `validateExamPackage` / `validateSubmissionPackage` 校验已解压的 manifest；或用 `decodeExamPackage` / `decodeSubmissionPackage` 走完整解压校验。
- 修复交叉引用：manifest 是纯 JSON，`manifest.json` 与资源条目一一对应；错误 message 直接指出缺失键（如 `SubmissionTemplate references missing ExamPackage resource: <key>`、`SchemaUse references missing resource: <key>`）。
- 修复旧格式：不需要手工改 schema；重新导入即可由 `upgradeLegacyArchiveSchemas` 补齐 `reference-answer`。
- 归档完整性由上层负责：`exam-library` 的 `exportArchive` 会用 `archiveSha256` 重新校验 ZIP 字节。

## 代码依据

- `packages/exam-package/src/index.ts`（全部导出的编码、解码、校验、升级函数）
- `packages/exam-package/package.json`（`fflate`、`@ls101/schema-editor`、`@ls101/core-types` 依赖）
- `packages/core-types/src/exam.ts`、`packages/core-types/src/submission.ts`（manifest 字段契约）
- `packages/exam-package/src/__tests__/archive.test.ts`（往返、旧归档升级、索引/资源/路径校验）
- `packages/renderer/src/features/templates/TemplateExamGeneration.ts`、`packages/renderer/src/features/exams/ExamSessionPage.tsx`（调用方）
- `packages/exam-player/src/ExamPlayer.tsx`、`packages/exam-player/src/loading.ts`（作答打包与直读目录校验）
- `packages/exam-library/src/index.ts`、`packages/submission-library/src/index.ts`（导入时 decode）
- `docs/archive/refactor/question-type-pipeline-notes.md`（`AnswerCapturePlan` / `SubmissionTemplate` 设计意图，非事实来源）
