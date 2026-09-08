# 机房独立服务运行与恢复

本页对应独立服务、Linux 托管和离线恢复实现。教师端本机管理页面、Windows SCM 安装器及 Windows 账户权限仍需后续接入和目标系统验收。

## 构建与验证

构建环境固定为 Node 24.20.0。构建复制当前平台、架构的 Node 和 7-Zip，记录 Node、SQLite 版本及每个运行文件的 SHA-256；不依赖目标机器全局 Node，不包含 Electron、播放器 UI 或测试许可入口。目标 Linux 仍需具备该 Node 二进制要求的系统动态库。

```sh
yarn lab:test:server
out/lab-server/runtime/node out/lab-server/install-linux.mjs --verify
```

产物位于 `out/lab-server`。测试从仓库外的工作目录启动产物，验证未激活、初始化、本机控制及正常退出。

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

安装器校验产物、创建专用 `ls101-lab` 账户，将不可变版本目录放在 `/opt/ls101-lab/releases`，并切换 `current` 链接。安装本身不启动服务，不改变自启动设置，不修改 `/var/lib/ls101-lab/data`，保留旧程序版本。升级要求先完成维护、结束练习及任务、关闭入网并备份，再停止服务和桌面进程。相同版本目录已存在时安装器拒绝覆盖。

服务使用 `/var/lib/ls101-lab/data`，父目录由 systemd 按专用账户和 `0700` 权限建立。本机命令需要以该账户执行，例如：

```sh
sudo -u ls101-lab /opt/ls101-lab/current/runtime/node /opt/ls101-lab/current/server.cjs status --data-dir /var/lib/ls101-lab/data
sudo systemctl stop ls101-lab.service
sudo systemctl disable ls101-lab.service
sudo journalctl -u ls101-lab.service -n 100 --no-pager
```

启停和自启动是独立命令。退出教师客户端不会停止该服务。容器只验证构建和配置，不声称已验证系统开机、注销后运行或 systemd 安装效果。

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
