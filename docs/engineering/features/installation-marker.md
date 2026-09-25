<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: installation-marker
-->

# 安装标记与首次运行状态

## 功能状态

v0.4.1 已实现一个主进程维护的安装标记：每次应用进入主界面时创建或更新 `<userData>/.ls101-installation.json`，记录本次安装的稳定 ID、首次安装版本、上次运行版本，并用其中的 `lastShownReleaseNotesVersion` 保证每个版本的发布说明只弹一次。renderer 通过 `window.appInfo` 的两个 IPC 方法触发写入（见 [`../subsystems/startup-orchestration.md`](../subsystems/startup-orchestration.md)）。

## 功能边界

- 标记只描述“这份用户数据目录经历过哪些应用版本、发布说明展示到哪个版本”，不是许可或防盗版机制；它不参与 `active / not-activated / expired` 判定。
- 写入只发生在 main 进程；renderer 不能指定路径、字段或时间，只能请求“确保存在”和“认领某版本的发布说明”。
- 目前只有 `formatVersion: 1`。读到其它 `kind` 或更高 `formatVersion` 时直接报错，不做降级、迁移或覆盖。
- 同一 `formatVersion` 下未知字段会被保留：更新时以磁盘上的原始对象为底，再覆盖已知字段。已知字段本身仍会按当前实现重写。
- 标记不存在时 `claimReleaseNotesVersion` 报错，不会隐式创建标记；创建标记只能走 `ensureInstallationMarker`。

## 公共接口

`src/main/installation-marker.ts` 导出：

- `INSTALLATION_MARKER_FILENAME = '.ls101-installation.json'`
- `InstallationMarker` 接口（字段见“数据语义”）
- `ensureInstallationMarker(userDataDirectory, appVersion, options?)`：创建或更新标记，返回写入后的 `InstallationMarker`；`options` 只含测试用的 `now()` 与 `createId()`。
- `claimReleaseNotesVersion(userDataDirectory, releaseVersion)`：某个版本首次认领返回 `true`，已认领过返回 `false`，标记缺失时抛错。

IPC 与 bridge（`packages/core-types/src/app-info.ts`、`src/preload/index.ts`）：

| 通道                                   | 参数              | 返回      |
| -------------------------------------- | ----------------- | --------- |
| `app-info:ensure-installation-marker`  | —                 | `void`    |
| `app-info:claim-release-notes-version` | `version: string` | `boolean` |

main 端 handler 在 `src/main/app-info.ts`，把 `app.getPath('userData')` 与 `app.getVersion()` 传给上述函数。renderer 调用点在 `packages/renderer/src/startup-active-application.tsx`：启动阶段 `installation-marker` 调 `ensureInstallationMarker()`，阶段 `release-notes` 用 `latestReleaseVersion`（`packages/renderer/src/features/release-notes/release-notes.ts` 的常量 `'0.4.1'`）调 `claimReleaseNotesVersion()`，返回值决定 `App` 是否在启动时展示发布说明。

## 进程与存储边界

- 路径由调用方给出：生产代码固定为 `path.join(app.getPath('userData'), INSTALLATION_MARKER_FILENAME)`。
- 写入使用同目录临时文件 `"<filename>.<uuid>.tmp"`，以 `0o600` 创建、`sync()` 后 `rename` 原子替换。Windows 上 `rename` 遇到 `EEXIST` / `ENOTEMPTY` / `EPERM` 时先删除目标再重命名；其它平台或其它错误直接抛出。
- 读取先用 `lstat`：目标是符号链接、非普通文件或大于 64 KiB（`MAX_MARKER_BYTES`）时报错，不跟随链接读取。
- `updatedAt` 单调不回退：系统时钟倒退时保留较大的旧 `updatedAt`。
- 没有独立的迁移脚本或备份；标记损坏或版本不受支持时读取失败向上传播。

## 数据语义

标记 JSON（写入时使用 2 空格缩进并追加换行）：

| 字段                           | 类型                   | 含义与规则                                     |
| ------------------------------ | ---------------------- | ---------------------------------------------- |
| `kind`                         | `'ls101-installation'` | 固定判别串；不匹配即格式错误                   |
| `formatVersion`                | `1`                    | 当前唯一支持的版本；其它值报错                 |
| `installationId`               | UUID v4 字符串         | 首次创建时生成，之后保持不变                   |
| `firstAppVersion`              | `app.getVersion()`     | 首次创建标记时的版本，之后不变                 |
| `lastAppVersion`               | `app.getVersion()`     | 每次 `ensureInstallationMarker` 覆盖为当前版本 |
| `createdAt`                    | ISO 8601 字符串        | 首次创建时间，之后不变                         |
| `updatedAt`                    | ISO 8601 字符串        | 最近一次更新时间，不小于 `createdAt`           |
| `lastShownReleaseNotesVersion` | 可选版本字符串         | 最近一次被认领的发布说明版本                   |

`appVersion` 与已有标记中的版本字段只要求：长度 1–256、无首尾空白、无控制字符，允许形如 `0.4.0-local.test` 的非严格 semver 串。时间字段必须是 `Date.parse` 可解析且能被 `toISOString()` 原样还原的字符串，且 `updatedAt >= createdAt`。

全新安装与升级的行为差异：

| 场景                 | `installationId` | `firstAppVersion` | `createdAt` | `lastAppVersion` | `updatedAt`         | `lastShownReleaseNotesVersion` |
| -------------------- | ---------------- | ----------------- | ----------- | ---------------- | ------------------- | ------------------------------ |
| 无标记（全新）       | 新 UUID v4       | 当前版本          | 当前时间    | 当前版本         | 当前时间            | 无                             |
| 已有 v1 标记（升级） | 保留             | 保留              | 保留        | 覆盖为当前版本   | 取 `max(now, 旧值)` | 保留                           |
| 认领发布说明         | 不变             | 不变              | 不变        | 不变             | 不变                | 设置为认领版本                 |

错误信息（均为中文 `Error.message`，会显示在 renderer 的启动失败页）：

- `当前安装标记不存在`：标记缺失却请求认领发布说明。
- `当前安装标记无法读取`：JSON 解析失败。
- `当前安装标记不是可识别的普通文件`：符号链接、非普通文件或超过 64 KiB。
- `当前安装标记格式无效或版本不受支持`：`kind` / `formatVersion` / 字段类型 / 时间关系任一不合法。
- `应用版本号无效，无法写入安装标记` 与 `当前时间无效，无法写入安装标记`：入参校验失败。

## 验证覆盖

- `tests/main/installation-marker.test.ts`：首次创建（含原子写入无残留临时文件）、升级保留身份与未知同格式字段、时钟回退时不回退 `updatedAt`、发布说明按版本各认领一次且跨更新保留、高版本 `formatVersion` 拒绝覆盖。
- `tests/integration/license.spec.ts`：许可未激活时不写标记，激活并完成旧数据整理后才出现 `kind`/`formatVersion`/版本字段正确的标记。
- `tests/integration/electron-app.spec.ts`：同一用户数据目录重启后发布说明不再弹出。
- `packages/renderer/src/__tests__/ReleaseNotesModal.test.tsx`、`AboutSettingsPage.test.tsx`：展示层对标记派生状态的使用。

## 已知限制 / 未决

- 标记损坏、版本不受支持或磁盘不可写会直接中断启动流程，而不是重建标记；唯一恢复手段是修复或删除该文件后重试（见启动失败页的“重新加载”）。
- 没有“检测到升级”的公共 API；`firstAppVersion !== lastAppVersion` 只能由调用方自行比较，当前没有消费者这样做。
- `lastShownReleaseNotesVersion` 只认版本字符串，不校验发布说明文件是否存在；发布说明内容与 `latestReleaseVersion` 常量在 renderer（`packages/renderer/src/features/release-notes/`），与 main 的 `app.getVersion()` 是两套来源，版本不一致时认领键也随之不同。
- 安装标记只在许可为 `active` 且旧数据整理完成后写入；未激活或停留在迁移页期间不产生标记。

## 代码依据

- `src/main/installation-marker.ts`（创建、读取、校验、原子写入、发布说明认领）
- `src/main/app-info.ts`（IPC 组装与 `userData` / 版本来源）
- `packages/core-types/src/app-info.ts`（通道与 bridge 类型）
- `src/preload/index.ts`（`appInfoBridge`）
- `packages/renderer/src/startup-active-application.tsx`、`packages/renderer/src/features/release-notes/release-notes.ts`（调用点与版本常量）
- `tests/main/installation-marker.test.ts`、`tests/integration/license.spec.ts`、`tests/integration/electron-app.spec.ts`
- `packages/renderer/src/__tests__/ReleaseNotesModal.test.tsx`、`AboutSettingsPage.test.tsx`
