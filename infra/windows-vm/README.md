# Windows 虚拟机自动化

宿主机入口是 **JavaScript + Yarn**。在 Windows x64 宿主机上，用 Packer 构建独立基础 box，再用 Vagrant 创建、关机和销毁一次性 VMware 虚拟机。

`vm:cycle` 自动执行创建、等待 WinRM 就绪、关机和销毁，并在宿主机写入 JSON 结果。`vm:acceptance` 每轮创建全新的临时 VM，上传当前源码快照，在 guest 执行 `corepack enable`、准备 Yarn 4.15.0、`yarn install --immutable`、`yarn build:test`，然后依次运行 smoke 套件（`tests/integration/electron-app.spec.ts`）和 `yarn test:product-docs:run`，保存日志后仅在成功时自动关机并销毁。两个套件原本各自都会先跑一遍 `build:test`，因此这里只打包一次、两个套件跑同一份产物。

`vm:lab` 是机房部署的目标机验收，设计与用例见 [../../docs/lab-vm-acceptance-design.md](../../docs/lab-vm-acceptance-design.md)。它在**宿主机**编译教师端与学生端安装包，在全新 VM 中**完整安装**教师端，然后断言只有真机才能证明的部分：SCM 注册与虚拟服务账户、`%ProgramData%` ACL 对真实标准用户的拦截、session 0 托管、命名管道控制通道、真实激活与初始化、`0.0.0.0` 监听、由宿主机在加规则前后各测一次的防火墙门控，以及升级、客户端/服务卸载与数据保留（M4：同版本重装、版本变化的准入拒绝、真实准备后的安装器升级、卸载后重装的 serverId 与回执保留）。guest 只安装产物、不构建源码，因此**不需要 Yarn 或 node_modules**。宿主机必须恰好是 Node 24.20.0 x64（`scripts/lab/build-server.mjs` 的硬要求），并且需要在 `config.local.json` 中填写真实 `InvitationCode`：生产代码没有测试用激活后门，脚本会在启动 VM 之前就检查这两项，不满足时直接停下而不是绕过。guest 侧驱动器由宿主机用仓库自带的 Vite 打包，无需在 VM 内安装任何东西。

**guest 侧的语言分工**：编排与全部判断都在 Node 里（`guest/lab-acceptance.mjs` 与 `guest/lab-harness.mjs`），因为它们能在 `yarn vm:test` 中执行。早期用 PowerShell 实现同样的辅助函数时，连续暴露了变量遮蔽、`[bool]` 参数绑定、单行 JSON 解析三类缺陷——每一类都要重建一次 VM（约 7 分钟）才能发现，而同样的逻辑在 Node 里当场就能测出来。PowerShell 只保留 `guest/lab-probes.ps1`：每个探针输出**一行**带 `LS101PROBE|` 标记的 JSON，不做任何判断（ACL、CIM 服务与进程、监听端口、防火墙、事件日志、提升权限、标准用户凭据）。`start-lab-acceptance.ps1` 只负责重定向子进程的输出，因为"启动即失败"的诊断必须在被测进程之外完成。

**文件传输**：guest 内的 `guest/fileserver.mjs` 提供 HTTP 文件服务（`PUT /files/<name>` 上传、`GET /files|results/<name>` 下载），宿主机在 VM 启动后读取 guest 的 NAT 地址（拥有默认网关的那块网卡）并作为客户端直连 `http://<guest-ip>:8765`。因此 58 MB 源码快照与日志、预览产物的往返都是普通 HTTP 流式传输，而不是 WinRM 的 Base64 分块。**不给文件服务单独开宿主转发端口**：实测 18765 会与宿主上其他程序冲突并直接中断 `vagrant reload`；直连虚拟网段既避开端口冲突，也少一层 NAT 用户态转发。宿主机侧不需要任何防火墙规则（连接由宿主发起），只有 guest 内一条 `LocalSubnet` 入站规则（由 acceptance 通过 WinRM 添加）；密码等凭据仍只走加密的 WinRM 通道（自动登录脚本用 `vagrant upload` 投递）。**宿主若配置了 HTTP 代理，手工探活必须绕过它**：`curl.exe` 与 `Invoke-WebRequest` 会读 `http_proxy` 把私网地址请求交给代理，代理路由不到就回 `502 Bad Gateway`（用 `curl.exe --noproxy "*" http://<guest-ip>:8765/health` 或 `Test-NetConnection -ComputerName <guest-ip> -Port 8765`）；acceptance 自身的传输用 `node:http`，不读代理环境变量，因此不受影响。仅 `fileserver.mjs` 本身与自动登录脚本仍用 `vagrant upload`（各约 3 KB，是启动文件服务所必需的引导步骤）；下载路径在文件服务不可用时自动回退到原有的分块 WinRM 读取。

应用只有在渲染进程 DOM 就绪并显示主窗口之后才会完成启动，而 WinRM 命令运行在 session 0，无法提供窗口，因此 acceptance 会先为一次性 VM 打开控制台自动登录并重启，再通过以 `vagrant` 交互式运行的计划任务执行测试；基础 box 本身不保存自动登录设置。guest 固定使用 `LS101_SETUP_MODE=product-docs`：只下载打包需要的轻量 Qwen TTS runtime、lab 服务资源和本地生成的文件图标，跳过数 GB 的 Qwen、Pocket TTS、STT 与发音模型本体。宿主机同时回传 `acceptance.log`、`progress.txt` 和 `acceptance-artifacts.zip`（产品文档预览 Markdown/截图、smoke 失败时的 trace，以及日志与阶段时间线）到 `infra/windows-vm/.local/results/<run-id>/`。测试失败、超时或命令需要交互输入时保留 VM 供排查；结果 JSON 的 `state` 会标记为 `failed` 或 `manual-required`。修改 guest 工具链脚本后需重新构建基础 box。

## 宿主机准备（一次）

- Windows x64，启用硬件虚拟化；使用原生终端，不使用 WSL。
- 安装 Node.js 22 或更新版本以及项目要求的 Yarn（根 package.json 的 packageManager）。脚本本身只使用 Node 内置模块，无需安装项目 node_modules；也可直接运行 `node infra/windows-vm/lab.mjs <操作>`。
- 安装 VMware Workstation Pro 17.x、Vagrant、Vagrant VMware Utility。Utility 是 provider 需要的宿主机服务，脚本不静默安装这些系统组件。
- 项目放在本地可写 NTFS 盘，建议至少 16 GB 内存和 100 GB 以上可用磁盘空间。默认 guest 为 4 核、8 GB、128 GB 动态磁盘。
- VMware NAT/DHCP（VMnet8）须可用。下载来源和固定版本见 [SOURCES.md](SOURCES.md)。

`vm:up` 和 `vm:cycle` 会在调用 Vagrant 前检查实际服务名 `VagrantVMware`（显示名为 `vagrant-vmware-utility`）；服务已安装但未运行时会自动启动。普通权限终端会只为这个固定的 `Start-Service` 命令弹出一次 UAC，提权子进程执行完即退出，Node、Packer、Vagrant 和后续操作仍保持原权限。服务缺失或无法启动时，脚本会直接报告 `127.0.0.1:9922`，请修复 Utility 安装后重试。

脚本会自动将 `127.0.0.1` 和 `localhost` 加入传给 Vagrant/Packer 的 `NO_PROXY` 与 `no_proxy`。如果环境设置了 HTTPS 代理，Vagrant 的本地 WinRM 转发（默认 `127.0.0.1:55986`）仍会直连，不会被发送到代理端口。

Packer 设置 `vmx_remove_ethernet_interfaces = true`，导出的 box 只保留主 NAT 网卡。Vagrant VMware Desktop 在 Windows guest 上不能自动配置第二块及后续网卡；旧 box 仍可能显示该提示，需要用新模板重新构建 box。

Vagrant 可能在启动时显示 `Configuring secondary network adapters ... not yet supported`。这是 VMware provider 对 Windows guest 的提示，不代表 `vm:up` 失败；以命令末尾的 `SUCCESS: up completed successfully.`、退出码和 `.local/results/*.json` 中的 `success: true` 为准。

### VMware Workstation 26H1 注册表兼容项

Workstation 26H1 改为全 64 位，而部分 Vagrant VMware Utility 版本仍查找旧的 `WOW6432Node` 注册表位置，可能导致服务日志出现 `failed to generate VMware installation information`。仓库提供了社区验证过的兼容文件 [utility-fix.reg](utility-fix.reg)。确认 VMware 安装路径确实是 `C:\Program Files\VMware\VMware Workstation\` 且版本为 `26.0.0.25388281` 后，以管理员身份双击导入，再运行：

```powershell
Restart-Service VagrantVMware
Test-NetConnection 127.0.0.1 -Port 9922
```

该文件只增加 Utility 需要的兼容注册表值，不替换 VMware 文件。卸载或升级 Workstation 后若安装路径/版本变化，应删除这些兼容值或重新生成文件，避免保留过期路径。

脚本固定支持 Windows Server 2022 Evaluation 英文版 **Standard Desktop Experience**，采用 BIOS/MBR。不能直接将 ISO 换为 Windows 11。真实 Windows 11 兼容性需要另建对应模板验证。

## 创建基础 box（一次）

以下命令均从仓库根目录执行，PowerShell 或 cmd 均可：

```text
yarn vm:setup
```

这一个命令会按顺序创建缺失的本地配置、下载准备工具和 ISO、校验模板并构建基础 box。已有配置和密码原样保留；已有完整 box 时校验后复用，不重复下载或构建。整个流程共用一把操作锁，结果写入宿主机报告。下载失败可以重试；若 Packer 已留下不完整构建产物，会要求先检查并归档，避免覆盖现场。

**默认已经填好两个官方 ISO 直链，摘要模式为 `auto`，无需手动下载 ISO 或填写摘要。** 完成后运行 `yarn vm:up` 创建测试虚拟机，或 `yarn vm:cycle` 验证创建、关机、销毁流程。

以下细分命令仍保留，供自定义配置或单独排查问题时使用，日常无需逐个执行：

```text
yarn vm:init
yarn vm:prepare
yarn vm:box:validate
yarn vm:box:build
```

- `prepare` 自动创建下载目录，从微软下载 Server 2022 Evaluation English x64 ISO（约 5.04 GB），从 VMware 官方目录下载固定版本 Tools 13.1.5 ISO（约 142 MB），然后准备 Packer、Node、MinGit 和 Packer 插件。
- 下载采用流式写入并显示进度，不把整个 ISO 装进内存。完成后检查文件长度（服务器提供时）和 ISO-9660 标识，拒绝 HTML 登录页、下载不完整和摘要不符的文件。
- 默认 `auto` 仅允许示例中固定的官方 HTTPS 直链。首次下载计算 SHA-256，写入 `.local/generated/iso-lock.json`；这是“首次从官方 HTTPS 下载后记录的指纹”，**不是与独立官方 SHA-256 清单核对的结果**。后续准备和构建按记录校验；资源内容变化时拒绝静默接受。
- 已完成的 ISO 下次直接校验复用，包括第二个 ISO 下载失败后的重试。未完成的临时文件会清理；当前没有断点续传，重试会重新下载那个未完成文件。已有文件却没有首次下载记录时，拒绝自动认可，需填写其经过核对的 SHA-256 或先移走该文件再下载。
- `box:validate` 校验 Packer 模板，不创建 VM，不更新已构建 box 的 guest 凭据。
- `box:build` 使用已配置/锁定的摘要重新校验文件，从 ISO 安装系统并导出 box。不会读取或复制应用代码，也不执行 Yarn install。

构建默认使用 `headless = true`，通过 `vmrun start ... nogui` 启动 VM。部分 Windows Workstation 环境的 GUI 启动命令会一直等待窗口关闭，导致 VM 已进入桌面，Packer 却还未执行 VNC 按键和 WinRM 连接（见 [上游报告 #280](https://github.com/vmware/packer-plugin-vmware/issues/280)）。后台启动仍支持 VNC；需要观察安装界面时，使用 Packer 输出的 VNC 地址和密码。

构建传入 `-on-error=abort`，遇到构建步骤错误时退出并跳过自动清理，保留 VM、磁盘和安装介质供排查。VM 可能仍在运行，排查后应在 Workstation 中关闭它，再归档 `.local/build/windows-server-2022` 后重建。`vm:halt` / `vm:destroy` 管理的是 Vagrant VM，不能用来关闭或清理 Packer 构建 VM；Packer 也不能直接从失败步骤续建。旧版默认清理会打印 `Deleting output directory...`；如果 VMX/VMDK 已被删除，Workstation 中残留的条目无法重新启动，需要重新构建。

### 启动停滞与端口排查

Packer 的顺序为：启动 VM → 连接 VNC → 发送启动按键 → 等待 WinRM → 上传并安装工具。先查看 `.local/logs/packer.log` 最后完成的阶段：

- 停在 `Executing: ... vmrun.exe -T ws start ... gui`，直到关闭 VM 才出现 `Connecting to VNC...`：符合 GUI 启动命令阻塞的现象，确认使用当前后台启动配置。
- `Connecting to VNC...` 后连接被拒绝：检查构建 VM 是否仍在运行及宿主机 VNC 是否监听。此时尚未执行 WinRM 连接，不应修改 WinRM 地址来修复 VNC。
- Windows Boot Manager 只有 `Windows Setup [EMS Enabled]` 且没有倒计时：这是安装光盘的启动选项，选中它按一次 Enter 即可继续，保持 Packer 运行，无需重建。启动按键序列已在末尾增加 Enter；旧序列只发送空格，可能留下等待确认的菜单。新序列需要在 Windows 宿主机验证启动时序。
- 已到 `Waiting for WinRM...`：检查 guest 的 `C:\Windows\Temp\ls101-bootstrap.log`、HTTPS listener 和防火墙，并从宿主机测试 `Test-NetConnection <虚拟机IP> -Port 5986`。

Packer 配置 `winrm_no_proxy = true`，为当前 guest 的 IP/端口绕过宿主机代理；ISO 和工具下载仍可使用其原有代理配置。插件 1.1.0 的 WinRM 客户端默认读取代理环境变量，因此原生 `winrm identify` 成功不代表 Packer 使用了相同的网络路径。`winrm_insecure = true` 只跳过服务器证书校验，不控制代理或 TLS 重协商。

如果 Packer 的 HTTPS POST 返回 `EOF`，而原生客户端可连接，先检查启动 Packer 的终端是否设置了 `HTTPS_PROXY` / `NO_PROXY`，并测试实际远程命令（如通过 `Invoke-Command` 执行 `whoami`）。`IdentifyResponse` 仅验证 Identify 请求，Packer 在连接检查中还会创建 shell、执行命令。单凭 curl 的 TLS 重协商提示和 `EOF`，不能认定重协商是根因。修改模板不会改变已经运行的 Packer 进程；先保留当前 VM 排查，再决定是否重新构建。

VMware Tools 通过第一个 `file` provisioner 显式上传 `var.tools_iso`，再由 `install-tools.ps1` 校验 SHA-256 并安装。[VMware 插件 1.1.0 的 vmware-iso builder](https://github.com/vmware/packer-plugin-vmware/blob/v1.1.0/builder/vmware/iso/builder.go#L59) 创建 `StepPrepareTools` 时漏传 `ToolsSourcePath`，导致内置上传忽略指定的项目 ISO，回退到 Workstation 安装目录的 `windows.iso`；不能用其 `tools_upload_flavor` / `tools_source_path` 组合选择项目资产。当前配置关闭内置 Tools 上传，不依赖 Workstation 自带的 Tools ISO。校验失败会输出预期摘要、实际摘要及文件大小，并在安装前停止。

Tools 上传期间不一定立即生成 `C:\Windows\Temp\vmware-tools.iso`。固定版本的 [winrmcp 上传实现](https://github.com/packer-community/winrmcp/blob/c76d91c1e7db/winrmcp/cp.go) 先通过 WinRM 将约 6 KB 的数据块编码为 Base64，逐块追加到远程用户 `%TEMP%\winrmcp-<UUID>.tmp`，全部上传后才解码生成目标 ISO 并删除临时文件。Packer 使用 vagrant 账户，其临时目录不一定与当前 Administrator 桌面的 `$env:TEMP` 相同。当前日志应显示文件 provisioner 的 `Uploading ...windows-vmware-tools.iso => C:/Windows/Temp/vmware-tools.iso`，而非旧的 `Uploading VMware Tools (windows)...`。

在虚拟机的管理员 PowerShell 中运行下面的只读命令，隔 30–60 秒再运行一次，比较 `Length` 是否增长：

```powershell
Get-ChildItem -Path 'C:\Users\vagrant*\AppData\Local\Temp', 'C:\Windows\Temp' `
  -Filter 'winrmcp-*.tmp' -Recurse -Force -ErrorAction SilentlyContinue |
  Select-Object FullName, Length, LastWriteTime
```

Base64 临时文件最终约为原始 ISO 大小的 4/3（另有换行开销）。大量逐块远程命令可能使上传持续几十分钟或更久，应根据临时文件增长速度判断进度，不根据目标 ISO 是否存在判断。临时文件不增长、始终找不到或上传报错时，再检查宿主机 `packer.log` 的最新内容。

| 地址/端口                                 | 用途                                                                |
| ----------------------------------------- | ------------------------------------------------------------------- |
| 宿主机 `127.0.0.1:59xx`（以本次日志为准） | VMware VNC，用于安装界面和启动按键                                  |
| 虚拟机 IP 的 `5986`                       | 本项目 Packer 使用的 HTTPS WinRM                                    |
| `5985`                                    | HTTP WinRM，Bento 默认使用，本项目 bootstrap 删除 HTTP listener     |
| 宿主机 `127.0.0.1:55986`                  | 基础 box 构建成功后，Vagrant VM 的 HTTPS WinRM 转发；冲突时可能调整 |

基础 box 构建阶段没有将 guest 的 WinRM 转发到宿主机 `127.0.0.1:5986`。测试该地址失败、测试虚拟机 IP 的 5986 成功，并不意味着 Packer 配错了 WinRM 地址。

默认来源见 [SOURCES.md](SOURCES.md)。官方直链若失效会直接报错，不抓取登录/许可页面，也不切换到镜像站或新版本。准备结果在 `.local/logs/asset-inventory.json`，包含所用地址、摘要及验证方式。

已有旧版 `config.local.json` 的用户：从 `config.example.json` 复制 `WindowsIsoUrl`、`VMwareToolsIsoUrl` 和两个值为 `auto` 的 `*IsoSha256` 字段到本地配置，保留自己的密码和硬件参数。`vm:init` 不会覆盖已有配置。若已有手工放入的 ISO，请保留其明确 SHA-256，不要改为 auto 后直接认可旧文件。

### 自备镜像或调整硬件

| 字段                                    | 内容                                                                    |
| --------------------------------------- | ----------------------------------------------------------------------- |
| WindowsIso / VMwareToolsIso             | 本地保存路径；相对路径以 infra/windows-vm 为起点                        |
| WindowsIsoUrl / VMwareToolsIsoUrl       | HTTPS 下载地址；文件缺失时使用。仅使用本地文件时可省略                  |
| WindowsIsoSha256 / VMwareToolsIsoSha256 | 默认官方源可用 auto；自定义地址或手工放入的文件需要明确的 64 位 SHA-256 |
| WindowsImageIndex                       | Standard Evaluation (Desktop Experience) 的实际索引，当前默认 2         |
| Cpus / MemoryMB / DiskMB                | guest CPU 数、内存 MB、磁盘 MB                                          |
| ManualMemoryMB                          | 手动测试机（`vm:teacher` / `vm:student`）的内存 MB，默认 4096           |

JSON 路径建议使用 `/`。更换 Windows ISO 时，在管理员终端核对镜像索引，不要直接沿用默认 2。挂载 ISO，假设盘符为 E:：

```text
dism.exe /Get-WimInfo /WimFile:E:\sources\install.wim
```

若 ISO 使用 install.esd，替换文件名。当前默认索引尚未通过 Windows 原生构建验证。

box、SHA-256 和对应 guest 凭据只在构建成功后发布。默认产物为 `.local/boxes/ls101-windows-server-2022-vmware.box`。已有 box、构建输出或已发布 guest 元数据时拒绝覆盖；需要重建时先销毁运行 VM，再自行归档旧产物和元数据。失败的 Packer 构建输出也需要先检查并归档。修改本地配置中的密码不会改变已有 box 的密码。

构建会在新建虚拟机内接受 Windows 许可条款并清空其磁盘 0；模板没有宿主机物理磁盘直通。Evaluation 有试用期限，box 仅供本地实验使用。

## 自动创建、关机、销毁

```text
yarn vm:up
yarn vm:status
yarn vm:halt
yarn vm:destroy
```

`up` 重新校验 box 字节及凭据绑定，按需安装固定的 VMware provider 3.0.5，由 Vagrant 自动注册本地 box、创建 VM 并等待 WinRM 就绪。注册名包含 box SHA-256，避免换镜像后意外复用旧 box。再次执行 `up` 可以启动已经关机的 VM。已有其他 provider 版本时会报错，不自动替换。

`halt` 关闭本项目的 VM。`destroy` **无交互确认地销毁本项目的 Vagrant VM 及其磁盘**，不删除基础 box、Packer 构建 VM、下载缓存、结果或源码。两个命令不要求重新下载或校验 ISO/基础 box，因此准备资产丢失时仍可处理运行 VM。

一次自动验证整个生命周期：

```text
yarn vm:cycle
yarn vm:acceptance
```

流程为：检查没有已存在的 Vagrant VM → 创建/启动 → 等待 WinRM → 关机 → 销毁。已有 VM（包括关机状态）时拒绝执行，避免删除调试现场。创建失败后仍尝试关机和销毁；关机失败后仍尝试销毁。任何阶段失败都会使命令返回非零，不会被后续清理成功掩盖。

每个操作在 `.local/results/<时间>-<操作>-<唯一标识>.json` 写入宿主机结果，包含步骤、起止时间、退出码及失败摘要。结果不含密码或环境变量，不是 guest 应用测试报告。外部命令的实时输出显示在终端；Packer 详细日志为 `.local/logs/packer.log`。

所有命令通过项目内状态目录和排他锁串行执行。进程被强制结束、断电或终端关闭时，无法保证 finally 清理或结果写入；可能保留 VM 和 `.local/operation.lock`。确认 Node、Packer、Vagrant 已退出后再移除该锁，随后运行 `yarn vm:status` 和 `yarn vm:destroy`。不要在另一个操作仍运行时删除锁或绕过入口直接调用 Vagrant。

## 手动测试机（教师端 / 学生端各一台）

上面那些命令里的 VM 都是**一次性**的：跑完就关机销毁，失败才留现场。要用手点着测产品界面时，用下面这两台**长期存在**的机器：

```text
yarn vm:teacher:boot     # 建一台教师机并留在运行状态
yarn vm:teacher:reset    # 先删再建（不存在就直接建）
yarn vm:teacher:delete   # 删掉
yarn vm:teacher:status   # 看状态
yarn vm:student:boot / reset / delete / status
```

两台机器与一次性验收机的关系：

|                | 一次性验收机（`vm:lab` / `vm:acceptance`）              | 手动测试机                                                 |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Vagrant 机器名 | `default`                                               | `teacher` / `student`                                      |
| 状态目录       | `.local/vagrant-state`                                  | `.local/vagrant-state-manual-<role>`（各自独立，互不影响） |
| 基础镜像       | 同一个 Packer box（共用 `VAGRANT_HOME` 里的注册与凭据） | 同上                                                       |
| 生命周期       | 跑完自动销毁                                            | 一直留着，直到 `delete` / `reset`                          |

`boot` 的语义是**不能复用**：只要同名机器存在（运行中、关机、挂起都算），它就报错让你选 `reset` 或 `delete`——一台关机的旧机器里还是上一版的安装包和上一次的 Windows 状态，这正是手动测试最不该出现的东西。`reset` 就是"不自动清除旧机器的那一步也做掉"：存在先删、不存在直接建。

`boot` 和 `reset` 都会做这几件事，然后留着机器给你用：

1. 在宿主机上用当前源码树重新打包对应角色的安装包（`--no-build` 可跳过，复用 `dist/` 里已有的）；
2. 从同一个基础 box 起一台**全新系统**的 VM，并打开 VMware 控制台窗口（`gui = true`）；
3. 打开自动登录并重启一次，这样你直接就能看到桌面；
4. 通过 guest 内的文件服务把安装包传进去（放 `C:\ls101-lab\transfers\`），并在桌面放一个指向它的快捷方式；
5. 教师机额外放行入站 8443，这样学生机能连上它的服务；学生机不做这件事（它不提供服务）。

顺序上**先打包再动 VM**：构建失败时旧机器原样保留。所有可能在真机上出问题的判断（同名拒绝、先建后删、`reset` 容忍不存在）都有 `scripts/__tests__/manual-vm.test.js` 覆盖，但它们只验证宿主机编排；起 VM、装 VMware 这些只能在 Windows 上真跑。

两个客户端第一屏都是激活页，所以每台机器里会放一份邀请码：`C:\ls101-lab\invitation.txt`。它和验收流程一样**只经加密的 WinRM 通道**进入 guest，不走承载大文件的明文 HTTP 文件服务，也不打印到终端（来源是 `config.local.json` 的 `InvitationCode`）。

两台机器可以同时运行：WinRM 转发端口不同（教师 55996 / 学生 55997，冲突时 Vagrant 自动换），VMware 里的显示名分别是 `ls101-manual-teacher` 和 `ls101-manual-student`。guest 内的自动登录账户是 `vagrant`，密码在 `config.local.json` 的 `GuestPassword`（不打印到终端）。

内存是**手动测试机与验收机唯一的硬件差异**：手动机按 `config.local.json` 的 `ManualMemoryMB`（默认 4096）起，验收机继续用 `MemoryMB`（8192）——手动机是人工点界面，验收机要用 32 个客户端并发心跳，两者不该共用一个数字。因此三台 VM 同时开约需 16 GB 内存（4 + 4 + 8）。这个值在 `vagrant up` 时生效，已经存在的机器不会因为改了配置而变小或变大，要生效就 `reset` 一次。

## 后续应用测试流水线的边界

基础 box 保持通用。`vm:acceptance` 在 Vagrant 创建的临时 VM 中传入当次源码快照，再安装依赖、执行测试，将日志、Playwright 报告和退出码导出到宿主机 `.local/results/<run-id>/`，确认导出完成后关机、销毁。源码快照使用 `git ls-files -co --exclude-standard`，包含已跟踪文件和未被 `.gitignore` 忽略的未跟踪文件，并排除 `.git`、宿主机 `node_modules`、构建产物、VM 存储和本地凭据。当前 Vagrantfile 禁用共享目录，也没有 provision 应用。

Electron 桌面测试需要已登录的交互桌面；直接用 WinRM 启动测试不能证明 UAC/桌面行为正确。基础 box 关闭自动登录，下一阶段需要在一次性 VM 中建立明确的桌面测试会话和任务完成协议。现有服务测试中采用 fixture/mock 的断言也不能当作真实 SCM 安装验收。

## 文件位置与保留行为

| 路径（infra/windows-vm 下）          | 用途                                                    |
| ------------------------------------ | ------------------------------------------------------- |
| config.local.json                    | 本机配置及测试密码，已忽略                              |
| .local/downloads                     | 官方 ISO、ZIP                                           |
| .local/tools                         | Packer 和插件                                           |
| .local/build                         | Packer 原始 VM，vm:destroy 不删除                       |
| .local/boxes                         | 基础 box 及摘要，vm:destroy 不删除                      |
| .local/vagrant-home                  | 本项目 provider 插件和注册 box 缓存                     |
| .local/vagrant-state                 | 当前 Vagrant VM 状态                                    |
| .local/vms                           | Vagrant 创建的完整克隆                                  |
| .local/generated                     | ISO 下载摘要记录、Packer 参数和与 box 绑定的 guest 凭据 |
| .local/results                       | 宿主机生命周期结果，vm:destroy 不删除                   |
| .local/logs                          | Packer 日志和资产清单                                   |
| .local/cache、config、tmp、transfers | 缓存、工具配置、临时文件、后续传输目录                  |

这些本地文件全部被 gitignore 排除。配置、安装软盘、构建 VM 和 box 可能含测试凭据，不应提交或分享。VMware/Vagrant/Utility 的全局安装、驱动、服务、注册表和系统日志仍由宿主机管理。

默认使用 VMware NAT；HTTPS WinRM 转发绑定 `127.0.0.1:55986`，冲突时自动调整。禁用 HTTP WinRM/RDP 转发。guest 的 HTTPS WinRM 使用自签名证书、Basic over HTTPS，防火墙允许本地子网，同一 NAT 网络的其他 VM 可能访问它。保留 UAC/Defender；`LocalAccountTokenFilterPolicy=1` 允许实验管理员远程 provisioning。

宿主机的下载、校验、配置、构建、生命周期和报告由 `lab.mjs` 管理。仅 ZIP 解压调用 Windows 自带 PowerShell 的 Expand-Archive；guest 内配置 Windows 服务、注册表和 VMware Tools 的小脚本仍保留 PowerShell。旧宿主机 PS1 入口及 PSD1 示例已移除，不自动迁移旧本地配置。

## 验证

```text
yarn vm:test          # 宿主机编排与控制台的单测（不启动 VM）
yarn lab:typecheck    # tests/lab-vm 这条测试道的类型检查
yarn test:vitest      # 协议驱动器的容器内用例（真实 LabService + 真实 HTTPS）
yarn vm:lab           # 完整实机验收：编译、装包、装服务、初始化、M1/M2/M4 用例、宿主机对打
yarn vm:probe <name>  # 在保留的 VM 里重放一个具名诊断脚本并打印它的输出
                      #   service-install / service-verify / installer-uninstall / manifest-digests
```

`yarn vm:lab` 的 guest 阶段现在跑三组用例，判断全部在 `guest/lab-acceptance.mjs` 里：

- **M1（S1–S14 中已实现的部分、S18）**：安装、服务注册、账户与 ACL、标准用户隔离、控制通道、激活与许可窗口、监听与指纹、重启、防火墙门控、机密扫描。
- **M2（N1–N12）**：指纹前置拒绝、会话认证的四种进入方式、入网批次与整文件语义、心跳在线/离线、试卷上传下载、作答回执幂等、维护准入、429/503 两个并发上限、租约与维护退出、多连接压测、IPv6 负例。
- **M4（U1–U5）**：同版本覆盖安装（无需升级准备）、版本变化的准入拒绝（准备缺失与目标版本不符两种形态）、经真实备份准备后的直接安装器升级、NSIS 卸载客户端保留服务与数据、运行中卸载被拒、服务卸载后重装的 serverId/回执保留。学生端安装包在本轮只做"上传成功且非空"的校验，**没有安装**。

M1 尚未实现的是 S15（停止语义与在线设备）、S16（重启后自启动）、S17（端口占用）；M3（已安装产品的 CDP GUI）未实现。因此 guest 步骤总数是 33（15 + 11 + 7），而不是文档里旧口径的 26。

协议用例走同一个打包后的 `protocol-driver.mjs`：guest 内对 `https://127.0.0.1:8443/` 跑一遍，宿主机在防火墙部署步骤之后经真实链路对 `https://<guest-ip>:8443/` 再跑一遍（N13 与 N2 的远端那一半）。驱动器只观察并打印一个 JSON，判断在阶段脚本里，因此同一批用例在容器内也能对真实服务跑（`yarn test:vitest`）。

M4 的升级用**真实备份**作为前置：`backup` 命令走教师接口创建并轮询到 `ready`，因为 `prepare-upgrade` 会校验快照时间、字节数与摘要。升级本身直接运行教师端 NSIS 安装器（验收清单的第 6 条就是"先不运行新版解包目录，直接装安装器"），由 `teacher.nsh` 的 `customInstall` 调起包内 `install-windows.ps1`，再由它请求已安装的服务准备并停止自己。

`yarn vm:test` 用模拟进程/网络覆盖下载与重试、ISO 格式与摘要校验、失败清理、凭据发布、锁、退出码和宿主机结果写入；它们不启动 Windows/VMware。真实 box 构建和 VM 生命周期需要在 Windows 宿主机上运行。
