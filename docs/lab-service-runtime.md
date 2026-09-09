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

产物分别位于 `dist/lab-student` 和 `dist/lab-teacher`。Linux 为 deb，Windows 为每机 NSIS 安装器；追加 `--dir` 只生成解包目录。学生包不携带服务端、SQLite、AI 模型或编辑器 UI，教师包额外携带独立服务。Vite 输出模块依赖审计，打包后另检查实际 ASAR 文件清单并生成 `resources/package-audit.json`。审计允许归档校验所必需的纯 Schema 解析、结构与校验函数。

学生端安装器设置系统登录自启动和 `.lsjoin` 关联。教师端安装器安装服务，但启动服务与开启服务自启动仍需管理员明确操作。卸载客户端保留服务程序版本和业务数据。

## 教师端本机管理

未连接和已连接页面都可打开“本机服务”。管理员明确刷新状态后，可安装、启动、初始化、连接、停止服务、设置开机启动、查看最近日志、修改已停止服务的端口或离线恢复。状态展示版本、许可、服务标识和证书指纹。

Linux 使用 `pkexec`，Windows 使用 UAC 启动固定的随包管理程序。提权交换使用权限受限的临时目录与 AES-GCM 控制通道，密码和一次性证明不放入进程命令行。一次性证明由教师主进程兑换成会话，renderer 只能取得连接信息。

本机停止要求维护模式、入网和任务等阻塞项已结束，且没有设备处于准备、练习、保存或测试阶段。关闭教师窗口不停止服务。本机管理不定时触发提权，取消系统授权后可重试。

## 升级

先进入维护模式、关闭入网并结束练习和任务，再创建备份。用新版本解包目录启动教师端，打开本机服务并执行升级。管理程序要求 24 小时内的可用备份，重新核对归档摘要，为随包目标版本写入升级准备记录，然后停止服务并安装程序。备份应在本次变更结束后创建；当前自动门禁检查备份年龄及完整性，不证明它包含最后一次业务修改。

升级后服务保持停止，检查版本后明确启动。安装器保留业务数据、旧程序版本和已有自启动设置；同一完整且摘要一致的程序版本允许重试安装，不完整或被修改的版本目录会被拒绝。服务重启或取消停止会撤销升级准备记录，安装前需重新准备。不要直接在运行中的服务上覆盖安装。

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

安装器校验产物、创建专用 `ls101-lab` 账户，将不可变版本目录放在 `/opt/ls101-lab/releases`，并切换 `current` 链接。安装本身不启动服务，不改变自启动设置，不修改 `/var/lib/ls101-lab/data`，保留旧程序版本。已有数据库要求有效的目标版本升级准备记录。

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
