# 机房目标系统验收

更新日期：2026-09-09。此清单区分已实现功能与尚未取得的目标系统证据。执行时记录 OS 版本、文件系统、机器配置、安装包 SHA-256、步骤、结果和日志；未运行的项目不得标为通过。

## 容器自动验证入口

```sh
yarn lab:contracts:check
node --test scripts/__tests__/lab-design-contract.test.js
node --test scripts/__tests__/lab-installation.test.js
yarn exec vitest run --config packages/lab-server/vitest.config.ts
yarn exec vitest run --config packages/lab-desktop-host/vitest.config.ts
yarn exec vitest run --config apps/lab-student/vitest.config.ts
yarn exec vitest run --config apps/lab-teacher/vitest.config.ts
yarn lab:test:server
xvfb-run -a yarn lab:test:integration
xvfb-run -a yarn test:smoke
xvfb-run -a yarn test:playwright:run
yarn lab:package:student
yarn lab:package:teacher
```

当前运行结果见仓库根目录 `HANDOFF-lab-implementation.md` 的最新记录。构建时的 `dependency-audit.json` 与安装产物的 `package-audit.json` 应随验收结果保留。

## Linux systemd 机器

状态：待目标机执行，容器不提供完整 systemd 登录环境。

1. 安装教师和学生 deb，确认 `.lsjoin` 关联、普通用户登录自启动、两个客户端使用独立数据目录。
2. 教师端本机服务刷新状态，取消一次 pkexec 后重试；安装、启动、激活并初始化。记录 serverId、指纹和端口。
3. 执行 `systemctl status ls101-lab.service`、`systemctl show ls101-lab.service -p User -p MainPID`，确认专用账户。用普通学生账户读取 `/var/lib/ls101-lab/data/control.key` 必须失败。
4. 退出教师端、注销、重启系统，分别验证服务继续运行或按显式自启动设置启动；关闭自启动后再次重启验证。
5. 另一台机器按固定指纹连接，导入入网文件、录制作答、提交并导出。替换证书后应阻止凭据发送，不能自动信任新指纹。
6. 进行维护和备份，保持旧服务运行，直接安装新版教师 deb（不先运行新版解包目录），确认自动检查、停服和升级；缺少备份或在线设备仍在活动时安装应失败且旧服务继续运行。比较升级前后 serverId、回执、作答摘要、自启动设置；停在程序安装前后分别模拟中断并重试。离线设备的陈旧活动心跳不得无限期阻塞升级，最后上报状态应仍可核对。
7. 离线恢复，验证原数据目录仍保留、备份索引已清理、正式回执仍存在、服务处于维护模式；中断恢复后执行 recover-restore。

## Windows x64 / NTFS

状态：未运行。SCM/UAC/ACL、目录 FlushFileBuffers、安装器和卸载器均未获得 Windows 实机结果。不能据此发布已验收的 Windows 支持。

自动套件 `yarn vm:lab`（一次性 Windows Server 2022 虚拟机，设计与用例见 [lab-vm-acceptance-design.md](lab-vm-acceptance-design.md)）自 2026-09-17 起在真实 Windows 宿主机上全绿，当前 15/15 通过。它**只**提供下表标注的自动证据，其余条目仍需人工执行；测试通过不等于本节通过。

| 条目 | 自动证据 | 说明                                                                                                                         |
| ---- | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | 是       | 宿主机在 Windows + Node 24.20.0 下完成两个 NSIS 打包，报告记录产物 SHA-256；WinSW 2.12.0 摘要由门禁按固定值校验              |
| 2    | 部分     | 静默安装（S1）与运行日志中不出现管理密码（S18）；UAC 取消后重试的交互过程仍为人工确认                                        |
| 3    | 是       | `sc.exe qc`/`qsidtype`、受保护 ACL、虚拟服务账户，以及普通用户读 `control.key`、`service.sqlite` 和命名管道均被拒绝（S2–S6） |
| 4    | 否       | M2 已实现 N7（试卷上传下载、作答归档、回执幂等），**尚未在真实宿主机上运行**；断电时的目录 fsync 仍为人工确认                |
| 5    | 部分     | 服务停止与重启的 SCM 语义已覆盖（S14）；维护准入与租约边界由 N8/N10 覆盖（尚未实机运行）；注销与自启动属 S16、G8             |
| 6    | 否       | 待 M4 的 U1、U2 覆盖新版安装器的自动检查、停服与数据保留                                                                     |
| 7    | 否       | 待 M3/M4 的 G4、G5、G8、U3 覆盖学生端登录自启动、`.lsjoin` 关联、二次启动绑定命令与卸载保留                                  |

条目 1 要求的 NSIS 构建日志、`dependency-audit.json` 和 `package-audit.json` 仍需随发布保留：自动报告只保存产物摘要与审计结果，不保存完整构建输出。

1. 在 Windows Node 24.20.0 原生构建环境执行打包命令。保留 NSIS 构建日志和 SHA-256；确认 WinSW 2.12.0 运行文件摘要与构建脚本固定值一致。
2. 安装教师端，取消一次 UAC 后重试，确认界面可以恢复。进程命令行和日志不得出现密码、激活码或一次性证明。
3. 执行 `sc.exe qc LS101Lab`、`sc.exe qsidtype LS101Lab` 和 `icacls "$env:ProgramData\LS101Lab"`，确认虚拟服务账户、受保护 ACL、普通用户不能读取控制密钥或业务数据。
4. 执行服务初始化、保存正式作答、备份和恢复。重点检查目录 fsync 是否成功；任一屏障失败都必须阻止成功结果，记录错误，不得降级忽略。
5. 退出教师端、注销用户、重启系统，验证启停与自启动设置。确认 Windows SCM 停止等待正在完成的写入。
6. 完成维护和新备份，保持旧服务运行，直接执行新版教师 NSIS 安装器（不先运行新版解包目录），验证自动检查、停服、旧程序及数据保留、版本更新、自启动未变；准备检查失败不得停止旧服务，重复安装已验证版本应可恢复。
7. 用普通学生账户检查登录自启动、`.lsjoin` 关联、再次启动传入绑定命令、安装路径含空格；卸载客户端后验证业务数据和服务保留。

## 服务卸载与重装

Linux 和 Windows 均需在目标机验证：运行中卸载按钮不可用；停止后确认卸载，系统服务注册和自启动消失，教师端显示“未安装”；试卷、作答、备份、日志和程序版本仍保留。重新安装相同完整版本不要求升级准备记录，手动启动后原有业务数据可用，自启动保持关闭。模拟拒绝提权、服务管理器错误和 Windows 待删除句柄，确认不会误报卸载成功。替换为不同版本仍须通过备份与升级准备检查。

## 真实音频与故障

状态：待真实音频设备及可断电测试机执行。自动测试中的合成媒体与故障注入不替代本节。

1. 至少两种声卡/耳麦录制回放，检查音量、采样、录音权限、设备拔插及持续练习后的资源占用。
2. 学生保存阶段尝试关窗应被阻止。中断上传后重启，确认本地完整归档存在、正式成功回执不再上传、普通失败仅手动重试。
3. 在本地归档发布、服务端文件持久化与数据库提交、备份发布、恢复目录切换和程序升级切换时分别断电。重启后成功回执对应归档必须可读且摘要一致，不得出现自动空库。
4. 并发执行取消、任务过期、重新绑定、备份与维护切换，检查无过期命令生效、旧连接结果覆盖或半批删除。
5. 用预期机房规模运行持续压力测试，记录内存、句柄、临时磁盘、分页延迟和归档传输耗时。传输句柄达到限制后应明确失败，重连可释放临时资源；未完成操作日志不得静默删除。
