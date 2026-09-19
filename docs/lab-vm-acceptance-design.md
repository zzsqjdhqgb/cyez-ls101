# 机房部署 Windows 目标机自动化验收设计

更新日期：2026-09-17。对应分支 `feat/lab-deployment`。本文档定义在一次性 Windows Server 2022 虚拟机中，对教师端/学生端安装产物做操作系统级集成测试的设计。执行结果与尚未取得的证据仍以 [lab-target-acceptance.md](lab-target-acceptance.md) 为准；本文档本身不表示任何功能已经通过验收，M1 的实机结果见第 12 节。

## 1. 目的与范围

### 1.1 为什么需要新套件

现有容器验证覆盖了业务语义，但没有覆盖"托管、传输、多机时序"这三层：

- 服务端单元测试直接调用 handler，或在本进程内监听 `127.0.0.1` 真实 HTTPS。
- `tests/lab/student.spec.ts` 虽然启动真实 Electron 进程，但 `LabService` 跑在 Playwright worker 进程内（`127.0.0.1:0`），服务端与测试运行器共享事件循环、内存、临时目录和生命周期。
- `yarn lab:test:server` 真的拉起了打包后的 `server.cjs` 子进程，但只用本机控制通道，从未向它发过一个 HTTPS 请求。
- 教师端"本机服务"的安装/卸载/启停在 `tests/lab/local-service.spec.ts` 里由 JSON fixture 顶替（`LS101_TEST_SERVICE_MANAGEMENT=1`），真实 UAC/SCM 路径从未执行。
- 全部测试的绑定地址都是 `127.0.0.1`；没有任何一次 `0.0.0.0`、可路由地址、防火墙或第二台主机。

因此 Windows SCM、虚拟服务账户 ACL、命名管道 DACL、session 0 隔离、真实 LAN 可达性、跨进程心跳时序等，都还没有任何证据。

### 1.2 范围

在宿主机编译出教师端/学生端安装产物，在一次性 VM 中完整安装，然后断言：

1. Windows 服务注册、账户、ACL、生命周期与自启动；
2. 客户端与服务端之间真实的 HTTPS 通信、入网、收卷与并发；
3. 已安装产品形态下的 GUI 业务流程；
4. 覆盖安装、卸载与数据保留。

### 1.3 非目标

- 不重复验证已有单测/集成测覆盖的业务语义。
- 不做 Linux systemd 目标机验收（需要另一套 harness）。
- 不做第二台 VM 的真实双机测试（见 §8.1 的扩展入口）。
- 不做断电持久化、真实声卡/耳麦、机房规模压测、学校防病毒/代理 TLS 拦截——这些只能是人工确认项。
- 不为测试修改生产代码：不加入测试专用激活后门、不加入测试专用启动参数。

## 2. 被测对象

| 组件         | 关键事实                                                                                                                                                                                                         |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 教师端安装包 | Windows per-machine NSIS；`resources/lab/windows/teacher.nsh` 的 `customInstall` 同步调用 `$INSTDIR\resources\lab-server\install-windows.ps1`                                                                    |
| 服务运行时   | 打包 Node 24.20.0 x64 + `server.cjs` + `manager.cjs` + WinSW 2.12.0（复制为 `LS101Lab.exe`）；`out/lab-server` 经 `extraResources` 映射到安装目录的 `resources/lab-server`                                       |
| 程序目录     | `%ProgramFiles%\LS101LabService`，版本目录 `releases\<release>-<manifest 摘要前 16 位>`，安装记录 `installation.json`                                                                                            |
| 数据目录     | `%ProgramData%\LS101Lab\data`，日志 `%ProgramData%\LS101Lab\logs`                                                                                                                                                |
| 服务注册     | WinSW XML `resources/lab/windows/LS101Lab.xml`：`startmode=Manual`、启动参数用 `<startarguments>`、停止参数用 `<stoparguments>`、`onfailure restart`、日志 roll-by-size                                          |
| 服务账户     | `sc.exe sidtype LS101Lab unrestricted` + `sc.exe config LS101Lab obj= NT SERVICE\LS101Lab`                                                                                                                       |
| 目录权限     | 关闭继承；SYSTEM 与 Administrators 完全控制；数据目录额外授予服务 SID 修改权限；程序目录额外授予 Users 读取执行                                                                                                  |
| 本机控制通道 | Windows 下为命名管道 `\\.\pipe\ls101-lab-<hmac-sha256('ls101-path', 小写绝对路径)前 32 位十六进制>`；`control.key` 32 字节；AES-256-GCM 双向绑定 AAD；64 KiB 帧上限；默认 30 s、`prepare-upgrade` 30 min         |
| HTTPS        | 初始化后监听 `0.0.0.0:<port>`（默认示例 8443），路径前缀 `/api/v1`；自签 ES256；信任根是 SPKI-SHA-256 指纹 `sha256:<64 hex>`；`maxConnections 256`；并发 handler 上限 64（第 65 个返回 `503 SERVICE_NOT_READY`） |
| 上传         | 单次 PUT，必须有有限 `Content-Length`；并发上限 8，且每设备同时只允许 1 个正式收卷（超出 `429 RATE_LIMITED`）；归档 256 MiB / 解压 512 MiB / 10000 文件；无断点续传                                              |
| 入网         | `.lsjoin` 是 JWS compact（header 仅 `alg`/`typ`/`kid`）；服务端按**整文件字节相等**校验，payload 内的 `enrollmentSecret` 并不单独校验；默认有效期 600 s，按服务端时间判断                                        |
| 凭据         | 教师 `t.<32B base64url>`，8 h，仅存 `sha256(token)`；学生 `d.<deviceId>.<43 字符 base64url>`，服务端仅存 `sha256(secret)`                                                                                        |
| 心跳/租约    | 心跳 5 s，20 s 判定离线；任务租约 30 s，每 5 s 续约                                                                                                                                                              |
| 许可         | `packages/license/src/index.ts` 的 `INVITATION_CODE_HASH` 与 `LICENSE_EXPIRES_AT = 2026-10-01T15:59:59.999Z`                                                                                                     |
| 卸载         | `teacher.nsh` **没有** `customUnInstall`：卸载教师客户端保留服务程序与业务数据；服务卸载只能经教师端的"卸载服务"（`manageLocalService('uninstall')`）                                                            |

## 3. 硬约束

这些约束在动手前必须满足或被显式处理，否则会得到假结论。

### 3.1 宿主机必须使用 Node 24.20.0

`scripts/lab/build-server.mjs` 在 `process.versions.node !== '24.20.0'` 时直接抛错，且只接受 `linux`/`win32`、Windows 下只接受 x64。因此"宿主机编译"的宿主机必须是 **Windows x64 + 恰好 Node 24.20.0**。当前容器是 v24.21.0，不能承担这个构建。

harness 必须在第一步断言版本，不满足时立即停下并提示准备环境，不做任何绕过。

### 3.2 生产包禁用了 Playwright 依赖的开关

`scripts/lab/package-desktop.mjs` 设置了 Electron fuses：`runAsNode: false`、`enableNodeOptionsEnvironmentVariable: false`、`enableNodeCliInspectArguments: false`、`onlyLoadAppFromAsar: true`。而 Playwright 的 `_electron.launch` 正是靠 `--inspect=0` 附着主进程（见 `playwright-core` 中 electron 启动参数 `["--inspect=0","--remote-debugging-port=0", ...]`）。

结论：**Playwright 无法启动已安装的生产包**。GUI 自动化改用 `chromium.connectOverCDP`。

附带影响：`packages/lab-desktop-host/src/commands.ts` 把 `--remote-debugging-port=` 限定为 `development` 才放行，打包态传入会被判为未知参数。由于 `desktop.ts` 在 134 行创建窗口、793 行才解析首次 argv，错误事件一定会送达 renderer。因此"启动参数无效"提示是**确定性行为**，可以稳定断言，不是偶发噪音。

### 3.3 激活与许可证时限

生产代码没有测试后门，激活码必须由部署方提供真实值。约定：

- 邀请码只放在 `infra/windows-vm/config.local.json`（已 gitignore）。`validateConfig` 只逐个校验已知键、不拒绝未知键，因此新增 `InvitationCode` 无需改代码。
- 服务端激活走标准输入：`server.cjs activate --data-dir …` 从 stdin 读 JSON，码**不出现在命令行**。
- 学生端按产品设计走 `LabStudent.exe --activate <code>`，码必然在 argv 中；因此必须补充扫描，断言邀请码、管理密码与一次性证明没有出现在日志、`last-command-results.json`、`acceptance.log` 与宿主机结果 JSON 中。
- `LICENSE_EXPIRES_AT` 为 2026-10-01。harness 在激活前先断言 guest 时钟落在有效期内，否则以专用错误码停下——否则一台时钟不对的 VM 会被误报成产品缺陷。

### 3.4 没有局域网发现协议

全仓库没有 mDNS/SSDP/UDP/广播/组播。地址来源完全是带外提供：教师端手工填 `baseUrl` + 指纹，学生端由 `.lsjoin` 携带 `baseUrl`。方案不得假设任何发现协议。

### 3.5 安装器不开放防火墙

`install-windows.ps1` 与 `teacher.nsh` 中没有任何防火墙命令。开放端口是部署方按机房网段手工完成的步骤，因此它是**被测试的对象**，而不是测试的前置条件。

## 4. 设计原则

1. 宿主机编译、虚拟机完整安装、在虚拟机内断言。
2. 断言尽量落在产品真实代码路径上：真 NSIS、真 SCM、真命名管道、真 TLS/SPKI 固定、真 Electron。
3. 控制面用协议驱动器保证确定性与覆盖广度，产品形态用 CDP 驱动器保证真实性，两者都要。
4. 每个阶段产出机器可读结果与人类可读日志；失败保留 VM，成功才销毁。
5. 不为了测试削弱产品；唯一的接缝必须显式记录（本文档中已无激活接缝）。

## 5. 架构

### 5.1 三层驱动器

| 驱动器              | 位置                   | 作用                                                                                                                                                                                         |
| ------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. 提权管理器驱动器 | guest 内 Node 脚本     | 复用真实 `manager.cjs` 与 `manageLocalService`：安装/卸载/启停/自启动/状态/初始化。测试侧只扮演教师主进程那一端（`listenLocalControl` + 受限临时目录），因为计划任务本身已提权，不需要弹 UAC |
| B. 控制面协议驱动器 | guest 内 **与** 宿主机 | 独立进程经 `packages/lab-client`/`lab-contracts` 打真实 HTTPS，覆盖协议、负例、并发与时序；宿主机那一份用于证明跨机器路径与 guest 防火墙                                                     |
| C. GUI 驱动器       | guest 交互桌面会话     | `chromium.connectOverCDP` 附着**已安装的**应用，驱动 renderer 层业务                                                                                                                         |

驱动器 A 是替代现有 fixture 的关键：`manager.cjs` 支持两种入口，`--prepare-install` 可独立执行；其余操作走 `--channel <绝对路径>` 协议，由父进程监听控制通道并下发 `{operation, input}`。测试侧实现这个父进程即可完整走到真实的产品卸载/启停逻辑。

CDP 的能力边界必须写进结论：拿不到主进程，也没有原生对话框控制。因此**导出/另存为这类带保存对话框的流程由驱动器 B 覆盖**；单实例、启动参数分发、服务控制通过 OS 可观测副作用或驱动器 A 断言。

### 5.2 宿主机编排流程

复用现有 `infra/windows-vm` harness，新增一个动作（暂定 `lab-acceptance`）：

1. 前置门禁：`win32`/x64、Node 恰好 24.20.0、`externals/lab/windows/WinSW.NET461.exe` 存在且 SHA-256 命中固定值、配置文件含 `InvitationCode`。
2. 构建：`lab:package:teacher` 与 `lab:package:student`，记录产物 SHA-256、`package-audit.json`、`runtime-manifest.json`，并记录 `git rev-parse HEAD` 与工作区状态，把产物绑定到源码版本。
3. Vagrant 创建全新 VM → 等待 WinRM → 开启控制台自动登录并重启 → 断言交互桌面会话存在。
4. 启动 guest 文件服务（8765），上传源码快照、两个安装包、guest 阶段脚本。
5. 通过 `-LogonType Interactive -RunLevel Highest` 的计划任务执行 guest 编排脚本。
6. 轮询状态文件；回收证据；成功则关机销毁，失败或需要交互输入则保留 VM 并标记 `failed`/`manual-required`。

安装包体积较大，仍走 guest HTTP 文件服务的流式 PUT，不使用 WinRM 分块。

### 5.3 guest 编排流程

`guest/lab-acceptance.mjs` 按阶段执行，每阶段开始前写 `progress.txt`，结束后写阶段结果 JSON；任一阶段失败即停止后续阶段，但**已完成的证据必须全部导出**，便于定位。阶段划分对应 §6 的 Tier。

### 5.4 文件清单

实现后的实际布局（m1 用驱动器 A，m2 增加驱动器 B 与其容器内测试道）：

```text
infra/windows-vm/
  lab.mjs                       # lab-acceptance 动作：门禁、构建、上传、证据回收、宿主机对打（N13 与 N2 远端半）
  guest/lab-acceptance.mjs      # guest 阶段编排；全部判断都在这里
  guest/lab-harness.mjs         # 纯辅助函数，容器内可测
  guest/lab-probes.ps1          # PowerShell 只采集结构化数据
  guest/start-lab-acceptance.ps1# 启动器：重定向子进程输出
  config.example.json           # 含 InvitationCode 占位说明
tests/lab-vm/
  manager-driver.ts             # 驱动器 A：提权管理器与控制通道
  protocol-driver.ts            # 驱动器 B：真实 HTTPS 协议（guest 内与宿主机对打共用同一份 bundle）
  probe-headers.mjs             # 契约要求的请求头，单点定义
  protocol/index.ts             # 命令注册表
  protocol/context.ts           # 驱动器 B 共享运行时（会话、原始请求、错误信封、机密文件）
  protocol/harness.ts           # 容器内测试道：真实 LabService + 真实 HTTPS
  protocol/tls-double.ts        # 错指纹用例用的 TLS 服务替身
  protocol/commands/*.ts        # 每个用例组的命令
  protocol/*.test.ts            # 容器内用例（vitest，见 5.5）；M4 增加 backup.test.ts
  tsconfig.json                 # 该测试道的类型检查（yarn lab:typecheck）
scripts/lab/build-test-driver.mjs # 把两个驱动打成单文件，VM 内无需 node_modules
```

### 5.5 驱动器 B 的两条测试道

驱动器 B 的命令只**观察**，判断留在 `guest/lab-acceptance.mjs`。这条分工让同一批用例有两条测试道：

| 测试道 | 载体                                                        | 覆盖                                                               | 入口               |
| ------ | ----------------------------------------------------------- | ------------------------------------------------------------------ | ------------------ |
| 容器内 | `protocol/harness.ts` 起真实 `LabService` + 真实 HTTPS 回环 | 协议语义、错误码、幂等、并发上限、归档摘要、时钟可注入的时序       | `yarn test:vitest` |
| 目标机 | 打包后的 `protocol-driver.mjs`，guest 内与宿主机各跑一遍    | 打包产物本身、Windows 服务身份、真实网络与防火墙、真实时间与多进程 | `yarn vm:lab`      |

容器内那一条不是替代品：它证明协议语义正确，证明不了打包产物和真机路径。反过来，真机那一条也不该用来发现协议语义问题——那要花一整轮 VM（约 15 分钟）。`yarn lab:typecheck` 单独检查这条测试道的类型，因为仓库根 `tsconfig.json` 是 solution 风格，`tsc -p` 不会跟到 `tests/`。

## 6. 测试矩阵

### Tier 0 宿主机预检与编译

| ID  | 用例                                            | 为什么单测/集成测不到                           |
| --- | ----------------------------------------------- | ----------------------------------------------- |
| H1  | Node 版本、平台、架构、WinSW 摘要门禁；失败即停 | 构建脚本自身的门禁从未在 Windows 上被真实触发过 |
| H2  | 两个安装包构建成功；记录 SHA-256 与审计文件     | 容器只能产出 Linux deb                          |
| H3  | guest 时钟落在许可证有效期内                    | 许可证有硬到期时间，时钟偏差会伪装成产品缺陷    |

### Tier 1 Windows 服务（无 GUI，价值最高）

| ID  | 用例                                                                                                                       | 为什么单测/集成测不到                                                                                                |
| --- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| S1  | NSIS 静默安装；断言退出码、`installation.json` 与清单一致、输出含 `Service installed and stopped. Autostart is unchanged.` | NSIS + 提权子进程链路                                                                                                |
| S2  | `sc.exe qc LS101Lab`：可执行路径为带引号的 `"…\releases\<ver>-<digest>\LS101Lab.exe"`，`START_TYPE = DEMAND_START`         | 含空格路径经 CIM 配置是 Windows 特有坑                                                                               |
| S3  | `sc.exe qsidtype LS101Lab` = `UNRESTRICTED`；`SERVICE_START_NAME = NT SERVICE\LS101Lab`                                    | 虚拟服务账户只存在于真实 SCM                                                                                         |
| S4  | 数据目录 ACL：继承关闭、无 `BUILTIN\Users`、仅 SYSTEM/Administrators/服务 SID                                              | POSIX mode 不能替代 Windows ACL 验收                                                                                 |
| S5  | **真实标准用户**（本地账户 + 计划任务运行）读取 `control.key`、`service.sqlite` 必须 `ACCESS_DENIED`                       | 只有真机可验                                                                                                         |
| S6  | 断言标准用户**打不开命名管道**，而提权 Administrator 可以                                                                  | 命名管道默认 DACL 由 libuv 与令牌决定，是整份方案中最不可预测的一条；若失败，教师端"本机服务"整链在 Windows 上是坏的 |
| S7  | `Start-Service`；断言服务进程 `SessionId = 0` 且 owner 为 `NT SERVICE\LS101Lab`                                            | session 0 隔离只有真机可见                                                                                           |
| S8  | 初始化前无 8443 监听；初始化后监听的 `OwningProcess` 是服务进程而非测试进程                                                | 证明是服务在托管端口                                                                                                 |
| S9  | 以独立进程执行 `server.cjs status`，走真实命名管道 + AES-GCM 挑战应答                                                      | 现有单测在 Linux 用 Unix socket 模拟                                                                                 |
| S10 | 未激活时 `initialize` 必须 `LICENSE_INACTIVE`；错误邀请码 `activated:false` 且不落 `license.json`；正确邀请码激活成功      | 真实激活路径从未执行                                                                                                 |
| S11 | `initialize`（`host 0.0.0.0`）返回 `readiness: ready`；`status` 报告 `state: running`                                      | 真实绑定                                                                                                             |
| S12 | 从 guest 内独立进程 TLS 连接并**自行计算 SPKI SHA-256**，与 `status` 返回的指纹比对；普通 CA 校验客户端必须连不上          | 独立验证，不信任服务端自述                                                                                           |
| S13 | **防火墙门控**：断言安装后没有规则 → 宿主机探测 8443 失败 → 按部署文档加规则 → 宿主机探测成功                              | 唯一能证明"真实 LAN 可达且防火墙确实在拦"的用例                                                                      |
| S14 | `Restart-Service`：重启后 serverId/指纹不变、数据完好、设备可重连                                                          | SCM 重启语义                                                                                                         |
| S15 | 设备处于 `practicing`/`testing` 时停止被 `RESOURCE_BUSY` 阻塞；维护模式下可正常停止                                        | WinSW `stopexecutable` 的优雅停止只在真 SCM 下有效                                                                   |
| S16 | 默认 Manual：重启后不自动运行；设 Automatic 后重启运行                                                                     | 自启动与启停是两条独立命令                                                                                           |
| S17 | 端口被占用时初始化失败，错误经提权 helper 可读呈现，且服务未被写成"已就绪"                                                 | 只有真机有端口冲突                                                                                                   |
| S18 | 进程命令行与日志中不得出现管理密码、邀请码、一次性证明                                                                     | 验收清单的明确要求                                                                                                   |

### Tier 2 客户端与服务端网络通信

| ID  | 用例                                                                                                                                   | 为什么单测/集成测不到                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| N1  | 错指纹连接必须在发出任何 HTTP 或凭据之前被拒绝                                                                                         | 现有断言只在进程内 loopback 验过                    |
| N2  | 非回环来源且无密码 → 401；伪造 `X-Forwarded-For: 127.0.0.1` 不能获得本机免密                                                           | 只有真实网络来源能测                                |
| N3  | 入网批次签发与导出；两个独立进程注册得到不同 deviceId；同 installationId 重放幂等不新增设备                                            | 多进程并发注册                                      |
| N4  | 入网负例：篡改 payload、错指纹、批次过期（服务端时间）、已撤销、`purpose`/`formatVersion` 错误                                         | 只有真实请求能覆盖                                  |
| N5  | **整文件即凭据**：同批次的另一份合法文件、或改动一个无关字符的文件，服务端都必须拒绝                                                   | 服务端用字节相等校验而非独立校验 `enrollmentSecret` |
| N6  | 心跳 5 s 显示在线；停止超过 20 s 显示离线且保留最后已知值（不显示 0）                                                                  | 真实时间语义                                        |
| N7  | 试卷上传 → 独立进程流式下载并核对摘要 → 开始许可 → 大归档上传 → 回执 → 重复上传返回**原回执** → 教师下载 → 删除后查回执仍报原回执      | 单次 PUT、大文件流、跨进程幂等                      |
| N8  | 维护模式：禁止新练习、禁止正式收卷、心跳仍接受；恢复后按原作答编号续传                                                                 | 模式权威判断在服务端                                |
| N9  | 并发错误码分开验证：>8 个并发上传 → `429 RATE_LIMITED`；>64 个并发 handler → `503 SERVICE_NOT_READY`                                   | 现有测试只用桩制造过 503                            |
| N10 | 租约与维护退出耦合：取消一台**离线**设备后，需等租约 30 s 过期才能退出维护模式                                                         | 客户端租约截止时间按服务端时间保守推算              |
| N11 | 多进程心跳压测（30–40 个客户端持续数分钟）：观察临时端口/TIME_WAIT 与服务端 256 连接上限                                               | 每个请求新建并销毁 TLS socket，无 keep-alive        |
| N12 | IPv6 负例：`RuntimeConfig.host` 只接受 `0.0.0.0`/`127.0.0.1`，而客户端会剥掉 IPv6 字面量方括号；用 IPv6 地址的入网文件必须给出可读错误 | 需要显式钉住边界                                    |
| N13 | **宿主机作为远端 peer**：同一驱动器在宿主机执行，经 VMnet8 真实链路访问 guest 的 8443                                                  | 用一台 VM 取得真实跨机证据                          |

### Tier 3 已安装产品 GUI（CDP）

| ID  | 用例                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------- |
| G1  | 启动已安装教师端并 CDP 附着；断言"启动参数无效"提示按预期出现（产品行为，非缺陷）                     |
| G2  | 连接页显示**真实命名管道返回的**服务状态，并显示版本、许可、服务标识与指纹                            |
| G3  | 经驱动器 A 完成真实安装/启动/初始化/连接/停止/自启动全链路的 GUI 展示断言                             |
| G4  | 学生端 `--activate` 与 `<file.lsjoin> --server-fingerprint <fp>`，断言注册成功且出现在教师端设备列表  |
| G5  | 第二实例：再启一个进程带新入网文件，断言不产生第二个窗口/进程，命令由首实例处理                       |
| G6  | 完整练习：浏览 → 真实 HTTPS 缓存下载 → 开始许可 → 短确定性试卷播放 → 录音 → 保存 → 上传 → UI 显示回执 |
| G7  | 维护待机全屏窗口与模式同步                                                                            |
| G8  | 重启后学生端登录自启动生效；服务自启动行为符合设置                                                    |

### Tier 4 升级、卸载与数据保留

| ID  | 用例                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- |
| U1  | 同版本覆盖安装：无需升级准备记录即可成功，数据与自启动设置不变                                                                     |
| U2  | 删除 `upgrade-ready.json` 后换版本安装必须失败，且旧服务继续运行                                                                   |
| U3  | NSIS 卸载教师客户端 → 服务注册与业务数据**保留**（`teacher.nsh` 无 `customUnInstall`）                                             |
| U4  | 经真实 `manageLocalService('uninstall')` 卸载服务 → 注册与自启动消失、数据保留、教师端显示"未安装"；重装后原 serverId 与回执仍可用 |
| U5  | 运行中卸载必须被拒绝                                                                                                               |

**状态：已实现（M4，guest 步骤见 6.1；容器内 lane 覆盖新命令，实机结论待下一轮 `yarn vm:lab`）。** Tier 4 不依赖 M3 的 GUI 驱动器，因此可以在 CDP 目标机测试之前先跑。

### 6.1 Tier 4 的实现要点（M4）

| 用例 | 步骤 | 关键实现事实 |
| ---- | ---- | ------------ |
| —    | `upgrade-packages` | 断言学生端安装包随本轮上传且非空（它是本轮产物的一半），并从注册表条目读出教师端自带的静默卸载器路径 |
| —    | `upgrade-initial-state` | 记录安装记录、应用目录、服务身份、自启动状态与运行时清单摘要；后续每个用例都以它为准 |
| U1   | `upgrade-same-version-reinstall` | 先断言**没有** `upgrade-ready.json`，再以 NSIS `/S` 覆盖安装同版本。安装器的判据是清单摘要相等（`install-windows.ps1` 的 `sameRuntime`），因此这条用例证明的是"同版本重装不需要升级准备"，而不是"碰巧通过"。服务在安装期间保持运行，顺带观察第 11 节风险 2 的静默路径；数据保留由"重新下载已发布试卷并核对摘要"证明 |
| U2   | `upgrade-without-preparation` | 把安装记录指向一个真实存在、清单摘要不同的旧 release，使安装器必须要求升级准备；两种失败形态都跑：**准备记录缺失**、以及第一次尝试自己写下的**目标版本不匹配**。两次都必须非 0 退出且不得挂起（挂起正是未应答的 NSIS 对话框的形状），随后断言旧服务仍在运行、安装记录未被替换、控制通道仍报同一 serverId。**归因**单独断言：安装脚本在准入判据之后五个阶段才用 `[IO.File]::Replace` 写记录，因此 `installation.json.previous` 的修改时间是"这次运行确实走到了服务安装阶段"的标记——没有它，一个悄悄跳过服务步骤的安装器会让所有"什么都没变"的断言以错误的理由通过。步骤结束时无论成功失败都恢复记录、删除准备记录与替换标记，避免残留被下一步当成结论 |
| U2   | `upgrade-prepared` | 走产品真实升级路径：进维护模式 → 通过真实教师接口创建**真实备份**（`backup` 命令轮询到 `ready`，并要求 `snapshotAt`/`archiveBytes`/`archiveSha256` 三项齐备，因为 `prepare-upgrade` 正是校验这三项）→ **直接运行教师端 NSIS 安装器**（验收清单第 6 条的原话"先不运行新版解包目录"），由 `teacher.nsh` 的 `customInstall` 调起包内 `install-windows.ps1`，再由它请求已安装的服务准备并停止自己——服务是在安装器手里停的，不是阶段脚本停的。断言：记录指向新 release、准备记录已被新运行时消费、serverId 与证书指纹不变、试卷摘要逐字节不变、被删作答的回执仍可查 |
| U3   | `client-uninstall-keeps-service` | 用 `QuietUninstallString`（不是猜名字）运行真实 NSIS 卸载器：客户端可执行文件消失，而服务仍注册且运行、`installation.json` 不变、自启动设置不变、已发布试卷仍可下载 |
| U4   | `service-uninstall-and-reinstall` | 先设自启动为 Automatic（否则"设置未变"与"被重置"无法区分）→ **运行中卸载必须被拒绝**（`RESOURCE_BUSY`，即 U5）→ 停服后经真实 `manageLocalService('uninstall')` 卸载：注册消失，程序目录、安装记录与业务数据保留 → 用同一安装包重装：服务重新注册为 `Manual` 且保持 Stopped，启动后 serverId 与试卷摘要不变、作答回执仍可查。最后把自启动恢复为 demand |
| U2/U3/U4 | 卸载器路径 | `uninstall-entry` 探针额外返回 `UninstallString`/`QuietUninstallString`，M4 因此不必猜可执行文件名——它带产品名和空格 |

两条边界写在实现里：M4 **不做** Linux deb 侧的升级（那是另一套 harness）；U2 的"另一个版本"是用同一份产物伪造出的旧 release，因为一次运行只构建一个版本——它证明的是**版本变化时的准入判据**，而不是跨版本迁移语义。

## 7. 证据与失败处理

回收内容：各阶段结果 JSON、`sc.exe qc`/`qsidtype` 转储、`icacls` 转储、`Get-NetTCPConnection`、`Get-CimInstance Win32_Process`、`%ProgramData%\LS101Lab\logs`、WinSW 日志、System 事件日志、SPKI 指纹独立计算记录、Playwright trace 与截图、两个安装包的 SHA-256。

失败处理沿用现有语义：测试失败、超时或需要交互输入时保留 VM 供排查，结果标记为 `failed` 或 `manual-required`；仅在全部阶段成功时关机并销毁。SCM 与 ACL 类问题几乎一定需要手工进 VM 查看，保留现场是必需的。

## 8. 边界与人工确认项

### 8.1 非目标及扩展入口

真实双机场景本轮不做：双教师站 `REVISION_CONFLICT`、跨主机心跳在线/离线翻转、B 机设备出现在 A 机教师端列表。将来需要时把 Vagrantfile 改为多机定义并复制交互会话编排即可，驱动器与用例本身可复用。

### 8.2 只能人工确认

真实声卡与耳麦（枚举、权限、录音回放、拔插）、UAC 取消后重试的交互过程、断电持久化与目录 `FlushFileBuffers`、学校防病毒或代理的 TLS 拦截（会导致 SPKI 固定失效）、机房规模压测。自动套件通过**不能**推导出这些项已验收。

## 9. 里程碑

| 阶段 | 内容                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1   | Tier 0 + Tier 1：门禁、构建、安装、SCM/账户/ACL/标准用户拒绝/session 0、真实命名管道、真实激活、0.0.0.0 监听与防火墙门控                                 |
| M2   | Tier 2：协议驱动器（guest 内 + 宿主机对打）                                                                                                              |
| M3   | Tier 3：CDP GUI                                                                                                                                          |
| M4   | Tier 4：升级/卸载/数据保留                                                                                                                               |
| M5   | 宿主机新代码单测、更新本文件与 [lab-target-acceptance.md](lab-target-acceptance.md)、更新 [../infra/windows-vm/README.md](../infra/windows-vm/README.md) |

## 10. 与现有验收清单的映射

| lab-target-acceptance.md「Windows x64 / NTFS」条目                                     | 本方案覆盖                            |
| -------------------------------------------------------------------------------------- | ------------------------------------- |
| 1 原生构建、保留日志与摘要、WinSW 摘要一致                                             | H1、H2                                |
| 2 安装教师端、UAC 取消后重试、命令行与日志无敏感信息                                   | S1、S18；UAC 取消交互仍为人工确认     |
| 3 `sc.exe qc`/`qsidtype`/`icacls`、虚拟账户、普通用户不可读                            | S2、S3、S4、S5、S6                    |
| 4 服务初始化、保存正式作答、备份恢复、目录 fsync                                       | S10、S11、N7；断电 fsync 仍为人工确认 |
| 5 注销、重启、启停与自启动、SCM 等待写入                                               | S14、S15、S16、G8                     |
| 6 新版安装器自动检查、停服、数据保留、自启动不变                                       | U1、U2                                |
| 7 学生端登录自启动、`.lsjoin` 关联、二次启动传入绑定命令、含空格安装路径、卸载保留数据 | G4、G5、G8、U3                        |

## 11. 开放风险

1. **命名管道 DACL**：若提权 Administrator 无法连接服务以虚拟账户创建的管道，教师端"本机服务"整链在 Windows 上不可用。S6 会首先暴露这一点。
2. **静默安装失败时的 NSIS 对话框**：`teacher.nsh` 在服务安装失败时调用 `MessageBox` 后 `Abort`。静默安装下该对话框是否弹出未经确认，可能导致无人值守安装挂起。S1 需要观察并据此决定是否需要改为 `IfSilent` 分支。
3. **许可证到期**：2026-10-01 之后所有依赖许可的用例都会失败。H3 先做时钟门禁，但到期后需要新的邀请码或新的许可规则。
4. **单次 TLS 握手的代价**：每个请求新建连接，40 台设备的 5 s 心跳约等于每秒 8 次握手。N11 用于量化，若在 Windows 上出现端口耗尽，属于需要产品层面决策的发现，而不是测试问题。
5. **`lab:test:integration` 不构建服务端**：该套件中教师端的 `localService` 指向的 `out/lab-server` 是悬空的，因此现有集成测并未覆盖服务端。本方案不依赖该套件，但这条事实应记录在结论里。

## 12. 实现状态

| 里程碑                            | 状态                                                    | 说明                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 宿主机门禁与打包、Windows 服务 | **已在真实 Windows 宿主机上全绿（15/15）**              | `yarn vm:lab`：宿主机门禁、编译编排、guest 阶段脚本、提权管理器驱动器、防火墙门控                                                                    |
| M2 协议驱动器                     | **已在真实 Windows 宿主机上全绿（12/12 + 宿主机对打）** | N1–N13：指纹前置拒绝、非回环认证、入网与整文件语义、心跳在线/离线、上传下载回执、维护准入、429/503、租约+维护退出、多连接压测、IPv6 负例、宿主机对打 |
| M3 CDP GUI                        | 未实现                                                  |                                                                                                                                                      |
| M4 升级/卸载/数据保留             | **已实现（容器内 lane 全绿；实机结论待下一轮 `yarn vm:lab`）** | U1–U5 的 guest 步骤（`upgrade-packages`、`upgrade-initial-state`、`upgrade-same-version-reinstall`、`upgrade-without-preparation`、`upgrade-prepared`、`client-uninstall-keeps-service`、`service-uninstall-and-reinstall`），以及协议驱动器的 `backup` 命令；见第 12.1 节 |

M1 的首次全绿运行：2026-09-17，runId `1789661969192-a443907b-4923-4a0e-8d9f-62c5c250ada8`，宿主机侧 19 步、822 s，guest 阶段 96 s，15 个步骤全部 `passed`。该次产物：教师端 `ls101-lab-teacher-0.4.1-win-x64.exe` SHA-256 `972066e2…9ce777`，学生端 `ls101-lab-student-0.4.1-win-x64.exe` SHA-256 `34111bdd…d5282`。在此之前几轮运行分别止步于打包、服务安装目录和第 13 步 `restart-survives`，后者查出的是产品缺陷（见第 13 节第四条），不是测试问题。

M2 的实现与验证分两条测试道（见 5.5）：容器内 `tests/lab-vm/protocol/*.test.ts` 用真实 `LabService` 与真实 HTTPS 覆盖 N1–N12 的协议语义；VM 内与宿主机上跑同一份打包后的 `protocol-driver.mjs`，覆盖打包产物、Windows 服务身份、真实网络与真实时间。

M2 的首次全绿运行：2026-09-18，runId `1789700556225-8611e188-d83c-41fc-9907-4e3fe01aea6b`，宿主机侧 19 步、guest 阶段 26 步（M1 15 + M2 11）全部 `passed`，宿主机对打（N13）与防火墙门控（加规则前不可达、加规则后可达）同时通过。修掉 §13.1 那条 N7 缺陷之后又跑了一轮（runId `1789702105294-f6c6c5fc-a198-432f-ba04-4dc938b9cdf1`），26 步同样全过；这一次「同一归档重传必须拿回原回执」是**严格断言**——真机上用一条新连接重传 3.1 MB 作答归档，拿到 `200` 与原回执。

几处值得留档的真机读数：错指纹时 `connections:1 / requests:0 / requestBytes:0`；本机 LAN 地址上的三种认证尝试全部 `401 AUTH_REQUIRED`（含伪造 `X-Forwarded-For`）；入网六种负例各自的状态码；心跳停 22 秒后离线但 `number`/`phase` 保留；32 连接 × 120 秒共 1280 次心跳、0 传输错误、`TimeWait` 21 且动态端口范围 49152+16384 未被消耗；试卷 4.2 MB、作答归档 3.1 MB 的独立摘要一致；租约到期前后 `maintenance-exit` 由 `409 RESOURCE_BUSY`（blocker 指名 `active-task-lease`）转为 `200 normal`；并发上限 `1×201 + 11×429` 与 `64 + 16×503`。

M1 的代码位置：

- `infra/windows-vm/lab.mjs`：`lab-acceptance` 动作，以及 `validateLabConfig`、`labPreflight`、`labGuestConfig`、`labAcceptanceTaskScript`、`labGuestStateScript`、`labFirewallScript`、`probeGuestPort`、`labAcceptance`。
- `infra/windows-vm/guest/lab-acceptance.mjs`：guest 阶段编排（Node），全部判断都在这里。
- `infra/windows-vm/guest/lab-harness.mjs`：纯辅助函数（断言、JSON 解析、编码解码、进程调用、运行记录），由 `scripts/__tests__/lab-harness.test.js` 在容器内覆盖。
- `infra/windows-vm/guest/lab-probes.ps1`：PowerShell 只做数据采集，每个探针输出一行带标记的 JSON，不做判断。
- `infra/windows-vm/guest/start-lab-acceptance.ps1`：启动器，负责重定向子进程输出，使"启动即失败"也留下证据。
- `tests/lab-vm/manager-driver.ts`：guest 侧驱动器（控制通道父进程、`pipe-name`、`verify-tls`）。
- `scripts/lab/build-test-driver.mjs`：把驱动器打成单文件，控制通道协议从 `packages/lab-server` 内联，避免协议漂移。
- `tests/lab-vm/echo-helper.ts`、`scripts/__tests__/lab-driver.test.js`：驱动器在 Linux 容器内可运行的自证。

驱动器在容器内已被验证：错误指纹会在发出任何 HTTP 之前被拒（服务端观测到 0 个请求）、自签服务无法被普通校验证书的客户端连接、`manage` 转发的 `initialize` 输入恰好是 `activationCode/baseUrl/name/password/port` 五个键、失败时只回错误码且不回显密钥。**但这些只证明驱动器正确，不能替代目标机结论。**

M1 覆盖的 Tier 0/1 项：H1、H2、H3、S1–S14、S18，已在真实宿主机上全部通过。其中 H3 分两段：宿主机把自身 UTC 时间随配置下发，guest 先断言与本机时钟的偏差小于 24 小时（服务证书有效期为签发前后各一天，超出即会同时破坏 TLS、入网有效期、心跳窗口与许可判断），再依据服务自己上报的 `license.expiresAt` 断言尚未过期。两者都以 `LICENSE_WINDOW` 前缀报错，避免把一台时钟不对的 VM 误判为产品缺陷。

[lab-target-acceptance.md](lab-target-acceptance.md) 的「Windows x64 / NTFS」一节因此可以引用这次运行作为**部分**证据，但整节仍不能标为通过：该节 7 项中只有第 1 项（Windows 原生打包）与第 3 项（`sc qc`/`qsidtype`/`icacls` 与普通用户隔离）被 M1 完整覆盖，第 2 项里"进程命令行与日志不得泄漏密钥"由 S18 覆盖、UAC 取消后重试属 GUI（M3），第 4 项的作答/备份/恢复与目录 fsync 屏障属 M2，第 5 项的重启自启动属 S16，第 6、7 项的升级、卸载与学生账户路径属 M4。在 M2–M4 完成前，该节状态维持"未运行"。

M1 尚未覆盖的 Tier 1 项：S15（停止语义与在线设备）、S16（重启后自启动）、S17（端口占用）。这三项需要多次重启或已注册设备，按计划留给后续里程碑。

M4 在**容器内**已经自证（这是 M2 之后新增的第三条自证要求）：`yarn test:vitest` 的 `tests/lab-vm/protocol/backup.test.ts` 对真实 `LabService`（真实 TLS、可注入时钟）跑新命令，断言正常模式下备份被拒、维护模式下得到 `ready` 且归档确实落在 `backups/<id>.7z` 且字节数与索引一致、以及快照时间是服务自己的时钟；`scripts/__tests__/lab-driver.test.js` 断言 `manager-driver` 的 `prepare-install` 原样带回退出码与 stderr 信封、`--raw` 把拒绝作为结果而不是退出状态返回。`yarn vm:test` 另外钉住 M4 的步骤顺序、失败路径的恢复动作和卸载器路径的来源。

**M4 尚未取得实机结论。** 上表 M4 的"已实现"只表示代码与容器内自证完成，不表示任何一条 U 用例已经在真实 Windows 上通过；下一轮 `yarn vm:lab` 的 guest 步骤数从 26 变为 33（M1 15 + M2 11 + M4 7），通过后本节 M4 行才能改为"已在真实宿主机上全绿"。

### 12.1 S18 的扫描范围（本轮一并补齐）

S18 原本只按管理密码扫描三个文件。设计 §3.3 要求同时覆盖邀请码与一次性本地证明，因此该步骤现在按**值**扫描，并且跑**两遍**——因为运行期间"已存在的秘密"是增长的：

- 第一遍（`secret-scan`，M1 内，第 15 步）：管理密码与邀请码。邀请码在服务消费它之前就被读入内存，因为到这一步文件本身已经删除。
- 第二遍（`secret-scan-final`，全部用例之后）：再加上归档密码（M4 的升级准备才生成）与协议驱动器收到过的本地证明/设备密钥文件（读回一个已花费的证明文件不会证明任何事，所以证明按文件取当前值）。

扫描对象覆盖 `lab-acceptance.log`、`lab-progress.txt`、`lab-results.json`，断言失败时会指出是哪一个秘密泄漏到了哪一个文件；某一遍声称要扫的秘密如果不存在，该遍直接失败，而不是"什么都没扫"地通过。第一次真机运行正是被这条"不静默降级"的规则拦下的：那一版只有一遍扫描、却要求三个秘密，于是它在 M2 之前就红了——这是测试自身的时序错误，不是产品缺陷。

邀请码的值只用于这次比较：它不写日志、不写结果、只以长度出现在断言消息里；`scripts/__tests__/windows-vm.test.js` 钉住"只读一次 + 不得进入任何 sink"这条性质。

## 13. 实机运行发现的问题

2026-09-17 在真实 Windows 宿主机上分阶段跑通了 M1 的前两步（宿主机编译、guest 首阶段），发现三个缺陷。全部是单元测试、容器打包和 Linux 目标都无法暴露的问题，也是这套 VM 验收存在的理由。后续一次完整运行在 S14 上又发现了第四个缺陷，同样只能在这套环境里暴露，见下文。

| 缺陷                           | 表现                                                                                                                                                   | 根因                                                                                                                                                                                                                                                                                          | 状态                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Windows 打包必然失败           | `yarn lab:package:teacher` 在 `afterPack` 报 `Unexpected packaged dependencies: \main, \main\index.js, …`                                              | `@electron/asar` 的 `listFiles()` 用 `path.join` 拼路径，Windows 上返回反斜杠，而白名单正则写死了正斜杠                                                                                                                                                                                       | 已修：`scripts/lab/package-audit.mjs` 先规范化分隔符再匹配                                                                  |
| guest 阶段脚本静默死亡         | 任务 exit 1，结果目录一个文件都没有，`phase unknown`                                                                                                   | 脚本 `param([string]$Config)` 与解析结果同用 `$config`。PowerShell 变量名不区分大小写且类型约束留在变量上，`ConvertFrom-Json` 的结果被强制转成字符串 `@{installer=…}`，随后 `$config.resultsDir` 求值为 `$null`，`Join-Path` 报 `Cannot bind argument to parameter 'Path' because it is null` | 已修：解析结果改名 `$labConfig`；新增启动记录与配置校验，使同类失败自述原因                                                 |
| 服务装到 `Program Files (x86)` | 安装器返回 0，`%ProgramFiles%\LS101LabService\installation.json` 不存在，但 `C:\Program Files (x86)\LS101LabService` 存在且 SCM 中已有 `LS101Lab` 服务 | electron-builder 的 NSIS 安装器是 32 位进程，`teacher.nsh` 用 `$SYSDIR\…\powershell.exe` 启动的是 **32 位** PowerShell；WOW64 文件系统重定向把该进程的所有 `C:\Program Files` 访问改写到 `C:\Program Files (x86)`。64 位教师端按真实的 `Program Files` 读取安装记录，因此永远显示"未安装"     | 已修：`install-server-windows.ps1` 检测到 32 位进程时用 `Sysnative\…\powershell.exe` 以 64 位重新执行自身，并保留 `-Verify` |

第三条尤其值得记录：**只改环境变量无法修复**，因为 WOW64 重定向作用于路径访问而不是变量值；唯一的可靠做法是让脚本运行在 64 位 PowerShell 中。修复放在脚本自身而不是 `teacher.nsh`，这样 NSIS 安装器、管理员手工调用和教师端管理器三条路径同时受保护。

第四条在 S14（`Restart-Service`）上暴露，是**被测产品自身的缺陷**，不是测试环境问题：

| 缺陷                   | 表现                                                                                                                                                         | 根因                                                                                                                                                                                                                                                                                                                                                            | 状态                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 服务停止后永远停不下来 | `Restart-Service` 卡住；SCM 长期停在 `Stop Pending`；wrapper 日志在 `WaitForProcessToExit <runtime>+<stop>` 之后不再更新；runtime 进程仍活着、控制通道仍应答 | WinSW 2.12.0 在 `WrapperService.DoStop` 里无条件执行 `stopArguments += " " + Arguments`，因此 XML 里用 `<arguments>` 声明的启动参数被**原样追加到停止命令行**。实际停止命令成了 `server.cjs shutdown --data-dir <data> server.cjs serve --data-dir <data>`，被 `cli.ts` 的 `extra.length` 判为 `INVALID_ARGUMENTS` 并立刻以 1 退出，`shutdown` 从未送达 runtime | 已修：`LS101Lab.xml` 的 `<arguments>` 改为 `<startarguments>`；新增契约断言防止回归 |

三个细节值得记下来。其一，WinSW 文档写明了规则——"When you use the `<stoparguments>`, you must use `<startarguments>` instead of `<arguments>`"——但这条规则违反时**完全静默**：WinSW 启动停止进程时传的日志处理器是 `null`，停止进程写往 stderr 的 `INVALID_ARGUMENTS` 没有任何去处，wrapper 日志只留下 `Started process <pid>` 一行。其二，`<stoptimeout>1900 sec</stoptimeout>` 在这种配置下**不生效**：它只在"没有 `<stoparguments>`、由 WinSW 直接杀进程树"的分支里使用，而优雅停止走的是 `while (!WaitForExit(sleeptime)) SignalPending()` 的无界循环，默认 1 秒轮询、永不放弃。也就是说这个缺陷不是"卡 31 分钟后被杀"，而是**服务根本无法停止**，教师机上的 `sc stop`、重启和关机都会无限期挂起；此前"1900 秒后会自愈"的判断是错的。其三，定位手段是把停止进程的命令行抓下来：wrapper 自己不记，探针按秒级轮询又必然错过这个存活不到 1 秒的进程，最终靠在 `Restart-Service` 旁边挂一个 100 ms 轮询 `Win32_Process`、由哨兵文件结束的采样器才拿到证据。

一处**撤回的判断**：早期日志（安装记录缺失、安装器 16 秒返回）曾被解读为"静默安装失败却返回 0"。第三条缺陷确认后，安装器其实成功执行了服务安装脚本，只是落在被重定向的目录，退出码是正确的。第 11 节风险 2（静默模式下 `MessageBox` 是否挂起）因此仍未验证，保持开放。

### 13.1 M2 期间发现的协议与文档偏差

M2 的容器内测试道（真实 `LabService` + 真实 HTTPS）在写用例的过程中发现设计文档的三处描述与服务的实际行为不符，以及一个真实产品缺陷。这些不需要等 VM 就能发现，正好说明 5.5 的两条测试道各管一段。

| 主题                 | 设计文档说法                                 | 服务实际行为                                                                                                                                                                                                                                                       | 处理                                                                                                         |
| -------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| 心跳的单调性（N6）   | 更旧的 `sequence` 以 `CONTENT_CONFLICT` 拒绝 | 更旧或相同的 `sequence`（同一 runtime）返回 **200 + `heartbeatAccepted:false`**，没有错误码；同 runtimeId 的低 `runtimeGeneration` 同样如此，**更高的 generation 反而被接受**（那是重启/接管路径）；`CONTENT_CONFLICT` 只在 generation 相同而 runtimeId 不同时出现 | VM 步骤改判 `lastAccepted`；容器用例逐条钉住这四种组合                                                       |
| 整文件即凭据（N5）   | 服务端用**字节相等**校验文件                 | 改一个字节的文件在 `verifyEnrollment` 的 **JWS 签名校验**就已被拒；字节相等那条分支只对"另一批次的有效签名文件"可达。两者都返回 `403 ENROLLMENT_REJECTED`，所以 N5 的可观察结论成立，但"字节相等拦住了改字"是错的                                                  | 断言不变，措辞修正；另记录：一个批次只有一份签名文件，且同时只允许一个批次开放，"同批次另一份合法文件"不可达 |
| 作答编号续传（N8）   | 恢复后按原作答编号续传                       | 服务端**没有编号计数器**，`PracticeGrant` 也没有编号字段；一次练习的唯一身份是客户端放在路径里的 `submissionId`。续传的可观察含义是：同一个 id 再开一次返回**原 grant**（`grantedAt` 不变）                                                                        | 步骤断言 `reuse`/`sameGrant`，并在结果里写明 `serverCounter:false`                                           |
| 翻页接口（N6）       | —                                            | `DeviceList` 只有 `nextCursor`，没有 `total`                                                                                                                                                                                                                       | 驱动器把返回页的大小命名为 `total` 并注明                                                                    |
| IPv6 可读错误（N12） | 用 IPv6 地址的入网文件"必须给出可读错误"     | 入网文件路径确实给出 `connect ECONNREFUSED ::1:<port>`；但 `RuntimeConfig.host` 拒绝 `::1` 时抛出的消息**就是裸错误码** `INVALID_REQUEST`，教师端主进程原样透出，操作者看不到诊断                                                                                  | VM 步骤只对入网文件的措辞断言；host 边界的裸码由容器用例钉住并写进 `notes`                                   |
| IPv6 不对称（N12）   | —                                            | `LabService.validateBaseUrl` 与客户端 `validateTarget` **都接受** `https://[::1]:8443/`，而 `RuntimeConfig.host` 永远无法绑定 IPv6：服务可以签出一份指向自己永远监听不了的地址的入网文件                                                                           | 记录为发现，未改产品；驱动器不篡改运行中服务的地址，改用改写真实入网文件 payload 的方式触达真实代码路径      |

第三个操作要点：**同一条设备凭据上的并发心跳不一定是 200**。设备已经有一条心跳记录时，64 个并发心跳各自带 runtimeId、撞上同一 generation，服务端按自己的规则回 `409 CONTENT_CONFLICT`（这是正确的冲突判定，不是错误）。所以 N9 的 handler 上限断言写的是"门槛以下被 handler 处理、只有溢出回 503、每个状态都是服务端的答案"，而不是"前 64 个都是 200"——后者在容器里成立只是因为那台设备当时还没有心跳记录，断言的是夹具而不是上限。

两个操作要点，都是写 VM 步骤时踩出来的：**开放的入网批次本身就是维护退出的 blocker**（`kind: "enrollment"`），所以 N10 之前必须关闭批次，否则租约到期证明不了任何事——阶段脚本因此先断言"开放批次挡住退出"，再关闭批次并断言退出成功；**上传 429 在单设备下来自"每设备同时只允许一个正式收卷"这条规则**，服务端全局 8 行的上限需要 ≥9 台设备才可达，`concurrency --kind uploads` 只能证明前者，VM 步骤的断言按前者写。

另有一个**产品缺陷**（N7，已修）：学生用**完全相同的归档**重传时，`putStudentSubmissionsSubmissionId` 在读取 `context.stream` 之前就返回原回执并结束连接；响应发完时客户端还在写请求体，Node 关闭仍有未读字节的连接，对端把它重置，响应就被丢掉了。真实服务上的实测（每种大小 3 次）：

| 归档大小                                         | 拿到回执 | 备注                                     |
| ------------------------------------------------ | -------- | ---------------------------------------- |
| 2 KiB                                            | 3/3      | 请求体装得进套接字缓冲，所以答案发得出去 |
| 64 KiB                                           | 3/3      | 同上                                     |
| 256 KiB                                          | 1/3      | 从这里开始是竞态                         |
| 1 MiB                                            | 2/3      |                                          |
| 4 MiB                                            | 1/3      |                                          |
| 1 MiB（对照组：handler 先排空 `context.stream`） | 3/3      | 证明根因就是"没读请求体就回答"           |

**影响面不止这一处**：任何"读完请求体之前就产生的答案"都有同样的形状——`429 RATE_LIMITED`（>8 并发上传）、`413 PAYLOAD_TOO_LARGE`、`RESOURCE_BUSY` 以及 HTTP 层的 `503 SERVICE_NOT_READY` 都可能以 `EPIPE` 而不是那个错误码的形式到达客户端。也就是说学生看到的是"连接被重置"，而不是"稍后重试"。

**修法在产品侧的 HTTP 层单点完成**：`packages/lab-server/src/http.ts` 在写出任何响应之前，若请求体尚未读完，就先把它排空（有界：超过契约允许的最大归档则直接断开，另有 15 秒上限）。这样回执重放、429、413、凭据拒绝和容量 503 全都受同一处保护，而不是每条路径各自修一遍。

**回归测试两条**，都经过变异验证（把排空去掉后必然变红）：

- `packages/lab-server/src/__tests__/service.test.ts` 的确定性用例：客户端只发一半请求体再停手，断言此时**不能**收到答案，补齐后才收到 `401`。去掉排空后 3/3 次失败。
- `tests/lab-vm/protocol/submission.test.ts` 的端到端用例：4 MiB 归档重传 5 次，每次都必须是 `200` 且回执与原回执逐字节相同（原来是"两种结果都记录"的 tripwire）。这项在容器里受竞态影响、去掉排空时约三次里红一次，所以真正的确定性判据放在上一条。

## 14. guest 侧的语言分工

原本整个 guest 阶段脚本是 PowerShell，理由是沿用仓库既有的 `guest/run-acceptance.ps1` 骨架。实测证明这个选择是错的：连续三次失败都出在 PowerShell 的语义上——`param([string]$Config)` 与解析结果同名导致对象被强制转成字符串、`Assert-That` 的 `[bool]` 参数无法绑定单元素管道结果、按行取 JSON 时管道把单行输出解包成标量从而索引到第一个字符。这三处都不是"写错了"，而是**这类辅助函数在 PowerShell 里无法在容器内执行**，只能靠重建 VM（约 7 分钟）来发现。

因此调整为：

| 关注点                                         | 语言       | 位置                             | 容器内可测                       |
| ---------------------------------------------- | ---------- | -------------------------------- | -------------------------------- |
| 阶段编排、全部断言与判断                       | Node       | `guest/lab-acceptance.mjs`       | 结构由 `windows-vm.test.js` 断言 |
| 纯辅助函数（断言、JSON、编码、进程、运行记录） | Node       | `guest/lab-harness.mjs`          | **是**，`lab-harness.test.js`    |
| 管理控制通道与 TLS 探针                        | Node       | `tests/lab-vm/manager-driver.ts` | **是**，`lab-driver.test.js`     |
| 结构化数据采集                                 | PowerShell | `guest/lab-probes.ps1`           | 否，但每个探针只有几行且不含判断 |
| 子进程输出重定向                               | PowerShell | `guest/start-lab-acceptance.ps1` | 否，必须在被测进程之外           |

判断之所以全部移到 Node，是因为**只有能被执行的代码才值得写测试**。带外数据采集继续用 PowerShell，是因为 `Get-Acl`、`Get-CimInstance`、`New-LocalUser`、`Start-Process -Credential` 在 PowerShell 里确实比在 Node 里调 CLI 再解析文本更短更稳；这些探针只回答"是什么"，不回答"是否合格"。

一处工程细节值得记录：PowerShell 5.1 的 `ConvertTo-Json` 会把单元素数组渲染成标量，因此探针输出会在 Node 侧经 `asArray()` 归一化——这个坑在容器内有测试覆盖，而不是等到真机上才发现。
