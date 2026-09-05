# 机房桌面宿主与构建设计

状态：待审核，尚未实现。沿用[功能设计](./lab-deployment-design.md)中的 renderer 组织业务、main 提供系统能力、服务端独立运行的分工。

## 1. 与现有代码的关系

当前 `electron.vite.config.ts` 是主软件入口，包含 AI 和迁移 worker；`src/preload/index.ts` 暴露主软件能力。机房产品新增独立入口，不直接复用这两份入口后按菜单隐藏。现有 `packages/exam-player`、`exam-package`、`core-types` 和必要文件能力按依赖复用。

当前 `ExamPlayer.tsx` 在完成函数内生成 submission ID，每次保存重试重新组包；`ExamSessionPage.tsx` 的完成回调打开文件保存对话框。机房实现必须把固定身份和自动可靠保存接入播放器；主软件的用户选择保存位置仍由其宿主决定。

## 2. 拟定目录与依赖

| 入口/包                                    | 职责与允许依赖                                                                             |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `apps/lab-student/{main,preload,renderer}` | 学生启动、激活、绑定、练习和本地队列；使用播放器、包编解码、共享契约及窄宿主接口           |
| `apps/lab-teacher/{main,preload,renderer}` | 教师连接、列表与维护流程；本机服务管理仅在此产品注册                                       |
| `packages/lab-server`                      | Node 服务进程、认证、业务、SQLite 与归档；不依赖 Electron、renderer 或播放器 UI            |
| `packages/lab-contracts`                   | 由已审核 OpenAPI 生成的 HTTP 类型及相应运行时校验产物；不含数据库类型或 Electron 类型      |
| `packages/lab-client`                      | 类型化客户端、错误转换、查询参数与操作名称；通过宿主传输接口工作，不保存密码或重试业务状态 |
| `packages/lab-desktop-host`                | 两个桌面入口共用的信任连接、流式传输、本地日志及许可适配；不实现页面流程                   |
| 现有共享包                                 | 播放器、包格式、纯类型、图标和适用的基础控件；按实际 import 复用，不导入主软件根应用       |

构建新增 `electron.vite.lab-student.config.ts`、`electron.vite.lab-teacher.config.ts` 和服务构建配置。产物目录分别为 `out/lab-student`、`out/lab-teacher`、`out/lab-server`，打包配置明确各自 appId、产品名、协议和文件关联；不改主软件 appId 或 userData。学生端包不含服务、SQLite 驱动、AI 模型、编辑器、Playwright 或测试激活参数。

教师包包含服务程序、固定 Node LTS、SQLite 驱动和标准加密备份引擎。Electron 和独立 Node 的原生模块必须分别按对应 ABI 打包验证，不把 Electron 编译的二进制复制给普通 Node。安装目标架构与宿主架构明确匹配；开发容器构建不得依赖只有 Windows `.exe` 的本地工具。

## 3. 宿主接口

以下是设计接口组，具体 IPC 常量在实现时按现有共享类型模式声明。renderer 只能调用命名能力；所有 IPC 校验 sender、主 frame、应用 origin、输入 schema 和当前许可。

| 能力                     | 拟定操作                                                                                | 约束                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `license`                | `getStatus`、`activate`、`onChanged`                                                    | 复用现有激活规则，两个产品和服务共享许可算法；不引入新许可证体系                  |
| `startup`                | `whenReady`、`onCommand`、`acknowledgeCommand`                                          | 命令按单实例入口交付，去重并记录结果；拒绝命令不在激活后自动补执行                |
| `connections`            | `openTrusted`、`close`、`getStatus`                                                     | 输入已保存连接引用或经用户核对的目标；返回 connection ID 和 epoch，不返回原始凭证 |
| `labTransport`           | `request`、`startDownload`、`startUpload`、`cancel`、`onTransfer`                       | operationId 与参数由契约约束；不接受任意 URL、任意 header、任意文件路径           |
| `binding`                | `getSummary`、`applyEnrollment`、`allocateRuntime`                                      | main 保存秘密和代次；先持久化待注册身份，再请求注册；成功后原子替换绑定           |
| `studentRecords`         | `list`、`get`、`saveCompletedArchive`、`compareAndSwap`、`exportSelected`               | main 保证文件与日志提交；导出选择 ID，系统对话框决定目标；不提供学生删除方法      |
| `maintenanceExecution`   | `persistJournal`、`previewHistory`、`deleteConfirmedHistoryItem`                        | 删除要求当前任务/租约及已验证快照；验证成功回执、固定候选和本地维护空闲状态       |
| `examCache`              | `prepare`、`acquire`、`release`                                                         | 仅发布已验证完整缓存，返回受控本地资源 URL，保护当前播放引用                      |
| `localService`（仅教师） | `getStatus`、`initialize`、`start`、`stop`、`setAutostart`、`readLogs`、`restoreBackup` | 只作用本机；提升权限经操作系统机制，不执行 renderer 传来的命令或脚本              |
| `teacherConnections`     | `list`、`save`、`remove`、`authenticate`                                                | 连接记录保存信任指纹；会话令牌只在 main 内存保留，密码不持久化                    |

renderer 管理提交转换和重试策略，main 执行有明确参数的持久操作。main 对修改接口执行版本 CAS，防止多个页面覆盖日志；并不自行决定某异常作答获得自动重试资格。每个传输用 request ID 对应进度和结果，订阅返回取消函数，窗口销毁后停止回调。

大归档不通过一个 IPC 消息完整往返多次：下载直接流入宿主暂存文件；上传引用只读归档句柄。播放器产生 Blob 时通过有界分块写入会话传给 main，完成后由 main 校验摘要并执行本地提交协议；块序号、总大小、句柄所有者都需验证。IPC 中的普通控制 JSON 也限制大小。

## 4. HTTPS、秘密和本机免密

HTTPS 由 main 中的 Node 传输层建立，只接受 HTTPS、固定目标地址与已信任 SPKI 指纹。使用 TLS 自定义证书校验能力在握手阶段固定公钥身份，再发送 HTTP headers/body；不得先发凭证后核对证书，也不得全局禁用证书验证。测试必须证明错误指纹时服务端收不到请求凭证。自动重定向关闭，错误不附带 token 或原始密码。

renderer 不使用浏览器 `fetch` 直接发送管理密码或设备令牌；`lab-client` 构建请求，但 main 根据 connection ID 补凭证。证书续期保持公钥可继续信任，公钥变化进入待管理员核对状态；普通重连和 `/info` 都不能重写信任根。

本机教师首次初始化和免密凭证通过受操作系统权限保护的本地 IPC 获取：Windows 命名管道、Linux Unix domain socket。服务检查对端本机账户授权；教师 main 在该通道取得短期单次本机认证证明，再通过回环 HTTPS 的 `POST /teacher/sessions` 携带 `X-LS101-Local-Authorization`，JSON 为 `{}`。HTTP 服务同时要求实际回环来源、证明有效及允许的宿主 Origin 策略；随机网页即使能访问回环也无法取得证明。证明绑定服务 ID、有效期和单次消费，不记录日志；代理头不作为本机证据。

学生秘密使用宿主 secret-store 或目标系统凭证保护，磁盘明文权限限制作为最低要求；必须验证无人值守学生账户可在重启后解密。服务账户的身份密钥、许可位置、数据目录 ACL 在安装时固定，不能依赖教师交互用户已登录才能运行。

## 5. 播放器通用扩展

拟定在现有 Props 上增加可选的开始前接口与阶段事件，保留主软件宿主使用方式：

```ts
interface PlayerStartContext {
  candidate: SubmissionCandidate
  signal: AbortSignal
}

interface PlayerStartResult {
  submissionId: string
}

interface ExamPlayerHostHooks {
  beforeStart?(context: PlayerStartContext): Promise<PlayerStartResult>
  onPhaseChange?(event: {
    phase: 'preparing' | 'practicing' | 'saving' | 'complete' | 'error'
    submissionId: string | null
    pageIndex: number | null
    stepIndex: number | null
  }): void
  onFinish(archive: Blob): void | Promise<void>
}
```

`beforeStart` 在身份与麦克风检查后调用，成功返回固定 ID 才启动时间线。机房宿主内部完成持久准入、HTTP 请求与最新状态检查；播放器不见 modeRevision、设备或令牌。没有 hook 的主软件也在每次正式开始时只生成一次 ID。退出预检或卸载触发 AbortSignal，迟到许可不得启动；宿主若发现许可过期，在下一次显式开始时分配新 ID。

结束时只固定一次 submittedAt，组包成功后缓存同一归档供 `onFinish` 重试；回调成功只表示宿主定义的本地保存完成。阶段通知异常仅记录，不能破坏播放或保存。不得增加暂停、跳题、返回步骤或崩溃时间线恢复。

## 6. 安装、启动与后台托管

Windows 教师安装器将服务注册到 SCM，使用受限服务账户及固定数据目录权限；Linux 验证环境采用对应 systemd 服务。安装可注册服务但未激活/未初始化时不开放业务；服务运行时同样检查本机许可。服务就绪通过 HTTPS info 与本机控制通道分别报告，不能只看 PID。

教师每次启动激活后显示连接页，选远程不启动本机服务。关闭教师窗口不停止服务；设置开机启动不代表立即启动。启动失败提供脱敏日志和可识别原因（端口占用、目录不可写、schema 不兼容、许可无效），不能自动改端口或创建空库。

学生入口和教师入口分别取得单实例锁；重复启动参数由 main 验证后交付当前应用。无人值守安装、激活命令与入网命令分别记录结果，不以安装成功替代入网成功。忙碌、版本不一致或未激活时明确拒绝入网，文件关联不能绕过这些限制。

升级流程先维护、结束活动练习与任务、备份，再停止服务与桌面进程、安装并运行 schema 升级。失败保持原数据及错误，恢复旧版本必须搭配匹配快照。程序尚未发布，本轮无需为未发布草案设计兼容迁移；正式实现仍需具备将来升级的 schema 版本入口。

## 7. 验证清单

构建检查学生与教师产物依赖清单，独立 Node 服务无需 Electron 可启动；容器验证协议、IPC、基本播放器及应用烟测。Windows 验证 SCM 启停、注销后服务继续、无人值守权限、原生驱动 ABI、证书校验、带前导零编号、保存对话框及麦克风释放。错误公钥、本机证明缺失、恶意 IPC 路径和超大消息都不得进入业务；机房包不得包含任意远程执行或开发测试许可入口。
