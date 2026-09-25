<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: legacy-data
-->

# 旧数据归档与清理（legacy-data）

## 架构

旧数据子系统处理 0.4.0 之前版本留在 Electron `userData` 根目录的业务数据。主进程侧由四个文件组成，共约 1,779 行：

| 文件                                     | 行数  | 职责                                                                         |
| ---------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| `src/main/legacy-data.ts`                | 1,298 | `LegacyDataService`：扫描、迁移日志状态机、清理事务、IPC 注册                |
| `src/main/legacy-data-archive.ts`        | 393   | `createLegacyArchive` / `verifyLegacyArchive`、ZIP 与 manifest、重复文件比对 |
| `src/main/legacy-data-archive-client.ts` | 58    | 把归档操作投递到 worker，并在拿到结果或错误后 `terminate`                    |
| `src/main/legacy-data-worker.ts`         | 30    | worker 入口，按 `create` / `verify` 分派                                     |

接线在 `src/main/application-services.ts:34`：以 `userDataDirectory`、`dataDirectory` 和 `createWorkerLegacyArchiveOperations(workerUrls.legacyData)` 构造 `LegacyDataService`，注册 `legacy-data:*` IPC，并把 `service.hasPendingCleanup` 作为 `isLegacyCleanupPending` 传给数据目录 IPC（`registerDataDirectoryHandlers` 的选项）。worker URL 由 `src/main/application-worker-urls.ts:10` 从 `import.meta.url` 推导。

共享契约在 `packages/core-types/src/legacy-data.ts`：`LEGACY_DATA_CHANNELS`、`LegacyDataStatus`、`LegacyDataInfo`、`LegacyDataBridge`。renderer 侧由 preload 暴露 `window.legacyData`（`src/preload/index.ts:399`），页面是 `packages/renderer/src/features/legacy-data/LegacyDataMigrationPage.tsx`。

相关但独立的机制是 `src/main/data-directory.ts` 的 `legacy-copy` 引导模式：它只从已持久化的 `data-location.json` 读取，属于数据目录迁移，不在本子系统内；概览见 [`../features/data-directory.md`](../features/data-directory.md)。

## 运行时与生命周期

### 触发时机

`packages/renderer/src/startup-application.tsx:75` 在 license 状态为 `active` 之后运行启动阶段 `legacy-data-status`，调用 `legacyData.getInfo()`；从激活页激活成功时也在其 `onActivated` 回调里调用 `getInfo()`。`getInfo()` 会等待 `initialize()`：首次 IPC 调用触发扫描，服务在扫描完成前对外报告 `archiving`（构造时 `status` 的初值，避免数据目录 IPC 抢跑）。只要返回值不是 `none` 或 `cleaned`，renderer 就停在 `LegacyDataMigrationPage`，不加载工作台。

### 状态机

```text
none ──(检测到旧版本标记且扫描到目录)──▶ archiving ──▶ archived ──(用户清理)──▶ cleaning ──▶ cleaned
                                              └──────────────┬──────────────┘
                                                             ▼
                                                           error
```

- `none`：无旧版本标记，或旧版本标记存在但没有任何旧目录（此时删除 `version` 标记）。
- `archiving`：已写迁移日志，正在生成归档。
- `archived`：归档与 manifest 已校验，源目录仍在，等待用户导出或清理。
- `cleaning`：清理事务进行中，带隔离目录与前进步。
- `cleaned`：源目录与 `version` 标记已删除，日志保留。
- `error`：归档或清理失败，错误写入日志的 `error` 字段。

已有迁移日志时的启动恢复（`initializeInternal`）：`archiving` → 继续生成归档；`archived` → 只重新校验归档；`cleaning` → 继续清理；`error` → 直接返回，不自动重试。

### 旧版本检测

检测函数是 `detectLegacyVersionMarker`，判定 `userData/version` 文件（`LEGACY_VERSION_FILENAME = 'version'`）：

- 必须是普通文件、非符号链接、大小不超过 256 字节。
- 内容 `trim()` 后必须匹配 `v?<数字>.<数字>.<数字>[-预发布][+构建]`。
- 只比较数字核心，且必须小于 `FIRST_CURRENT_DATA_VERSION = '0.4.0'`；`0.4.0` 及更高版本不算旧数据。

标记不存在、格式非法或版本不低于 0.4.0 时返回 `null`，状态为 `none`，根目录内容不被扫描。

### 扫描范围

`LEGACY_DATA_DIRECTORIES` 分两类：

- 业务数据（总是归档）：`drafts`、`exams`、`submissions`、`templates`、`grading`。
- 旧版迁移残留（`LEGACY_MIGRATION_RESIDUE_DIRECTORIES`）：`config`、`secrets`、`models`、`extensions`、`template-editor`、`interfaces`、`schema-editor`、`exam-library`、`submission-library`。这些目录曾被已退役的 legacy-copy 迁移复制到新数据目录，根目录中的同名目录与当前数据目录中的副本逐文件比对：内容相同者只记入 `manifest.duplicateFiles`，不进 ZIP；不同或缺失的文件正常归档。

扫描拒绝符号链接和非普通文件，拒绝源目录与当前数据目录相互包含。目录的文件系统身份（`dev` + `ino`）在扫描时记录进日志，归档与清理时都重新核对。

### 归档与清理的边界

- 归档阶段不删除任何源文件。
- 删除只发生在 `cleanup()`，且要求归档重新校验通过、`version` 标记未变、没有新增的旧目录、每个源目录身份未变、内容仍与 manifest 一致。
- 归档 ZIP 保留在 `userData`，不随源目录删除；`exportArchive` 把归档复制到用户选定位置，若目标与归档同路径则直接返回成功。

## 存储与格式

```text
<userData>/version                                  由 0.3.x 应用写入，本子系统只读取并在清理完成时删除
<userData>/legacy-migration.json                    迁移日志（formatVersion: 1）
<userData>/legacy-archives/legacy-<ISO8601>-<uuid>.zip  归档
<userData>/.legacy-archives-deleting-<uuid>/        清理隔离目录（临时）
```

### 归档 ZIP

- 条目路径为 `<源目录名>/<相对路径>`，分隔符统一为 `/`；manifest 固定为 `manifest.json`。
- `LegacyArchiveManifest`：`formatVersion: 1`、`createdAt`、`sourceDirectories[{name,fileCount,sizeBytes}]`、`files[{path,sizeBytes,sha256}]`、`duplicateFiles[...]`。
- 使用 fflate 流式写入；每写一个文件都重算大小与 SHA-256，并与扫描时记录值比对，不一致即中止并删除临时文件。
- 写入到 `<final>.<uuid>.tmp`，`fsync` 后 `rename`。清单最后写入。失败时终止 zip、销毁输出流并删除临时文件。
- `verifyLegacyArchive` 流式解压并重算每个文件的大小与摘要，拒绝重复路径；`manifest.json` 超过 16 MiB 即失败。校验时还会比对 journal 中记录的归档大小/摘要、`createdAt`、各源目录的统计，并拒绝 manifest 未记录的多余文件。

### 迁移日志

`LegacyMigrationJournal` 记录状态与恢复所需信息：`archiveRelativePath`、`archiveSizeBytes`、`archiveSha256`、`sourceDirectories[{name,fileCount,sizeBytes,identity{device,inode}}]`、`versionMarker{version,sizeBytes,sha256,identity}`、清理阶段的 `quarantineRelativePath`/`quarantineIdentity`/`movedDirectories`/`deletingDirectories`/`versionDeletionStarted`、`createdAt`、`error`。

解析 `parseJournal` 严格校验格式版本、状态、时间戳 ISO 形式、来源唯一性与字段类型；`cleaning` 态要求隔离路径匹配 `^\.legacy-archives-deleting-<uuid>$`，清扫/删除进度只能引用已记录的源目录。日志用与归档相同的临时文件 + `fsync` + `rename` 原子写入；Windows 上 `rename` 无法覆盖时，先确认目标存在再 `rm` 后重命名。

### 清理事务

1. 重新校验归档，核对 `version` 标记与“没有新增旧目录”。
2. 创建或复用隔离目录，并把 `state` 置为 `cleaning`、持久化隔离目录身份。
3. 逐个源目录：核对身份与内容后 `rename` 进隔离目录，每移一个就持久化 `movedDirectories`。
4. 再逐个隔离目录：内容校验通过后标记 `deletingDirectories`，然后递归删除；已开始删除的目录在校验时允许缺文件。
5. 删除空的隔离目录，置 `versionDeletionStarted`，删除 `version` 标记，写 `state: cleaned`。

恢复靠日志里的进度字段：已移入隔离目录或已开始删除的目录不会要求源文件仍然存在；隔离目录身份变化、目录内容被替换或出现未知文件时中止清理。

## 失败与恢复

- `handleInitializationError` 把失败写入日志并把状态置为 `error`；若写日志本身失败，错误文本追加“迁移日志写入失败”。`cleanup()` 的异常也会写进 `status.error` 并继续上抛。
- renderer 的 `LegacyDataMigrationPage` 用 `info.status === 'error' || info.error` 显示“旧数据整理失败”与具体消息，并提供“重试”按钮。
- `retry()` 仅在日志状态为 `error` 时把日志重置为 `archiving` 并清空归档/隔离进度，然后重新 `initialize()`；日志为空但 `status` 为 `error` 时也会清掉记忆化的 promise 再跑一次。
- 归档成功后页面显示“旧数据已归档”，提供“导出旧数据”和“清理并继续”。导出前会重新校验归档；清理失败时源目录保持原样。
- 清理期间不改数据目录：`hasPendingCleanup()` 在状态不是 `none`/`cleaned`（包括 `error`）时返回 `true`，数据目录 IPC 的 choose/chooseDefault/resetDefault/migrate/useExisting 都以“请先完成旧版数据归档清理，再更改数据位置”拒绝。
- 并发/竞态保护是尽力而为的：靠扫描时记录的 `dev`/`ino`/大小、归档期间的前后 `lstat` 比对、清理期间逐文件重算摘要，以及“归档后新增目录即中止”的检查。

## 运维入口

IPC（`packages/core-types/src/legacy-data.ts`）：

| 通道                         | 主进程行为                        |
| ---------------------------- | --------------------------------- |
| `legacy-data:get-info`       | 等待初始化并返回 `LegacyDataInfo` |
| `legacy-data:export-archive` | 校验后弹出保存对话框并复制 ZIP    |
| `legacy-data:cleanup`        | 执行清理事务，返回新状态          |
| `legacy-data:retry`          | 重置错误日志并重新初始化          |

- 查看进度/失败原因：读 `<userData>/legacy-migration.json` 的 `state` 与 `error`。
- 核对归档：`<userData>/legacy-archives/` 下的 ZIP 含 `manifest.json`，其 `files` 列出每个条目的相对路径、大小与 SHA-256。
- 手工恢复：源目录仍在时可直接查看；若清理中断，保留日志与隔离目录，重启应用即可续跑。删除日志或 `version` 标记会让应用把这些目录视为不存在，不再归档或清理。
- 验证覆盖：`tests/main/legacy-data.test.ts`（592 行，覆盖全新目录、无标记的伪旧目录、空目录归档、省略业务数据的归档被拒、残留目录去重/变更、归档失败持久化与重试、源目录/版本标记变化后拒绝清理、隔离目录与删除进度恢复、路径越界日志被拒）、`tests/main/legacy-data-archive.test.ts`（107 行）、`packages/renderer/src/__tests__/LegacyDataMigrationPage.test.tsx`（123 行）、`tests/main/data-directory.test.ts` 与 `tests/integration/data-directory.spec.ts` 覆盖开关联动。

## 已知限制 / 未决

- `src/main/data-directory.ts:1007` 在解析 `legacy-copy` 引导记录时引用了 `LEGACY_DIRECTORIES`，该标识符在全仓库既未定义也未导入。对该文件做项目引用构建会报 `TS2304`（仓库根 `tsconfig.node.tsbuildinfo` 记录了该诊断；当前的 `yarn typecheck` 指向只有 `references` 的 `tsconfig.json`，不会构建引用，因此不输出该诊断）。esbuild 转译不做类型检查，缺陷只在磁盘上存在 `mode: 'legacy-copy'` 的 `data-location.json` 时于运行时暴露为 `ReferenceError`。当前代码没有任何调用点会创建该模式，它只用于读取旧版本写下的引导状态。
- 旧数据识别完全依赖根目录的 `version` 标记。标记缺失、内容非法或版本不低于 0.4.0 时，同名旧目录既不归档也不清理，也不向用户提示。
- 归档是手动清理的前置条件，但清理本身没有任何超时或大小上限；归档大小仅受磁盘限制，`manifest.json` 单独限制为 16 MiB。
- 清理完成后 `legacy-migration.json` 保留且状态为 `cleaned`；没有从 UI 删除日志或归档的入口。
- `legacy-data-archive-client.ts` 每次 create/verify 都新建一个 worker，不复用线程。
- `legacy-data-worker.ts` 以 `if (!parentPort) throw ...` 保证 worker 环境；该文件顶层的 `parentPort` 在类型层面是可空的，`tsconfig.node.tsbuildinfo` 记录了对应的 `TS18047` 诊断。

## 代码依据

- `src/main/legacy-data.ts`（服务、状态机、扫描、清理事务、IPC）
- `src/main/legacy-data-archive.ts`、`src/main/legacy-data-archive-client.ts`、`src/main/legacy-data-worker.ts`（归档格式、校验与 worker 卸载）
- `packages/core-types/src/legacy-data.ts`（通道、状态与桥接类型）
- `src/main/application-services.ts`、`src/main/application-worker-urls.ts`、`src/main/data-directory.ts`（注册、worker URL、清理期间的数据目录门禁）
- `src/preload/index.ts`（`window.legacyData`）、`packages/renderer/src/startup-application.tsx`、`packages/renderer/src/features/legacy-data/LegacyDataMigrationPage.tsx`（启动门禁与页面）
- `tests/main/legacy-data.test.ts`、`tests/main/legacy-data-archive.test.ts`、`packages/renderer/src/__tests__/LegacyDataMigrationPage.test.tsx`（验证覆盖）
