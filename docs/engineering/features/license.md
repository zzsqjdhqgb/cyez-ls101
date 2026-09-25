<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: license
-->

# 激活与许可

## 功能状态

v0.4.1 已实现一套离线、单一邀请码的临时许可：main 进程的 `LicenseService` 校验邀请码并把回执写入用户数据目录，preload 通过固定 IPC 白名单暴露 `window.license`，renderer 在激活页收集邀请码、在设置页提供反激活入口。许可状态只有 `active`、`not-activated`、`expired` 三种，未激活或已到期时应用不进入主界面（见 [`../subsystems/startup-orchestration.md`](../subsystems/startup-orchestration.md)）。

## 功能边界

- 校验对象是**一个**邀请码的 SHA-256 摘要常量，不是账号、设备或服务端签发的许可证。所有用户使用同一邀请码。
- 激活完全离线：`activate` 只在本地比较哈希并写回执，不发起网络请求。
- 回执只保存期望的邀请码哈希和激活时间，不保存邀请码原文，也不含签名、HMAC 或机器标识。
- 到期时间是编译期常量；应用不做在线续期、不做回执刷新。
- 反激活等于删除回执并重启应用，不影响其它数据。
- `docs/license-activation.html` 是随应用分发的意见征集页，由 main 打开（[`docs/README.md`](../../README.md) §4），不属于本能力的数据存储。

## 公共接口

类型与 IPC 通道定义在 `packages/core-types/src/license.ts`：

| 通道 | 方向 | 参数 | 返回 |
| --- | --- | --- | --- |
| `license:get-status` | renderer → main invoke | — | `LicenseStatus` |
| `license:activate` | renderer → main invoke | `invitationCode: string`（运行时按 `unknown` 校验） | `LicenseActivationResult` |
| `license:deactivate` | renderer → main invoke | — | `void`，随后重启应用 |
| `license:open-activation-guide` | renderer → main invoke | — | `void` |

`LicenseStatus = { state: 'active' \| 'not-activated' \| 'expired'; expiresAt: string; activatedAt?: string }`；`LicenseActivationResult = { activated: boolean; status: LicenseStatus; reason?: 'invalid-code' \| 'expired' }`。

main 侧导出（`src/main/license-service.ts`）：`LICENSE_RECEIPT_FILENAME`、`INVITATION_CODE_HASH`、`LICENSE_EXPIRES_AT`、`normalizeInvitationCode()`、`hashInvitationCode()`、`LicenseService`、`LicenseServiceOptions`；`src/main/license.ts` 导出 `registerLicenseHandlers(options)`。`LicenseServiceOptions` 为 `{ storagePath, expectedCodeHash?, expiresAt?, now? }`，三个可选字段供测试注入。

## 进程与存储边界

- 回执路径固定为 `path.join(app.getPath('userData'), 'license.json')`（`src/main/application-services.ts` 的 `createLicenseOptions`）。`userData` 的取值由 Electron 决定，应用不提供迁移该文件的入口。
- 写入使用同目录临时文件 + `rename` 的原子替换，临时文件以 `0o600` 创建并 `sync()`；失败时清理临时文件。读取只用 `readFile`，不做 lock 或跨进程协调。
- 时间在存储层统一为 UTC ISO 8601 字符串；界面用 `Asia/Shanghai` 时区格式化为“北京时间”。
- 回执 JSON：

```json
{
  "schemaVersion": 1,
  "invitationCodeHash": "<64 位小写 sha256 hex>",
  "activatedAt": "2026-08-23T08:00:00.000Z"
}
```

- 默认常量：`INVITATION_CODE_HASH` 是当前分发邀请码的 SHA-256；`LICENSE_EXPIRES_AT = '2026-10-01T15:59:59.999Z'`（北京时间 2026-10-01 23:59:59.999）。更换分发方式时直接替换源码中的摘要常量。
- 本地集成测试覆盖（`src/main/application-services.ts` 的 `createLicenseOptions`）：仅当 `isLocalIntegrationTest` 为真（`LS101_INTEGRATION_TEST === '1'` 且应用未打包或版本号含 `-local.`，见 `src/main/index.ts`）时才读取两个环境变量：
  - `LS101_LICENSE_TEST_CODE_HASH` 覆盖 `expectedCodeHash`；
  - `LS101_LICENSE_TEST_NOW` 覆盖时钟；`Date.parse` 失败时抛 `环境变量 LS101_LICENSE_TEST_NOW 无效`。
  - 集成测试用固定邀请码 `ls101-integration-license`（归一化后 `LS101-INTEGRATION-LICENSE`，SHA-256 `16c045fa7aa104ef6ed25f446f830a995336d69888c122d2f8412be299b2448e`）和固定时钟 `2026-08-23T08:00:00.000Z`，定义在 `tests/integration/support/electron-app.ts`。

## 数据语义

- 归一化：`normalizeInvitationCode()` 只做 `trim().toUpperCase()`；因此大小写和首尾空白不敏感，中间空白、全角字符不敏感化。
- 比较：对归一化后的字符串取 SHA-256 hex，与 `expectedCodeHash` 用 `timingSafeEqual` 比较（长度不等先返回 false）。
- `getStatus()` 先判断当前时间是否**晚于**到期时间：晚于则直接返回 `expired`，不再读取回执。边界时刻（`now === expiresAt`）仍为 `active`。
- 回执有效需同时满足：`schemaVersion === 1`、`invitationCodeHash` 与期望哈希恒定时间相等、`activatedAt` 可被 `Date.parse` 解析、且 `activatedAt <= 到期时间`。任一不满足都视为 `not-activated`。
- `activate()` 先判到期；再拒绝非字符串、长度大于 256 或哈希不匹配的输入并返回 `reason: 'invalid-code'`；成功后写回执并返回 `activatedAt`。
- 读取时 `ENOENT` 与 JSON `SyntaxError` 都视为“没有回执”（`null`）；其它读取错误向上抛出。

## 验证覆盖

- `tests/main/license-service.test.ts`：归一化与只存哈希、到期边界、损坏/无关回执、反激活幂等。
- `tests/main/license.test.ts`：意见征集窗口的沙箱配置与导航限制、反激活删除回执并在回复后重启。
- `tests/integration/license.spec.ts`：未激活时只显示激活页且不写安装标记、错误邀请码提示、成功激活、固定时钟越过截止时间后只显示到期页、重启后复用回执。
- `packages/renderer/src/__tests__/LicenseActivationPage.test.tsx`、`LicenseSettingsPage.test.tsx`：错误提示、意见征集入口、反激活确认与失败保留。
- `tests/integration/electron-app.spec.ts` 校验 `window.license` 只暴露 4 个方法。

## 已知限制 / 未决

- **没有机器绑定**。`docs/archive/license-activation-options.md` 里的硬件 ID、账号等方案是征集意见用的候选，均未实现；回执不记录设备指纹，复制 `license.json` 到另一台机器后同样有效。
- 回执没有签名或完整性保护，期望哈希也在发布的 JS 产物中，属于可被本地篡改的离线方案；当前代码把“哈希不匹配的回执”静默降级为 `not-activated`，不报告篡改。
- 邀请码是全体用户共用的单一常量，无法按人吊销；到期时间是硬编码常量，端上时钟被调回也可维持 `active`。
- `deactivate` 成功路径不返回可区分的失败状态：IPC 先回复，100 ms 后 `app.relaunch()` + `app.exit(0)`；`LS101_DISABLE_AUTO_RELAUNCH=1` 可关闭重启（测试用）。设置页在成功路径上不更新 `busy`，因为应用随即重启。
- 除 `ENOENT` 与 JSON 语法错误外，回执读取错误会沿启动阶段抛出，表现为“应用初始化失败”而非“未激活”。
- 意见征集页是随包分发的静态 HTML：窗口内导航只允许同一文档（忽略 hash），`window.open` 只把等于 `ACTIVATION_SURVEY_URL` 的链接交给系统浏览器，其余目标一律拒绝。
- UI 文案与逐屏语义以 [`docs/ui/modules/settings.md`](../../ui/modules/settings.md) 为准，本文件不复述。

## 代码依据

- `src/main/license-service.ts`（哈希、校验、回执读写、到期判断）
- `src/main/license.ts`（IPC 注册、意见征集窗口、反激活重启）
- `src/main/application-services.ts`（存储路径与本地集成测试覆盖的组装）
- `src/main/index.ts`（`isLocalIntegrationTest` 判定）
- `src/preload/index.ts`（`licenseBridge` 与 `contextBridge` 暴露）
- `packages/core-types/src/license.ts`（通道与类型契约）
- `packages/renderer/src/features/license/LicenseActivationPage.tsx`、`packages/renderer/src/features/settings/LicenseSettingsPage.tsx`（用户可见状态与文案）
- `tests/main/license-service.test.ts`、`tests/main/license.test.ts`、`tests/integration/license.spec.ts`、`tests/integration/support/electron-app.ts`
- `packages/renderer/src/__tests__/LicenseActivationPage.test.tsx`、`LicenseSettingsPage.test.tsx`
- `docs/archive/license-activation-options.md`（未实现的候选方案，非事实来源）
