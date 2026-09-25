# 机房独立服务运行与恢复

本页对应独立服务、教师端本机管理、桌面安装器和离线恢复实现。容器验证记录与目标系统验收步骤见 [lab-target-acceptance.md](lab-target-acceptance.md)。Windows SCM、UAC、ACL、目录持久化和真实音频尚未完成目标系统验收。

## 构建与验证

构建环境固定为 Node 24.20.0。构建复制当前平台、架构的 Node 和 7-Zip，记录 Node、SQLite 版本及每个运行文件的 SHA-256；不依赖目标机器全局 Node，不包含 Electron、播放器 UI 或测试许可入口。目标 Linux 仍需具备该 Node 二进制要求的系统动态库。

```sh
yarn lab:test:server
out/lab-server/runtime/node out/lab-server/install-linux.mjs --verify
```

产物位于 `out/lab-server`。测试从仓库外的工作目录启动产物，验证未激活、初始化、本机控制及正常退出。

分别在 Linux 或 Windows 的原生 Node 24.20.0 构建环境生成当前平台安装包：

```sh
yarn lab:package:student
yarn lab:package:teacher
```

Windows 的 WinSW 2.12.0 由 `yarn setup` 下载到 `externals/lab/windows/WinSW.NET461.exe`。已有文件会先核对固定 SHA-256，通过后不再联网；下载失败会重试，并支持 `HTTPS_PROXY`。只准备这一项依赖可运行 `node scripts/lab/download-service-assets.mjs`；`--verify` 校验本地文件，`--verify-upstream` 重新下载并核对固定摘要。Linux setup 跳过此 Windows 资产。

服务构建、教师端开发启动和打包只读取并校验本地 WinSW，缺失或损坏时提示重新运行 setup，不临时下载。文件随服务复制为 `LS101Lab.exe` 并记录到运行清单，教师端安装包携带该文件；目标电脑安装和运行时无需下载 WinSW。

产物分别位于 `dist/lab-student` 和 `dist/lab-teacher`。Linux 为 deb，Windows 为每机 NSIS 安装器；追加 `--dir` 只生成解包目录。学生包不携带服务端、SQLite、AI 模型或编辑器 UI，教师包额外携带独立服务。Vite 输出模块依赖审计，打包后另检查实际 ASAR 文件清单并生成 `resources/package-audit.json`；教师包还按服务运行清单逐文件核对字节数和摘要，包括归档引擎依赖，缺失或不一致时打包失败。审计允许归档校验所必需的纯 Schema 解析、结构与校验函数。

学生端安装器设置系统登录自启动和 `.lsjoin` 关联。教师端安装器安装服务，但启动服务与开启服务自启动仍需管理员明确操作。卸载客户端保留服务程序版本和业务数据。

## 开发运行与测试

安装仓库依赖后，在两个终端分别运行：

```sh
yarn lab:dev:teacher
yarn lab:dev:student
```

这两个入口使用 electron-vite 开发服务器，支持 renderer 热更新；不会启动原来的 LS101 主程序。教师端启动前会构建随包服务工具，需要 Node 24.20.0；构建不安装或启动系统服务。教师端与学生端使用各自的数据目录，开发运行仍需正常激活、连接服务及入网。教师端可以连接已有服务，或在支持的目标系统上通过“本机服务”安装、启动和初始化。修改服务端代码后需重新构建并重启相应服务，客户端热更新不会替换已运行的独立服务。

Linux 无桌面容器中可分别使用以下命令；窗口运行在虚拟显示器内，需要桌面转发工具才能手动查看：

```sh
xvfb-run -a yarn lab:dev:teacher --noSandbox
xvfb-run -a yarn lab:dev:student --noSandbox
```

只验证功能时，优先运行自动化测试，无需安装系统服务或手动初始化：

```sh
yarn lab:test:server
xvfb-run -a yarn lab:test:integration
```

集成测试会在临时目录创建服务与客户端数据，验证入网、练习、作答提交、教师管理和部署测试等流程，结束后清理。真实耳麦、系统提权和服务自启动仍按目标系统验收清单测试。

## 教师端本机管理

未连接和已连接页面都可打开“本机服务”。管理员明确刷新状态后，可安装、启动、初始化、连接、停止服务、设置开机启动、查看最近日志、修改已停止服务的端口或离线恢复。状态展示版本、许可、服务标识和证书指纹。

“服务状态暂时不可用”表示本机状态探测未能确认可用，不等同于系统服务已停止。本机状态读取走 Windows 命名管道／Linux 本地 socket，不经过对外 HTTPS 端口。页面按诊断代码给出处理提示：`LOCAL_STATUS_NOT_READY` 表示连接未建立或中断，`LOCAL_STATUS_ACCESS_DENIED` 表示账户权限拒绝，`LOCAL_STATUS_TIMEOUT` 表示响应超时，`LOCAL_STATUS_INVALID_RESPONSE` 表示响应无法识别，`LOCAL_SERVICE_NOT_LISTENING` 表示已读到状态但业务监听尚不可用。其他错误保留通用 `LOCAL_STATUS_UNAVAILABLE`，不显示底层错误的任意内容。

连接未就绪时短暂重试；超时与权限拒绝直接报告，避免反复等待。读取失败后再次查询系统服务状态：只有确认已停止才显示“已停止”并启用启动；无法确认时仍禁用需要已知状态的操作。点击“重新检查状态”可重新探测，“查看服务日志”可读取最近日志（可能请求管理员授权）。Windows 日志位于 `$env:ProgramData\LS101Lab\logs`；持续权限错误应由管理员检查服务安装和账户权限。不要因为这个提示直接清除数据或强制重启正在使用的服务。

Linux 使用 `pkexec`，Windows 使用 UAC 启动固定的随包管理程序。提权交换使用权限受限的临时目录与 AES-GCM 控制通道，密码和一次性证明不放入进程命令行。一次性证明由教师主进程兑换成会话，renderer 只能取得连接信息。

卸载服务：先按停止要求停止本机服务，刷新状态为“已停止”，再点击“卸载服务”并确认。卸载移除 systemd/SCM 服务注册及开机启动设置，保留业务数据、备份、日志和已安装的程序版本。后台重新检查系统状态并持有服务运行锁，运行中或状态无法确认时拒绝卸载。完成后显示“未安装”；可重新安装同一完整且摘要一致的版本并启动，恢复原有数据。更换版本前应先重装并启动原版本，再遵循升级流程。Windows 若系统仍持有待删除服务的句柄，卸载会报告忙碌；关闭服务管理器等程序后刷新状态。

本机停止要求维护模式、入网和任务等阻塞项已结束，且没有在线设备处于准备、练习、保存或测试阶段。在线判定与设备列表一致：最后接受的心跳在 20 秒内。离线设备的最后状态保留在设备列表供管理员核对，不以陈旧状态无限期阻塞停止；离线本身不证明作答已保存。关闭教师窗口不停止服务。本机管理不定时触发提权，取消系统授权后可重试。

服务不可用或状态读取失败时，可在同一页面选择“强制停止服务”。确认并授权后，固定的本机管理器直接调用系统服务管理器，不依赖失联服务的 `prepare-stop` 或控制通道。先请求系统停止，等待约 30 秒仍未退出才强制结束。进行中的上传、备份、保存可能中断，未完成的交卷需学生重试；该操作不删除业务数据。

故障停止会关闭开机启动；Windows 额外禁用服务以阻止 SCM 崩溃重启。再次点击“启动”时仅恢复手动启动，不自动恢复开机启动。Windows 在结束进程树前检查固定服务 `LS101Lab` 的独立进程注册、安装路径、PID 和独占归属，并持有进程句柄复核身份；Linux 检查固定单元文件和启动程序，通过停止作业抑制自动重启，再按单元终止其 cgroup。无法核实身份或系统命令失败时返回错误，不按进程名称模糊终止。只有系统确认停止且运行时、数据目录锁都可取得，页面才报告“已停止”。

管理员助手在停止前将恢复标记持久化到数据目录相邻的 `.data.emergency-stop.json`，目录切换不会丢失它。新启动与故障停止通过独立锁互斥；启动时先执行现有数据库、归档和未完成工作恢复，再将业务模式持久化为维护模式，最后清除标记。检查失败则保留标记并拒绝启动；中断的离线恢复仍须使用“恢复中断的数据目录切换”。成功启动后教师核对数据和回执，显式退出维护，并按需重新开启开机启动。普通停止保持原有维护和活动检查。

### 无法启动旧版本时导出并清除

如果安装报 `Existing service data has no upgrade preparation record`，而旧服务又无法启动生成准备记录，可打开“本机服务 → 监听端口与备份恢复 → 故障数据导出与彻底清除”。此入口也适用于状态读取失败或安装记录损坏，不要求连接服务、打开数据库或取得升级准备记录。

1. 先停止服务；无法连接时使用“强制停止服务”。后端同时检查系统状态和目录占用，服务仍在运行时拒绝导出及清除。
2. 选择“导出原始数据”，在可信位置选择保存目录。教师端创建独立的 `LS101-recovery-*` 子目录，以 `original/` 保存整个服务数据父目录：Windows 的 `%ProgramData%\LS101Lab` 或 Linux 的 `/var/lib/ls101-lab`，包括数据库、WAL、归档、日志和恢复残留。临时目录锁与本机 socket 不作为业务数据复制；遇到符号链接或其他特殊文件则拒绝继续。`manifest.json` 记录文件大小和 SHA-256，复制后逐项复核。导出失败可能留下未完成副本，但不会开放清除操作。
3. 确认导出位置可访问，在页面输入“清除本机服务”，再选择“彻底清除服务及数据”并确认。助手重新核验导出清单、原目录内容和停止状态；副本缺失／改变或原目录出现新增／改变的文件时拒绝清除，需重新导出。
4. 确认服务注册已移除后，清除已安装的服务程序目录（Windows `%ProgramFiles%\LS101LabService`、Linux `/opt/ls101-lab`）及原数据父目录，保留外部导出副本。教师端程序本身不删除。部分清理失败会报错，可在当前窗口重试；已经删除的文件允许缺失，但剩余文件必须仍与导出一致。退出教师端会丢弃本次清除凭据，再操作需重新导出。Windows 服务若处于待删除状态，先关闭服务管理器等占用窗口再重试。

导出副本含学生作答、密钥和其他服务凭据，必须妥善保管；它是保留故障现场的原始文件副本，不是正常的加密业务备份，也不保证损坏的数据可以恢复。彻底清除不可撤销；之后可以重新安装和初始化新服务，原客户端需要重新入网。不要通过取消正常升级检查来绕过这个流程。

## 升级

先进入维护模式、关闭入网并结束练习和任务，核对离线设备，再创建备份。保持旧服务运行，直接运行新版教师端安装包；安装器在验证随包文件后，调用新版管理程序检查旧服务、为新版目标生成升级准备记录并停止旧服务，再安装程序。无需提前运行新版解包目录。管理程序要求 24 小时内的可用备份，并重新核对归档摘要；检查失败时不会停止旧服务。教师端“本机服务”的升级按钮也使用同样的检查流程。备份应在本次变更结束后创建；当前自动门禁检查备份年龄及完整性，不证明它包含最后一次业务修改。

升级后服务保持停止，检查版本后明确启动。安装器保留业务数据、旧程序版本和已有自启动设置；同一完整且摘要一致的程序版本允许重试安装，不完整或被修改的版本目录会被拒绝。更换程序版本时，已经停止的服务仍须有匹配目标版本的有效准备记录；如果此前手动停止且没有该记录，先启动旧服务，再运行新版安装包。服务重启或取消停止会撤销升级准备记录，安装前需重新准备。

Linux 在程序文件、版本目录、systemd unit 和 `current` 链接切换处执行持久化屏障。Windows 安装与运行时的目录屏障仍需在 NTFS 上验证，不能用容器测试替代断电测试。

## 前台运行

```sh
out/lab-server/runtime/node out/lab-server/server.cjs serve --data-dir /absolute/private/lab-data
```

首次运行只开放本机控制通道；激活并明确初始化之前不开放 HTTPS。重复运行受进程锁拒绝。已有数据库缺失配置、schema 不兼容或恢复尚未完成时，启动失败，不自动建立空库或更改端口。

另一个终端以同一系统账户执行：

```sh
out/lab-server/runtime/node out/lab-server/server.cjs status --data-dir /absolute/private/lab-data
out/lab-server/runtime/node out/lab-server/server.cjs activate --data-dir /absolute/private/lab-data
out/lab-server/runtime/node out/lab-server/server.cjs initialize --data-dir /absolute/private/lab-data
```

`activate` 从标准输入读取一个 JSON 字符串，内容为激活码。`initialize` 从标准输入读取以下结构，输入结束后发送 EOF。密码不作为命令行参数，不写入操作日志。

```json
{
  "name": "Lab",
  "baseUrl": "https://192.168.1.10:8443/",
  "password": "REPLACE_WITH_TEACHER_PASSWORD",
  "config": { "schemaVersion": 1, "port": 8443, "host": "0.0.0.0" }
}
```

服务复用 `packages/license` 的许可规则。HTTPS readiness 与本机控制状态分别报告；本机认证使用权限受限的 `control.key` 和带随机挑战、方向绑定的 AES-256-GCM 认证加密消息。一次性证明只在本机控制通道返回，由宿主用于回环 HTTPS 登录；证明不可跨服务或重复使用，浏览器 Origin 仍被拒绝。Windows 需要安装器为控制密钥及数据目录配置专用账户 ACL，不能以 POSIX mode 参数代替验收。

## Linux 托管

在实际使用 systemd 的 Linux 机器上执行：

```sh
sudo out/lab-server/runtime/node out/lab-server/install-linux.mjs --install
sudo systemctl start ls101-lab.service
sudo systemctl enable ls101-lab.service
```

安装器校验产物、创建专用 `ls101-lab` 账户，将不可变版本目录放在 `/opt/ls101-lab/releases`，并切换 `current` 链接。安装本身不启动服务，不改变自启动设置，不修改 `/var/lib/ls101-lab/data`，保留旧程序版本。已有数据库且更换程序版本时，要求有效的目标版本升级准备记录；重装保留的相同完整运行时不要求该记录。

服务使用 `/var/lib/ls101-lab/data`，父目录由 systemd 按专用账户和 `0700` 权限建立。本机命令需要以该账户执行，例如：

```sh
sudo -u ls101-lab /opt/ls101-lab/current/runtime/node /opt/ls101-lab/current/server.cjs status --data-dir /var/lib/ls101-lab/data
sudo systemctl stop ls101-lab.service
sudo systemctl disable ls101-lab.service
sudo journalctl -u ls101-lab.service -n 100 --no-pager
```

启停和自启动是独立命令。退出教师客户端不会停止该服务。容器只验证构建和配置，不声称已验证系统开机、注销后运行或 systemd 安装效果。

## Windows 托管

管理员 PowerShell 中执行随包 `install-windows.ps1`；`-Verify` 仅核对产物。安装器使用固定 SHA-256 的 WinSW 2.12.0，将版本放在 `%ProgramFiles%\LS101LabService\releases`，SCM 服务名为 `LS101Lab`，运行账户为 `NT SERVICE\LS101Lab`。数据位于 `%ProgramData%\LS101Lab\data`，日志位于相邻 `logs`。数据父目录 ACL 仅授予 SYSTEM、Administrators 和服务 SID 所需权限。

```powershell
powershell.exe -NoProfile -File .\out\lab-server\install-windows.ps1 -Verify
powershell.exe -NoProfile -File .\out\lab-server\install-windows.ps1
Start-Service LS101Lab
Set-Service LS101Lab -StartupType Automatic
Get-Service LS101Lab
```

首次初始化通过教师端本机服务完成。SCM 停止通过随包 Node 发出正常 shutdown，等待持久操作结束。安装不会自动开放防火墙；在目标机按机房网段配置所选 HTTPS 端口。

开发模式也安装真实系统服务；`installation.json` 仍位于 `%ProgramFiles%\LS101LabService`，并在安装全部成功后写入。WinSW 日志中的“installed successfully”只表示服务注册成功，不代表后续账户、权限和安装记录都完成。完整安装应输出 `Service installed and stopped. Autostart is unchanged.`。安装失败时教师端保留安装器退出状态、标准错误及输出摘要；Windows 错误带 `LS101_INSTALL_ERROR [步骤]`，可据此定位失败阶段。带空格的程序路径通过 CIM 配置；虚拟服务账户通过 `sc.exe config` 配置并省略密码参数，避免把空字符串密码传给 CIM 或被 Windows PowerShell 丢弃。

## 保留与恢复操作

教师端“未确认操作”保留结果未知的写入及原幂等键，按服务隔离。重新输入敏感字段或选择摘要相同的原归档后重试；仅成功重放会结束原未知记录。密码不写入操作日志。

正式作答和回执不按时间清理。测试作答与媒体保留 7 天，终态任务、测试运行、清理计划及日志保留 90 天，过期会话及幂等记录按服务规则回收。学生启动清理已报告且到期的测试数据。传输临时文件在连接关闭或下次启动时清理，不删除正式本地作答归档。

## 离线恢复

先停止服务，以数据目录所属账户运行：

```sh
out/lab-server/runtime/node out/lab-server/server.cjs restore --data-dir /absolute/private/lab-data
```

从标准输入提供 `{"archive":"/absolute/backup.7z","password":"BACKUP_PASSWORD"}`。密码长度为 1 至 1024，不含 CR、LF、NUL。恢复拒绝仍在运行的服务、错误密码、不匹配的发布版本或 schema、危险路径、重复条目、超限清单及摘要不一致。解压引擎只向 stdout 输出已核对的条目，由恢复工具创建受控文件，不让引擎按归档路径写盘。

验证通过后，恢复目录中以一个事务撤销教师会话、清空备份索引及备份创建幂等映射，清空属于原目录且不在快照内的垃圾清理记录，保留正式回执、删除事实及其他业务幂等记录。服务保持维护模式。许可及监听配置随快照恢复；本机控制密钥在服务重启时重新生成。

切换前写入持久恢复记录。原目录保存在相邻 `.目录名.previous-UUID`，成功命令返回其路径。目录锁位于不会随切换移动的相邻文件，不应手工删除。切换中断会阻止普通启动，使用匹配版本执行：

```sh
out/lab-server/runtime/node out/lab-server/server.cjs recover-restore --data-dir /absolute/private/lab-data
```

该命令重新验证待安装目录并继续切换，不删除原目录。切换记录建立之前的失败保留当前数据；可重新执行原恢复命令。Windows 目录持久化、SCM、账户权限及断电恢复仍需目标系统验收。
