<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: exam-player
-->

# 考试播放器（ExamPlayer）

## 架构

`@ls101/exam-player`（`packages/exam-player`）是纯 renderer 侧的 React 组件库，运行时只依赖注入的 `examBaseUrl` 与 `fetcher`，不直接访问文件系统或主进程。公共入口 `src/index.ts` 导出 `ExamPlayer`、`ExamPageView`、`loadExam`、`resourceKey`、`ExamLoadError`、`assembleSubmission`、`SubmissionAssemblyError` 及其类型。

分层位置：Template Compiler 产出 `ExamPackage`（`packages/core-types/src/exam.ts`），`@ls101/exam-package` 负责 `.lsexam` ZIP 编解码与 `validateExamPackage`，`@ls101/exam-library` 只负责试卷库存取；播放器本身不解析 ZIP，只通过 `loadExam` 以 HTTP GET 语义读取 manifest 与资源。作答装配结果再交给 `@ls101/exam-package` 的 `collectSubmissionPackageFiles` / `encodeSubmissionPackage` 编码为 `.lssubmission`。

关键模块：`src/ExamPlayer.tsx`（阶段状态机、时间线执行、录音、归档触发）、`src/ExamPageView.tsx` 与 `src/ChoiceView.tsx`（Shadow DOM 渲染与选择题作答）、`src/loading.ts`（`loadExam`、`resourceKey`）、`src/submission.ts`（`assembleSubmission`）。`ExamPageView` 独立导出，只要求 `page.content`、`step`、`resourceUrls`，可在不启动完整会话的情况下渲染单页。

会话内用 ref 保存跨渲染的会话事实：`candidateRef`、`choiceAnswersRef`、`recordingsRef`、`finishingRef`、`onErrorRef`，使异步录音回调与归档读取不依赖可能过期的 React state；`finishingRef` 同时防止重复提交。

## 运行时与生命周期

`ExamPlayer` 用 `key={examBaseUrl}` 包一层 `ExamPlayerSession`（`src/ExamPlayer.tsx:60`），base URL 变化时整体重置状态。`ExamPlayerProps`（`src/ExamPlayer.tsx:50`）包含 `examBaseUrl`、`fetcher`（默认 `fetch`）、`allowExit`（默认 `true`）、`recordingCueUrls`、`onFinish(archive: Blob)`、`onExit()`、`onError?(Error)`。

阶段联合类型为 `loading | load-error | candidate | microphone | exam | runtime-error | submitting | complete`（`src/ExamPlayer.tsx:28`）。挂载后 effect 调用 `loadExam(examBaseUrl, fetcher)`：成功进入 `candidate`，失败进入 `load-error` 并把错误交给 `reportError`（`src/ExamPlayer.tsx:111`）。`retryLoad` 清空 `loaded`/`loadError` 并自增 `loadAttempt` 重新执行加载 effect。

`candidate` 阶段要求姓名与考生号 trim 后非空，否则显示“姓名和考生号不能为空”；通过后写入 `candidateRef`。仅当 `examData.player.recordingIndices.length > 0` 时进入 `microphone`，否则直接 `beginExam('')`（`src/ExamPlayer.tsx:310`）。

`microphone` 阶段由 `MicrophoneCheck` 驱动：`getUserMedia({audio:true})` 申请权限并 `enumerateDevices` 过滤 `audioinput`，进行 3 秒试录，必须完整回放（`onEnded` 置 `playbackComplete`）后才能“声音正常，开始考试”，回调 `onComplete(deviceId)`。`beginExam` 记录 `microphoneId`、`startedAtRef = new Date().toISOString()`，页面与步骤索引归零并进入 `exam`（`src/ExamPlayer.tsx:327`）。

`exam` 阶段 effect 按 `[pageIndex, stepIndex, retryToken]` 取 `pages[pageIndex].timeline[stepIndex]`，按步骤类型执行（`src/ExamPlayer.tsx:199`）：

- `play`：`resourceKey(step.src)` 查 `resourceUrls`，缺失时报“播放资源不存在”，否则 `new Audio(url)`，`onended` → `advance()`，`onerror` → “音频播放失败”。
- `countdown`：时长 `seconds * 1000`，100ms 间隔更新 `remainingSeconds`（向上取整）与 `progress`，到期 `advance()`。
- `record`：调用 `startTimedRecording`，成功后写入 `recordingsRef.current[step.recordIndex]` 并 `advance()`。

时间线状态通过 `TimelineStatus {kind: 'play'|'countdown'|'record', label, remainingSeconds?, progress?}` 驱动底部状态栏：`play` 只有“正在播放”，`countdown` 显示“准备作答”与剩余秒数/进度，`record` 从“准备录音”切换为“正在录音”。

`startTimedRecording`（`src/ExamPlayer.tsx:928`）先播放可选 `cueUrls.start`，再以 `deviceId ? {deviceId:{exact}} : true` 打开麦克风，`MediaRecorder` 收集 chunks；停止时计算 `durationMs = round(performance.now() - started)`，空 blob 报“录音没有产生音频数据”，随后播放可选 `cueUrls.stop` 并回调 `onComplete({blob, durationMs})`。`exam` 阶段 effect 的依赖包含 `retryToken`，步骤级重试会重新执行当前时间线动作但不会清空已捕获的 `recordingsRef`。`advance` 依次尝试下一步骤、下一页（`stepIndex` 归零），到末尾调用 `finishSubmission()`（`src/ExamPlayer.tsx:176`）。

`finishSubmission`（`src/ExamPlayer.tsx:142`）先置 `phase='submitting'`，调用 `assembleSubmission`，把 `bundle.files` 的 Blob 转为 `Uint8Array`，经 `collectSubmissionPackageFiles`、`encodeSubmissionPackage` 得到字节并包成 `application/x-ls101-submission` Blob，`await onFinish(archive)` 后进入 `complete`。任何异常回到 `runtime-error`，重试标记为 `submission`。

选择题作答由 `answers` state 与 `choiceAnswersRef` 双写：`ChoiceView` 的 radio `onChange` → `onAnswer(choiceIndex, label)`（`src/ExamPlayer.tsx:335`、`src/ChoiceView.tsx:69`）。`ChoiceView` 按 `viewport.mode` 计算可见题页：`focus` 定位到含目标 `choiceIndex` 的页并 `scrollIntoView`，`free` 使用 `initialPage`，`range` 限制在 `startPage..endPage`；多页时渲染上一页/下一页按钮。

整个舞台按 `DESIGN_WIDTH=1200`、`DESIGN_HEIGHT=880` 由 `useViewportScale` 计算 `min(innerWidth/1200, innerHeight/880)` 做等比缩放，并监听 `resize`。退出确认对话框使用 `role="dialog"`、`aria-modal` 与 `aria-labelledby="exam-exit-title"`，文案为“当前考试进度不会生成作答包。”。

## 存储与格式

播放器输入 `ExamPackage`（`packages/core-types/src/exam.ts`）：`format: 'ls101-exam'`、`formatVersion: 1`、`packageId`、`examData {title, player, resources}`、`answerCapturePlan {strings[], audios[]}`、`submissionTemplate`。`player.pages[].timeline` 的元素是 `ResolvedTimelineAction`：`{type:'play'; src}`、`{type:'countdown'; seconds}`、`{type:'record'; duration; recordIndex}`，并可附带 `choiceViewOverrides`（`packages/core-types/src/exam.ts:90`）。资源以 `resource:<key>` URI 引用，`resourceKey` 用 `/^resource:([A-Za-z0-9][A-Za-z0-9_.:%-]*)$/` 提取（`src/loading.ts:69`）。`.lsexam` 是含 `manifest.json` 与各资源 `packagePath` 的 ZIP；播放器只按目录 base URL 拼接路径 GET，不感知 ZIP 结构。

`loadExam`（`src/loading.ts:21`）要求 `examBaseUrl` 以 `/` 结尾，GET `manifest.json`，经 `validateExamPackage` 校验后逐个 GET `examData.resources` 的 `packagePath`；路径解析后必须仍位于 base URL 之下（`resolvePackageUrl`），资源字节为空即失败。返回 `LoadedExam {exam, resources: Record<string,Uint8Array>, resourceUrls: Record<string,string>, dispose()}`；`dispose` 撤销本次创建的全部 object URL。创建 Blob 时 mediaType 优先取 `entry.mediaType`，其次响应 `content-type`，可为空串；`copyArrayBuffer` 按 `byteOffset`/`byteLength` 切片，避免 Blob 持有整个底层 buffer。

输出 `SubmissionPackage`（`packages/core-types/src/submission.ts:23`）字段为：`format`、`formatVersion`、`meta {submissionId, examPackageId, examTitle, candidate {candidateId, displayName}, startedAt, submittedAt}`、`answers {strings: Array<string|null>, audios: Array<{resourceKey, durationMs}>}`、`schemaUses`、`resources`。

`assembleSubmission`（`src/submission.ts:54`）按 `answerCapturePlan` 复制 `submissionTemplate` 并填答案：`strings[capture.stringAnswerIndex]` 取 `choiceAnswers[capture.choiceIndex]`，`undefined`/`null`/`'-'` 归一为 `null`；每条录音生成 `resourceKey = answer-audio-<audioAnswerIndex>`、`filename = recording-<audioAnswerIndex>.<ext>`、`packagePath = recordings/<resourceKey>/<filename>`，扩展名按 mediaType 映射为 `wav/mp3/ogg/m4a/webm`（默认 `webm`）。若 resourceKey 与模板静态资源冲突则报 `INVALID_EXAM_PACKAGE`。返回的 `files` 只包含本次录音，以 Submission resourceKey 为键。`choiceAnswerArray`（`src/ExamPlayer.tsx:1048`）把 `Record<number, ChoiceOptionLabel>` 展开成稀疏数组，长度为最大 choiceIndex + 1，未作答位置保持 `undefined` 再在装配时归一为 `null`。

`validateCaptureEntries` 要求 target 索引是 `[0, entries.length)` 内的整数、source 索引为非负整数，且同一 target 与同一 source 都不得重复出现。

## 失败与恢复

`ExamLoadError`（`src/loading.ts:11`）覆盖：base URL 缺尾斜杠、`manifest.json` 网络失败、清单非 JSON、清单校验失败、资源请求失败（含 HTTP 状态）、资源为空、资源路径越出考试目录。`load-error` 界面提供“重新加载”（重跑 `loadExam`）与可选“退出”。

运行时失败走 `RuntimeFailure {error, retry: 'step' | 'submission'}`。`failStep` 用于单个时间线步骤，`runtime-error` 界面“重试”通过 `retryToken` 自增重跑当前步骤；归档阶段的失败重试标记为 `submission`，直接再次调用 `finishSubmission`（`src/ExamPlayer.tsx:341`）。所有错误都经 `reportError` 转发给 `onError`，宿主回调抛错被吞掉以免覆盖播放器错误态。加载被卸载中断时，晚到的 `loadExam` 结果会执行 `result.dispose()`，避免泄漏 object URL。

`SubmissionAssemblyError`（`src/submission.ts:39`）携带 `code` 与 `details`，枚举为：`INVALID_EXAM_PACKAGE`（`format`/`formatVersion`/`examPackageId`/`examTitle` 不一致、资源键冲突、capture plan 引用未知 `choiceIndex`/`recordIndex`）、`INVALID_SUBMISSION_META`（空 `submissionId`/`candidateId`/`displayName`、非 ISO 时间）、`INVALID_CAPTURE_PLAN`（目标/来源索引非整数、越界、重复）、`MISSING_RECORDING`（缺 `recordIndex`，details 含 `recordIndex`/`audioAnswerIndex`）、`INVALID_RECORDING`（`durationMs` 非有限或为负）。

`validateCapturePlan` 还要求 capture plan 的 `choiceIndex` 出现在 `player.choiceMeta.questions`、`recordIndex` 出现在 `player.recordingIndices`，否则报 `INVALID_EXAM_PACKAGE`。

`isIsoDate` 校验到日历级别（闰年、月日范围、时区偏移范围），不是只做 `Date.parse`。错误展示统一走 `errorDetails`，会拼接 `error.cause.message`（若 cause 是 Error）；麦克风错误由 `microphoneErrorMessage` 按 `DOMException.name` 映射为权限、未检测到设备、设备被占用三类提示。

退出确认对话框文案明确“当前考试进度不会生成作答包”，`allowExit` 控制正式考试中退出入口是否出现；`onFinish` 被宿主拒绝时进入 `runtime-error`（标题“作答归档生成失败”），可重试归档。

## 运维入口

复现一次考试：renderer 路由 `/exams/player`（`packages/renderer/src/app/register-placeholder-routes.ts:107`，`layout: 'immersive'`）挂载 `ExamSessionPage`，URL 查询参数 `packageId`。`ExamLibraryPage` 的“开始考试”导航到 `/exams/player?packageId=<packageId>`。`ExamSessionPage` 从 `examLibraryRepository.exportArchive(packageId)` 取出字节，`decodeExamPackage` 后用 `createLocalExamTransport(archive)` 生成 base URL 与内存 fetcher，再挂载 `<ExamPlayer examBaseUrl fetcher allowExit onExit onFinish>`（`packages/renderer/src/features/exams/ExamSessionPage.tsx:88`）。

`createLocalExamTransport`（`packages/renderer/src/features/exams/localExamTransport.ts`）使用 `https://local-exam.invalid/<encodeURIComponent(packageId)>/` 作为 base，`fetcher` 对 GET 返回 `Response.json(archive.exam)`（manifest）与资源字节（带 mediaType），非 GET 返回 405，未知路径 404；构造时拒绝规范化后冲突、与 `manifest.json` 冲突、查询串/片段/非规范相对路径的资源。

作答落盘由宿主完成：`saveSubmission` 用 `fileDialog.writeBinary` 写 `.lssubmission`，默认文件名 `作答-<ISO 时间（冒号替换）>.lssubmission`，取消保存会抛“需要保存作答包才能完成考试。”并回到播放器错误态。

`.lsexam` 进入播放器的完整链路：`ExamLibraryPage`“导入试卷包”经 `fileDialog.readBinary`（filter `lsexam`/`zip`）调用 `examLibraryRepository.importArchive`，`ExamLibraryRecord` 记录 `packageId`、`title`、`pageCount`、`timelineStepCount`、`resourceCount`、`archiveSha256` 等；“开始考试”只把 `packageId` 放进 URL。播放器从不接触 ZIP 或 `.lsexam` 文件，它只看到 `exportArchive` 解码后的 manifest 与资源，因此任何 manifest 结构问题都先在 `validateExamPackage` 或 `createLocalExamTransport` 暴露。

检查资源释放：`LoadedExam.dispose` 撤销全部 object URL；`ExamPageView` 用 `attachShadow({mode:'open'})` 加内联 `<style data-exam-page-view-styles>`（`ExamPageView.css?inline`）做样式隔离，并通过 `createPortal` 渲染内容。`ExamPageView` 支持 `text`、`image`、`choice-view` 三种 block，choice 的 viewport 优先取 `step.choiceViewOverrides[block.id]`，否则 `block.defaultViewport`。

## 代码依据

- `packages/exam-player/src/index.ts`
- `packages/exam-player/src/ExamPlayer.tsx`
- `packages/exam-player/src/ExamPageView.tsx`
- `packages/exam-player/src/ChoiceView.tsx`
- `packages/exam-player/src/loading.ts`
- `packages/exam-player/src/submission.ts`
- `packages/core-types/src/exam.ts`
- `packages/core-types/src/submission.ts`
- `packages/exam-package/src/index.ts`
- `packages/renderer/src/features/exams/ExamSessionPage.tsx`
- `packages/renderer/src/features/exams/localExamTransport.ts`
- `packages/renderer/src/features/exams/ExamLibraryPage.tsx`
- `packages/renderer/src/app/register-placeholder-routes.ts`
- `packages/exam-player/src/__tests__/ExamPlayer.test.tsx`
- `packages/exam-player/src/__tests__/loading.test.ts`
- `packages/exam-player/src/__tests__/submission.test.ts`
- `packages/exam-player/src/__tests__/ChoiceView.test.tsx`
- `packages/renderer/src/__tests__/LocalExamTransport.test.ts`
