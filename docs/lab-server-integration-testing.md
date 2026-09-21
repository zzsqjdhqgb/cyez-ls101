# 服务端集成测试：需求覆盖与执行

本文件记录服务端需求的验证归属。测试代码存在、当前环境通过、目标系统通过是三种不同证据。不能用接口注册检查或总行覆盖率代替需求验收。

需求来源：[API 设计](lab-server-api-design.md)、[存储与事务设计](lab-server-storage-design.md)、[服务运行](lab-service-runtime.md)。Windows 服务账户、SCM、WinSW、安装器和真实断电继续由[目标系统验收](lab-target-acceptance.md)负责。

## 执行入口

在仓库或专用 worktree 根目录的 PowerShell 中执行：

```powershell
$env:LS101_SETUP_MODE = 'product-docs'
yarn lab:test:typecheck
yarn lab:test:service
yarn exec vitest run --config tests/lab-vm/vitest.config.ts
yarn lab:test:server
yarn lab:test:integration
```

- `lab:test:service` 包含既有单元、组件集成与新增服务端集成测试。
- `lab:test:typecheck` 检查新增集成测试及其引用的生产源码，不生成产物。
- `tests/lab-vm` 的 Vitest 测试在本机启动真实 TLS 服务，不需要 Vagrant。
- `lab:test:server` 先用正式构建脚本构建，再从仓库外启动随包 Node 和 `server.cjs`。
- `lab:test:integration` 是既有教师／学生 Electron 跨端测试；Linux CI 使用虚拟显示执行。
- `LS101_SETUP_MODE=product-docs` 跳过模型本体下载，保留安装脚本需要的运行时资源。

`yarn install` 的 setup 阶段会准备原生归档程序。`7zip-bin@5.2.0` 的 Linux 二进制在 npm 包中为 `0644`，setup 为其补齐执行位并实际启动验证；CI 在运行服务端测试前再次检查。已有安装遇到备份在加密阶段失败时，可单独准备，无需下载模型：

```powershell
node scripts/lab/prepare-archive-engine.mjs
node scripts/lab/prepare-archive-engine.mjs --check
```

`--check` 只验证，不修改权限。失败会明确报告归档程序路径和底层错误；生产服务及构建过程不修改依赖权限。依赖目录必须可写且使用当前系统的原生程序。

正式构建锁定 Node **24.20.0**，不能用放宽版本检查、替换正式入口或跳过构建来宣称产物验证通过。服务源码测试的 Node 引擎范围较宽，因此源码测试通过不意味着产物入口可构建。

持续混合请求单独运行：

```powershell
$env:LS101_SETUP_MODE = 'product-docs'
$env:LS101_LAB_SOAK_ROUNDS = '200'
yarn lab:test:soak
```

默认 20 轮，允许 1–2000 轮；非法配置直接失败。该测试包含 12 个设备的心跳、试卷下载、回执读取、教师查询、并发交卷以及间歇重开服务。每轮核对业务事实和资源释放，并记录进程内存。这个规模是可重复的回归负载，不是课堂规模的性能承诺；课堂设备数、持续时间和时延阈值需要另行确定。

## 测试层次与设施

新增用例位于 `packages/lab-server/src/__tests__/integration/`：

| 文件                                       | 责任                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| `support.ts`                               | 临时数据目录、真实 HTTPS、SQLite、真实归档、教师和学生注册、业务时钟、暂停点 |
| `process-worker.ts` / `process-support.ts` | 测试专用子进程入口、私有 IPC 握手、确定位置强制终止和同目录重启              |
| `business.test.ts`                         | 身份及模式矩阵、设备修订、心跳持久性、试卷、作答、导出及分页                 |
| `route-auth.test.ts`                       | 每个受保护 HTTP 操作的匿名／相反角色拒绝                                     |
| `concurrency.test.ts`                      | 最终提交授权、并发重试、下载／导出与删除及 GC 的交错                         |
| `crash-recovery.test.ts`                   | 收卷、备份及离线恢复持久化阶段的真正进程终止                                 |
| `failures.test.ts`                         | 传输中断、取消、存储错误、提交结果不确定、输入校验及大请求的提前拒绝         |
| `tasks-backups.test.ts`                    | 任务归属、租约、取消／过期、清理确认范围、备份与模式／租约排序               |
| `lifecycle.test.ts`                        | 生产服务运行时、本机控制、启动失败、停止准入和真实 HTTP 备份后离线恢复       |
| `sequences.test.ts`                        | 固定种子操作序列与独立回执模型逐步比对                                       |

业务从 HTTPS 或正式本机控制接口驱动，除必要的特殊状态构造外，不直接插入数据库来伪造流程成功。数据库和磁盘用于补充断言，例如检查失败上传没有索引、没有残留占位。

原始 HTTP 客户端不使用产品客户端的校验或重试逻辑；协议驱动测试则验证真实产品传输。两者互补。

进程测试由父进程等待子进程明确报告暂停点，才强制终止并等待退出。没有运行被杀进程的 finally 清理，因此不同于普通抛异常。恢复后再次重启检查幂等性。测试入口单独构建至 `out/lab-server-tests`，不属于正式 `server.cjs`，不增加生产 HTTP 故障开关或许可绕过。离线恢复密码通过测试私有 IPC 传入，不放在进程命令行。

每个 fixture 拥有独立的父目录，数据目录、目录锁、恢复日志和保留的原目录都在其中，清理不会触碰其他用例或当前工作区。暂停点在退出测试时释放，子进程由父进程回收。

业务、并发、崩溃恢复、传输故障、任务、操作序列和混合请求用例失败时，将测试名、Node 版本、平台以及临时目录的文件名／字节数写到 `test-results/lab-server/`；不复制数据库、凭证或归档内容。生命周期和路由权限用例目前依赖测试报告；Electron 用例保留 Playwright 诊断。

## 需求覆盖表

表中的编号用于跟踪需求，测试按相应领域分组；“已有”表示沿用原测试，不代表本次创建。相同接口的不同需求必须分别判定，尤其不能把 `AUTH-ALL` 计成全部业务语义覆盖。

| 编号              | 需求及必须观察的结果                                                                         | 自动证据                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| AUTH-ALL          | 每个非公开操作拒绝匿名和相反角色；路径所属角色与声明一致                                     | `route-auth.test.ts`，真实 HTTP，预期角色独立于契约的 role 值                        |
| AUTH-OWNER        | 其他设备不能读回执、重放作答或占用相同练习编号；原回执不变                                   | `business.test.ts`                                                                   |
| AUTH-ADMISSION    | 维护、版本不符、禁用、撤销、许可失效分别阻止正式下载／练习／交卷／回执                       | `business.test.ts`；诊断例外单独检查                                                 |
| AUTH-SESSION      | 登出和到期撤销会话；重新登录仍可工作                                                         | `business.test.ts`                                                                   |
| AUTH-PASSWORD     | 密码修订冲突、独立修订及旧会话撤销                                                           | 已有 `service.test.ts`；在途写入见 ORDER-PASSWORD                                    |
| AUTH-LOCAL        | 本机证明一次性、来源限制、跨源和伪造转发头拒绝                                               | 已有 `runtime.test.ts`、协议 `login.test.ts`、`pin.test.ts`                          |
| ENROLL            | 签名文件、有效期、撤销、版本、错误指纹、注册去重及秘密不回显                                 | 已有协议 `enroll.test.ts`                                                            |
| DEV-REVISION      | HTTP 改号冲突不留下部分字段；旧修订不能覆盖新值；重启后学生可见                              | `business.test.ts`                                                                   |
| DEV-HISTORY       | 修改当前设备标签不重解释收取时标签及历史筛选                                                 | `business.test.ts`                                                                   |
| HB-DURABLE        | 服务重开后旧代次／旧序号仍被拒，不刷新在线时间；新代次可前进                                 | `business.test.ts`                                                                   |
| HB-BOUNDARY       | 在线边界、乱序、同代次不同运行冲突、保留最后观测                                             | 已有协议 `heartbeat.test.ts`，新增重开验证                                           |
| EXAM-LIFECYCLE    | 相同试卷去重、不同内容冲突、下架限制、删除后可重新导入且回执不丢失                           | `business.test.ts`                                                                   |
| SR-VALIDATION     | 摘要错、非法归档无成功记录且可重试                                                           | `business.test.ts`；已有协议 `submission.test.ts` 的编号和内容冲突                   |
| SR-COMMIT         | reserved、file-synced、file-published、committed 各点强制终止后恢复真实提交事实              | `crash-recovery.test.ts`；重复恢复及重试后仅一个回执／归档                           |
| SR-PARTIAL        | 半包时进程退出，重启清除占位并允许完整重试                                                   | `crash-recovery.test.ts`                                                             |
| SR-DELETED        | 删除后重启和迟到重放保留 deleted 回执，不恢复文件                                            | `crash-recovery.test.ts`                                                             |
| SR-CORRUPTION     | 已提交文件缺失或截断阻止启动；同大小摘要损坏禁止下载成功                                     | `crash-recovery.test.ts`、`business.test.ts`                                         |
| SR-EXPORT         | 完整 ZIP 内容可校验；选择中有缺失项则不发送成功 ZIP                                          | `business.test.ts`                                                                   |
| SR-BATCH          | 批量删除重放在重启后返回原逻辑结果；更改同键输入冲突                                         | `business.test.ts`                                                                   |
| PAGE              | HTTP 分页跨改号保持固定身份顺序，跨会话／筛选复用被拒                                        | `business.test.ts`；已有 `pagination-retention.test.ts` 的删除／过期边界             |
| ORDER-AUTH        | 维护、禁用、重置绑定、许可变化先于上传最终提交，则拒绝新作答但保留旧回执                     | `concurrency.test.ts`，明确暂停在文件发布后                                          |
| ORDER-PASSWORD    | 已鉴权试卷上传在改密后不得提交；新会话可重新上传                                             | `concurrency.test.ts`                                                                |
| ORDER-REPLAY      | 并发相同编号仅一个在途接收；后续重试收敛到同一回执                                           | `concurrency.test.ts`                                                                |
| ORDER-GC          | 先取得引用的下载／导出可完成；逻辑删除后新下载拒绝；已有引用释放后才 GC                      | `concurrency.test.ts`                                                                |
| IO-CAPACITY       | 固定保留 1 GiB；大盘容量不影响准入；边界拒绝无残留，探测失败后可重试                         | `failures.test.ts`，仅替换 `statfs`，非真实磁盘满验收                                |
| IO-ROLLBACK       | reserve、sync、publish 阶段异常后清理临时文件和占位，重试成功                                | `failures.test.ts`；和真正崩溃测试分别记录                                           |
| IO-DISCONNECT     | 上传断流回收接收占用并允许相同编号重试                                                       | `failures.test.ts`                                                                   |
| IO-CANCEL         | 维护主动取消停滞半包，不必等待客户端下一块数据才能回收占用                                   | `failures.test.ts`                                                                   |
| IO-COMMIT         | 数据库提交实际上成功／失败但报告异常时，后续 HTTP 明确返回 503；重开后核验真实提交结果       | `failures.test.ts`，只注入 SQLite COMMIT 边界                                        |
| HTTP-INPUT        | 非法 JSON、未知字段、错误媒体类型、重复查询、非法 UUID、浏览器 Origin 拒绝                   | `failures.test.ts`                                                                   |
| HTTP-EARLY        | 大请求上的鉴权、媒体类型、大小、限流提前拒绝可以被客户端接收                                 | `failures.test.ts`；已有半包鉴权及大包重复交卷回归                                   |
| HTTP-CAPACITY     | 上传和 handler 两种上限、错误码及 Retry-After 区分                                           | 已有 `service.test.ts` 与协议 `mode.test.ts`                                         |
| TASK-OWNER        | 其他设备不能领取任务、下载测试资源或回报；错误操作不抢占任务                                 | `tasks-backups.test.ts`                                                              |
| TASK-LEASE        | 过期租约不能续租复活；迟到报告保留事实但不复活任务；重开后回放一致                           | `tasks-backups.test.ts`                                                              |
| TASK-CANCEL       | 分别先取消／先回报，终态和报告不被后续取消或重置绑定改写                                     | `tasks-backups.test.ts`                                                              |
| TASK-RETRY        | 重试生成新批次、保留原结果；重试创建自身幂等                                                 | `tasks-backups.test.ts`                                                              |
| TASK-CONFIRM      | 人工确认独立 revision，不能覆盖自动执行结果                                                  | 已有 `service.test.ts` 和 `tests/lab/student.spec.ts`                                |
| TEST-ISOLATION    | 部署测试资源／作答走任务授权、独立存储，不变成正式提交                                       | 已有 `tests/lab/student.spec.ts`；跨端层执行                                         |
| CLEAN-SCOPE       | 预览不派发执行；未预览设备不得确认；确认重放不扩大范围或重复派发                             | `tasks-backups.test.ts`，包含重开后重放                                              |
| CLEAN-REJECT      | 旧 revision、错误摘要、取消及到期均不创建执行任务                                            | `tasks-backups.test.ts`                                                              |
| CLEAN-FILES       | 学生实际仅删除确认快照，恢复后不扩大范围                                                     | 已有学生队列测试和 `tests/lab/student.spec.ts`；服务端只证明授权和派发               |
| BK-ORDER          | 备份与退出维护、任务领取分别先提交，另一方按规则拒绝且无副作用                               | `tasks-backups.test.ts`                                                              |
| BK-BARRIER        | active 时拒绝冲突写入；加密时普通写入恢复但仍不能退出维护；同键回放不重跑                    | 已有 `service.test.ts`                                                               |
| BK-CRASH          | pending、关闭准入、active、staging durable、encrypting、file published、ready 各阶段强制终止 | `crash-recovery.test.ts`；重开无遗留屏障、无密码重跑、无缺失文件 ready、幂等映射保留 |
| BK-VALIDATE       | 密码格式拒绝、真实 ready 文件与字节数、备份年龄                                              | 已有 `service.test.ts` 与协议 `backup.test.ts`                                       |
| RESTORE-CLOSED    | 真实 HTTP 备份停止后离线恢复；身份及回执保留、会话撤销、备份列表清空                         | `lifecycle.test.ts`                                                                  |
| RESTORE-CRASH     | 索引清理、验证、切换日志、原目录搬移、安装后五处真正进程终止                                 | `crash-recovery.test.ts`；恢复后原目录及原备份仍可读，回执可重复查询                 |
| RESTORE-INTEGRITY | 错误密码、版本、路径或摘要拒绝；B 包含 A 索引时恢复只清理备份相关映射                        | 已有 `restore.test.ts`                                                               |
| LIFE-INIT         | 未激活不能初始化；初始化一次；重启不更换身份                                                 | `lifecycle.test.ts`                                                                  |
| LIFE-PORT         | 端口占用启动失败后释放锁，端口恢复后原服务可启动                                             | `lifecycle.test.ts`                                                                  |
| LIFE-DATA         | 配置缺失／损坏、schema 不兼容时不创建空库；修复后原身份恢复                                  | `lifecycle.test.ts`                                                                  |
| LIFE-STOP         | 正常模式不能 prepare-stop；取消停服准备后恢复写入；重复 close 不遗留锁                       | `lifecycle.test.ts`；已有 `runtime.test.ts` 的离线活动、升级准入                     |
| SEQ               | 多轮上传、查询、删除、重开按独立模型逐步核对，失败保留种子和操作序列                         | `sequences.test.ts`                                                                  |
| LOAD              | 混合请求下回执与归档完整，临时上传和引用释放，重开后继续工作                                 | `tests/lab-server-soak/mixed-load.test.ts`                                           |
| ARTIFACT          | 随包 Node、仓库外工作目录、CLI、真实入网和交卷、shutdown 与新进程重启后原回执及归档          | `tests/lab/server-runtime.mjs`、`server-workflows.mjs`，必须执行正式构建后才有证据   |

## 本次回归暴露的产品问题

1. **数据库不可用时后续 HTTP 请求悬挂。** `handle()` 在 try/catch 之外读取 `service.data()` 获取上限；数据库提交结果不确定会使数据库拒绝访问，从而产生未处理的 Promise 拒绝，客户端等待超时。改为使用监听器建立时已读取的不可变归档上限，使失败进入统一 HTTP 错误响应。提交实际成功和失败两种注入场景都先复现，再验证修复及重开后的事实。
2. **取消信号不能唤醒停滞上传。** 只在收到下一块数据时检查 AbortSignal，使维护取消后半包接收继续占用资源。为 HTTP 流提供取消回调，未接收完整时主动断开以唤醒读循环；已收完整时保留连接以返回最终准入错误。取消后的清理和重新提交有回归测试。

为控制下载／导出与删除的顺序，在已取得文件引用后补充 `archive-download-acquired` 内部故障注入点，沿用现有 `ServiceOptions.fault`，不改变对外 API。

## 持续执行与尚未取得的证据

`.github/workflows/lab-server.yml` 在 Linux 和 Windows 上运行源码集成、协议、正式产物与跨端测试，固定 Node 24.20.0 并跳过模型本体下载；定时／手动运行增加持续混合请求。工作流写入不等于远端 CI 已运行。

以下不能算作本次源码集成测试已证明的事项：

- Windows SCM／WinSW、账户 ACL、安装升级卸载、UAC、重启自启动等：继续使用目标系统套件。
- 真实断电、NTFS 持久化和设备级 I/O 故障：进程终止及注入 EIO 不能替代这些证据。
- 真正把隔离磁盘填满、拒绝实际系统写权限：当前容量／I/O 注入验证错误处理，不能替代系统级试验。
- 真实机房规模、长时间资源趋势及 SLA：目前持续混合请求是功能与资源释放回归，尚未确定业务验收阈值。
- 归档解压的所有恶意格式组合、所有业务状态的笛卡尔积：还需结合归档包测试和需求审计持续补充，不能由行覆盖率推出已穷举。
- 完整需求审计仍需核对每条规则的边界变体；本表提供已落实的证据及分工，不将文件名、角色拒绝用例或旧执行记录冒充全量需求覆盖。

本地交付应记录实际运行命令、结果、平台和 Node 版本；若精确构建版本或目标平台缺失，产物／平台验证应标注受阻，不调整门禁让它看起来通过。

## 本地执行记录

2026-09-20，Linux x64，以下结果针对本次 worktree 的改动：

| 执行入口                                                      | Node             | 实际结果                                                                    |
| ------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `yarn lab:test:service`                                       | 24.20.0、24.21.0 | 两个版本均为 17 个文件、222 个用例通过；原基线为 72 个用例，本次新增 150 个 |
| `yarn exec vitest run --config tests/lab-vm/vitest.config.ts` | 24.21.0          | 10 个文件、45 个用例通过                                                    |
| `yarn lab:test:server`                                        | 24.20.0          | 正式构建成功，2 个产物用例通过                                              |
| `yarn lab:test:integration`（Linux 使用虚拟显示）             | 24.20.0          | 3 个 Electron 跨端用例通过                                                  |
| `yarn lab:test:soak`                                          | 24.21.0          | 默认 20 轮及专项 200 轮分别通过，12 个设备                                  |
| `yarn lab:test:typecheck`、改动文件的 ESLint / Prettier 检查  | 24.21.0          | 通过                                                                        |
| `node --test scripts/__tests__/lab-design-contract.test.js`   | 24.21.0          | 5 个契约／文档检查通过                                                      |

容器共享 Node 为 24.21.0；精确构建版本 24.20.0 安装在专用 worktree 的忽略缓存目录，核对官方 SHA-256 后仅为对应命令调整 PATH。没有修改构建版本门禁或共享 Node。Windows 矩阵和远端 CI 尚未执行，本地结果不代表这些平台已经通过。

## 固定容量余量及 Windows CI 测试边界修正

容量检查采用固定 1 GiB 余量，适用于归档上传和离线恢复，不随磁盘总容量增加。`failures.test.ts` 仅控制 `statfs` 返回的磁盘状态，保留真实 HTTP、容量判定、SQLite、文件写入和重开：64 GiB 与 8 TiB 数据卷同样剩余 32 GiB 时均可上传；扣除本次写入大小后恰好剩余 1 GiB 时成功，少一字节时拒绝且没有回执、占位或归档；空间恢复后可重试。原百分比实现已在大盘及精确边界两个用例中复现失败。

`local-manager.test.ts` 的 Linux／Windows 是模拟的服务管理器平台，不代表 runner 平台。原测试全局替换 `process.platform` 后，Windows runner 上的 Linux 分支让实际目录同步使用只读句柄，导致 `fsync` 返回 `EPERM`。这组测试现在显式模拟目录同步边界，断言 Linux 卸载需要同步，Windows SCM 分支不调用该边界；同步失败仍须拒绝成功、阻止 daemon-reload 并释放目录锁。运行时、归档及恢复集成测试继续执行当前宿主平台的真实目录同步。
