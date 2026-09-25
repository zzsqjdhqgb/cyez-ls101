<!--
status: implemented
product-version: 0.4.1
audience: engineer
owner: secret-store
-->

# 加密密钥存储（Secret Store）

`@ls101/secret-store` 在 Electron main 进程中提供作用域化的字符串密钥存储：密钥用 Electron `safeStorage` 加密后作为二进制文件写入业务数据目录。当前只有 AI Router 的 Provider 使用它保存 API Key。

## 功能状态

已实现并接入：

- `EncryptedSecretStorage` 提供逐层派生的 scope、`read` / `write` / `delete` / `clear`，以及 scope 与 key 的路径校验。
- `createElectronSecretStorage(baseDir)` 用 Electron `safeStorage` 构造编解码器。
- 文本、图像、语音合成和语音识别 Provider 分别使用独立的 secret scope 保存 API Key。
- 密钥文件随可配置 `dataRoot` 一起参与数据目录迁移。

没有 renderer 或 preload 入口：`packages/secret-store/package.json` 只导出 `./main` 和 `./shared`，preload 不暴露 secret IPC，renderer 无法直接读写密钥。

## 功能边界

负责：scope 派生、字符串密钥的加密读写与删除、单文件原子替换、scope / key 命名校验。

不负责：普通配置数据（由 `@ls101/config-store` 以明文 JSON 保存）、密钥轮换或版本化、跨机器迁移时的重新加密、密钥访问审计、用户界面、安全存储不可用时的降级。许可证邀请码也不经过本模块，它由 `src/main/license-service.ts` 以哈希形式写入 `userData/license.json`。

## 公共接口

```typescript
// packages/secret-store/src/shared/types.ts
type SecretScope = readonly string[]

interface SecretStorage {
  scope(name: string): ScopedSecretStorage
}

interface ScopedSecretStorage {
  scope(name: string): ScopedSecretStorage
  read(key: string): Promise<string | null>
  write(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  clear(): Promise<void>
}
```

```typescript
// packages/secret-store/src/main/index.ts
interface SecretCodec {
  encrypt(value: string): Uint8Array
  decrypt(value: Uint8Array): string
}

function createElectronSecretStorage(baseDir: string): EncryptedSecretStorage
```

`@ls101/secret-store/main` 导出 `EncryptedSecretStorage`、`createElectronSecretStorage`、`SecretCodec` 类型和上述 shared 类型；`EncryptedSecretStorage` 的构造函数接受任意 `SecretCodec`，测试与自定义场景用它注入非 `safeStorage` 的编解码器。

scope 和 key 都必须是 `^[a-zA-Z0-9_-]+$`，且不能是 `.` 或 `..`；违规时抛出 `密钥存储作用域无效`；`write()` 还要求值为字符串，否则抛出 `TypeError('密钥值必须是字符串')`。

## 存储与加密

- 加密后端是 Electron `safeStorage`：`encryptString(value)` 得到 `Buffer`，`decryptString(Buffer.from(bytes))` 还原。
- `createElectronSecretStorage()` 在构造时检查 `safeStorage.isEncryptionAvailable()`；不可用时抛出 `Error('Windows 安全存储不可用')`，不返回降级实现。
- 文件路径为 `<baseDir>/secrets/<scope...>/<key>.bin`。调用方 `registerAIRouter({ baseDir: dataDirectory })` 传入的 `dataDirectory` 是当前解析出的可配置 `dataRoot`（默认 `userData/data`），因此密钥实际位于 `<dataRoot>/secrets/...`。
- 每个文件写入流程：在目标目录创建 `.secret-store-<uuid>.tmp`（`open(..., 'wx', 0o600)`）、写入全部字节并 `fsync`、关闭，再用同目录 `rename` 原子替换目标。任一步骤失败都会删除临时文件；进程在删除前被杀可能留下临时文件。
- scope 派生只追加 segment，不接受组合路径；`clear()` 递归删除 `<baseDir>/secrets/<scope...>` 整个目录。

当前加密范围只有 Provider 的 API Key 字符串。Provider 名称、Base URL、模型列表、角色路由等仍在 `config/airouter/*.json` 中以明文保存，见 [`ai-router.md`](./ai-router.md)。四个调用方的 scope 如下：

| 调用方                                                  | secret scope                            | key              | 配置位置                                            |
| ------------------------------------------------------- | --------------------------------------- | ---------------- | --------------------------------------------------- |
| 文本 Provider（`AIRouterService`）                      | `airouter`                              | Provider 配置 id | `config/airouter/providers.json`                    |
| 图像 Provider（`AIRouterImageService`）                 | `airouter/image-providers`              | Provider 配置 id | `config/airouter/image-providers.json`              |
| 语音合成 Provider（`AIRouterSpeechService`）            | `airouter/speech-providers`             | Provider 配置 id | `config/airouter/speech-providers.json`             |
| 语音识别 Provider（`AIRouterSpeechRecognitionService`） | `airouter/speech-recognition-providers` | Provider 配置 id | `config/airouter/speech-recognition-providers.json` |

本地运行的语音 Provider（`kind: 'local'`）不写密钥，保存配置时会删除同 id 的旧密钥。

## Linux 明文回退与集成测试门

`src/main/index.ts` 在注册应用服务之前设置回退：

```typescript
const isLocalIntegrationTest =
  process.env['LS101_INTEGRATION_TEST'] === '1' &&
  (!app.isPackaged || app.getVersion().includes('-local.'))

if (process.platform === 'linux' && isLocalIntegrationTest) {
  safeStorage.setUsePlainTextEncryption(true)
}
```

门条件要求同时满足：环境变量 `LS101_INTEGRATION_TEST=1`，且应用未打包或版本号包含 `-local.`。因此版本号不含 `-local.` 的正式打包版本即使带有该环境变量也不会启用明文回退。该调用发生在应用服务注册之前，此时 `safeStorage` 已随 `app.whenReady()` 可用。

按 Electron 39 类型声明，`setUsePlainTextEncryption(true)` 只在 Linux 生效，作用是当当前桌面环境无法确定有效的 OS 密码管理器时，改用内存口令生成加解密用的对称密钥；在 Windows 和 macOS 上是 no-op。`tests/integration/support/electron-app.ts` 启动被测应用时额外传入 `--password-store=basic`，与这个门共同构成集成测试环境下的无 keyring 路径。生产 Linux 环境仍依赖可用的 keyring（Electron 的 `gnome_libsecret` / `kwallet` 等后端），否则 `isEncryptionAvailable()` 为 false。

## 数据语义与错误

- `read()` 在文件不存在（`ENOENT`）时返回 `null`；其他文件系统错误和解密错误向上抛出。
- 空字符串是合法值：`write(key, '')` 后 `read()` 返回 `''`。AIRouter 用 `read(...) !== null` 判断是否已保存密钥，因此空字符串会被算作「已有 API Key」。
- `delete()` 对不存在的文件保持成功；`clear()` 对不存在的 scope 也是幂等的。
- `clear()` 当前没有生产调用点，Provider 删除只按 id 调用 `delete()`。
- 没有跨文件事务、没有并发串行化：单文件替换是原子的，但多个并发写同一 key 是最后完成者生效；并发 `delete()` 与 `write()` 可能交叉。

失败模式：

| 场景                                                               | 行为                                                                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 文件或 key 不存在                                                  | `read()` 返回 `null`                                                                                                                                                   |
| 普通模式下 OS keyring 不可用                                       | `createElectronSecretStorage()` 抛错 → AIRouter 构造失败 → `registerApplicationServices()` 抛错 → 启动失败（`dialog.showErrorBox` 后 `app.exit(1)`），无降级或恢复路径 |
| 密钥 blob 解密失败（keyring 变化、文件损坏、复制到其他机器或用户） | `safeStorage.decryptString()` 抛错，向上传播到发起读取的 IPC 调用；列表 Provider 时会因为逐个读取密钥失败而整体失败                                                    |
| scope / key 非法                                                   | 抛出 `密钥存储作用域无效` / `密钥存储键名无效`                                                                                                                     |
| 写入值不是字符串                                                   | 抛出 `TypeError`                                                                                                                                                       |
| 写入中途失败                                                       | 临时文件被清理，旧目标文件保持不变                                                                                                                                     |

由于 `isEncryptionAvailable()` 只在启动构造时检查一次，运行期间 keyring 失效不会被转换为「密钥不可用」状态，而是以解密异常的形式暴露。

## 迁移

本模块没有自己的迁移、版本号或重新加密逻辑。密钥文件位于 `dataRoot/secrets/` 下，因此数据目录迁移会按普通文件复制它（见 [`data-directory.md`](./data-directory.md)）；复制不会改变加密方式，能否解密仍取决于同一 OS 用户下的 `safeStorage` 密钥材料。

## 验证覆盖

- `packages/secret-store/src/__tests__/storage.test.ts`：用假 codec 验证加密字节落盘、物理路径、非 Windows 下 `0600` 权限、scope 清理和路径穿越拒绝。
- `packages/airouter/src/__tests__/`：多个服务测试用 `EncryptedSecretStorage` 加假 codec 验证 Provider 密钥的保存、读取、删除与 `hasApiKey`。
- 未覆盖：真实 `safeStorage` 的加解密、keyring 不可用时的启动失败路径、解密失败、并发写同一 key、跨机器或跨用户复制。

## 已知限制 / 未决

- `createElectronSecretStorage()` 的异常文案固定为 `Windows 安全存储不可用`，在 Linux 和 macOS 上同样会抛出这条与平台不符的消息。
- 没有 renderer 入口是当前设计：AIRouter 只暴露按 Provider 读取密钥的专用 IPC，已保存密钥默认不回传 renderer。若其他模块需要密钥，必须新增 IPC，不能直接复用本模块。
- 没有密钥轮换、版本化或在数据目录迁移时重新加密；更换 OS 用户、重装系统或换机器后旧 blob 无法解密。
- `safeStorage.isEncryptionAvailable()` 只在启动时求值一次，运行期不再探测。
- `docs/engineering/subsystems/README.md` 把 `secret-store.md` 列为待建立的子系统文档，覆盖同一 `packages/secret-store`；该子系统文档尚未建立，本文只描述特性契约。

## 代码依据

- `packages/secret-store/src/shared/types.ts`
- `packages/secret-store/src/main/storage.ts`
- `packages/secret-store/src/main/index.ts`
- `packages/secret-store/src/__tests__/storage.test.ts`
- `packages/airouter/src/main/service.ts`
- `packages/airouter/src/main/image-service.ts`
- `packages/airouter/src/main/speech-service.ts`
- `packages/airouter/src/main/speech-recognition-service.ts`
- `packages/airouter/src/main/index.ts`
- `src/main/index.ts`
- `src/main/application-services.ts`
- `tests/integration/support/electron-app.ts`
