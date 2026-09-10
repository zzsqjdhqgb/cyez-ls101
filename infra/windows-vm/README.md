# Windows 本地服务实验虚拟机

在 **Windows x64 宿主机 + VMware Workstation** 上，用 Packer 从官方 ISO 安装 Windows，再生成本地 Vagrant box。组织方式参考 Bento 的无人值守安装、guest provisioning 和 box 导出流程；没有引用第三方预制 Windows box。

**当前状态：仅编写并静态审阅，未执行 Prepare、Packer 校验/构建、Vagrant 或 Windows 测试。** 首次 Windows 实机运行仍需验证安装时序、VMware 网络及 Tools 安装。

默认系统是 **Windows Server 2022 Evaluation 英文版、Standard Desktop Experience**，有完整桌面及真实 SCM、服务账户、ACL、UAC。用于复现服务管理问题；Windows 11 的最终兼容性仍要在 Windows 11 上验证。此模板使用 BIOS/MBR，不可直接替换为 Windows 11 ISO。

## 宿主机准备

- Windows x64，启用硬件虚拟化；使用原生 64 位 PowerShell 5.1 或 7，不在 WSL 内运行。
- 全局安装 VMware Workstation Pro 17.x、Vagrant，以及 **Vagrant VMware Utility**。Utility 是宿主机系统服务，VMware provider 需要它；只安装 Vagrant 的 Ruby 插件不够。来源见 [SOURCES.md](SOURCES.md)。版本以这些产品的兼容性说明为准，此组合尚未实测。
- 默认 guest 为 4 核、8 GB 内存、128 GB 动态虚拟磁盘。建议宿主机至少 16 GB 内存、项目盘预留 100 GB 以上空间；Packer 原始 VM、box、Vagrant box 缓存、完整克隆与快照会各占空间。
- 项目放在可写的本地 NTFS 盘。先让 VMware 正常建立 NAT 网络（VMnet8）；Packer 需要通过宿主机 NAT/DHCP 信息发现 guest 地址。

宿主机不需要全局 Packer、Node、Git、7-Zip 或 Windows ADK。脚本使用 Windows 自带 PowerShell 解压 ZIP，Packer 自行制作无人值守安装软盘。`vmrun.exe`、`vmware-vdiskmanager.exe` 等随全局 VMware 安装提供，不另行下载。

## 1. 审阅来源并配置

先逐项核对 [SOURCES.md](SOURCES.md)。以下命令都在宿主机 PowerShell 执行，起点为仓库根目录：

```powershell
Set-Location .\infra\windows-vm
Copy-Item .\config.example.psd1 .\config.local.psd1
New-Item -ItemType Directory -Path .\.local\downloads -Force
```

手动取得两个 ISO，放到配置指定位置：

1. 从 Microsoft Evaluation Center 下载 **Windows Server 2022、English、64-bit ISO**，保存为 `.local/downloads/windows-server-2022-eval.iso`。
2. 从官方 VMware/Broadcom 渠道取得适用于 Windows Server 2022 x64 的 VMware Tools `windows.iso`，保存为 `.local/downloads/windows-vmware-tools.iso`。若 Workstation 安装目录已有 `windows.iso`，可以复制过来。

在 `config.local.psd1` 填好 ISO 的 SHA-256、镜像索引和测试专用密码。Packer、Node、MinGit 的 SHA-256 已按官方文本清单填写，仍请独立核对。若修改版本，必须同步更新 hash；Packer 版本还须与 `packer/windows.pkr.hcl` 一致。

挂载 Windows ISO，在管理员 PowerShell 查看镜像索引（把 `E:` 换成实际挂载盘符）：

```powershell
dism.exe /Get-WimInfo /WimFile:E:\sources\install.wim
```

若 ISO 使用 `install.esd`，替换文件名。选择名称明确包含 **Standard Evaluation (Desktop Experience)** 的索引；默认 `2` 只是常见布局，不应盲用。检查完可弹出 ISO，Packer 会自行挂载原始文件。

密码限制为 12–64 位，包含大小写、数字及 `!#._-` 中至少一个字符，避免 XML/命令插值问题。它同时用于 guest 的 `vagrant` 管理员和内置 Administrator。不要填写实际工作账户密码。

构建会通过无人值守文件接受 Windows 许可条款，并清空**新建虚拟机的磁盘 0**。模板没有配置宿主机物理磁盘直通。Evaluation 系统有试用期限，按 Microsoft 条款使用，不分发此 box。

## 2. 下载到项目并构建

如果本机执行策略阻止脚本，可只对当前 PowerShell 进程设置：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\Prepare.ps1
.\Build.ps1 -ValidateOnly
.\Build.ps1
```

`Prepare.ps1` 下载并校验 Packer、Node、MinGit ZIP，校验本地 ISO，执行 `packer init` 安装两个固定版本插件；不创建虚拟机。也支持先手动把同名 ZIP 放进 `.local/downloads`，校验通过后复用。已有文件校验不匹配时直接报错，不静默替换。

准备后可审阅 `.local/logs/asset-inventory.json`，其中记录下载目录和工具目录文件的路径、大小及 SHA-256。它是本机资产记录，不代替发布者签名验证。

`Build.ps1 -ValidateOnly` 生成本地参数并执行 Packer 配置校验，不启动 VM。`Build.ps1` 校验后启动安装界面，配置 HTTPS WinRM、安装 VMware Tools 和便携 Node/MinGit，关闭自动登录，关机并导出 box。保留 UAC、Defender，不修改 Windows Update 服务。

已有构建目录或 box 时脚本拒绝覆盖；重建前自行归档旧产物。首次安装可能耗时较长，输出见终端和 `.local/logs/packer.log`。guest 的初始配置日志在 `C:\Windows\Temp\ls101-bootstrap.log`；卡在等待 WinRM 时先查看 VMware 控制台是否已完成 Windows 安装。

## 3. 用 Vagrant 启动

**后续所有 Vagrant 命令都经 `Lab.ps1` 执行**，否则可能使用全局 box/plugin 缓存。带选项时使用字符串数组，避免 PowerShell 吞掉参数：

```powershell
.\Lab.ps1 -VagrantArgs @('plugin', 'install', 'vagrant-vmware-desktop', '--plugin-version', '3.0.5', '--plugin-clean-sources', '--plugin-source', 'https://rubygems.org')
$boxHash = (Get-Content .\.local\boxes\ls101-windows-server-2022-vmware.box.sha256 -Raw).Trim()
.\Lab.ps1 -VagrantArgs @('box', 'add', '--name', 'ls101/windows-server-2022-local', '--provider', 'vmware_desktop', '--checksum-type', 'sha256', '--checksum', $boxHash, '.\.local\boxes\ls101-windows-server-2022-vmware.box')
.\Lab.ps1 -VagrantArgs @('up', '--provider', 'vmware_desktop')
.\Lab.ps1 status
```

Vagrantfile 也将 box 地址限定到本地产物路径。VMware 窗口会显示桌面，在控制台以 `vagrant` 和配置中的密码登录。不要修改生成文件中的密码后继续使用旧 box；密码必须与已安装系统一致。CPU/内存取自 `Build.ps1` 生成的配置。

默认只使用 VMware NAT；HTTPS WinRM 转发绑定宿主机 `127.0.0.1:55986`，端口冲突时 Vagrant 可自动调整。关闭默认 HTTP WinRM 和 RDP 转发，未启用共享目录。guest 的 HTTPS WinRM 防火墙规则允许本地子网，因此同一 VMware NAT 网络上的其他 VM 仍可能访问它。

WinRM 使用自签名证书，Packer/Vagrant 不验证其证书链，Basic 认证仅通过 HTTPS 传输。guest 设置 `LocalAccountTokenFilterPolicy=1` 让本地管理员可通过 WinRM provisioning；这会放宽本地管理员的远程令牌过滤，UAC 本身保持启用。此设置属于实验镜像配置。

## 4. 放入应用并测试

基础 box 不自动下载应用依赖，也不自动安装 LS101 服务。可用项目内 MinGit 导出当前 **已提交的 HEAD**，通过 WinRM 上传：

```powershell
# 在宿主机 infra/windows-vm 下执行；修改 MinGitVersion 后相应调整路径。
& .\.local\tools\mingit-2.49.0\cmd\git.exe -C ..\.. archive --format=zip "--output=$PWD\.local\transfers\source.zip" HEAD
.\Lab.ps1 -VagrantArgs @('upload', '.\.local\transfers\source.zip', 'C:/Windows/Temp/source.zip')
```

这个 ZIP **不含未提交修改**。测试未提交代码时，请自行制作包含相应修改的源码 ZIP；排除宿主机 `.git`、`node_modules`、`out`、`dist`、`externals`、测试产物和 `infra/windows-vm/.local`。不要把宿主机依赖或几百 GB 的虚拟机目录一起传入 guest。

在 **VMware 控制台中登录后的普通 PowerShell** 执行（不要用管理员终端启动教师端，否则会掩盖 UAC 提权问题）：

```powershell
Expand-Archive C:\Windows\Temp\source.zip C:\ls101-lab\workspace\app
Set-Location C:\ls101-lab\workspace\app
node --version
git --version
yarn install --immutable
yarn test:smoke
yarn lab:test:integration
yarn lab:dev:teacher
```

`yarn install` 会运行仓库现有 postinstall/setup，并下载应用依赖和模型，来源也列在 SOURCES 中。Windows 桌面内不使用 `xvfb-run`。Yarn 的 portable shell 支持现有 `lab:dev:teacher` 脚本中的环境变量赋值。

**现有 `tests/lab/local-service.spec.ts` 的安装/卸载 UI 用例仍使用 fixture/mock。** 换成 Windows 运行不能让这些断言覆盖真实 SCM。此轮只提供环境，没有新增真实服务自动化用例。还需在正常启动的教师端手动走完：安装及 UAC 确认、检查服务账户/文件权限、启动停止、重启系统后的自启动、卸载及再次安装，以及拒绝提权后的报错。通过 `services.msc`、实际目录及应用日志核对结果。

Electron 桌面测试应在已登录的交互桌面中运行；`vagrant winrm` 适合命令行诊断，不能据此认定桌面/UAC 流程通过。此镜像也未配置 GitHub Actions runner。

装好依赖、尚未安装服务时，可以在宿主机保存关机快照：

```powershell
.\Lab.ps1 halt
.\Lab.ps1 -VagrantArgs @('snapshot', 'save', 'before-service-install')
.\Lab.ps1 up
# 要重新试验时：回滚会丢弃快照之后 guest 内的修改，先导出需要的日志。
.\Lab.ps1 -VagrantArgs @('snapshot', 'restore', 'before-service-install')
```

用 `Lab.ps1 halt` 关机；需要删除这一台测试 VM 时执行 `Lab.ps1 destroy` 并检查 Vagrant 的确认提示。销毁 VM 不会自动删除 box、下载缓存和 Packer 原始 VM。

## 文件存放位置

以下都在 `infra/windows-vm/.local/`，已加入 gitignore：

| 子目录 | 内容 |
| --- | --- |
| `downloads` | 手动放入的 ISO、下载的 ZIP |
| `tools` | Packer、MinGit、Packer 插件 EXE |
| `cache/packer`、`config/packer`、`tmp` | Packer 缓存/配置及子进程临时文件 |
| `build/windows-server-2022` | Packer 原始 VM、VMDK、VMX |
| `boxes` | 导出的 `.box` 和 SHA-256 文件 |
| `vagrant-home` | Vagrant 插件、box 缓存、全局状态（此项目专用） |
| `vagrant-state` | 此项目的 Vagrant VM 状态 |
| `vms` | VMware provider 完整克隆的 VM 和快照 |
| `generated` | Packer 变量及 Vagrant guest 凭据 |
| `logs`、`transfers` | 构建日志、资产清单及源码传输文件 |

guest 中 Node/MinGit 在 `C:\ls101-lab\tools`，常用 Yarn/npm/Corepack/Electron/Playwright 缓存在 `C:\ls101-lab\cache`，应用及产物在 `C:\ls101-lab\workspace`，最终都属于项目内 VMDK。全局 VMware/Vagrant/Utility 的安装、驱动、服务、注册表、系统日志和 VMware 自身配置仍可能写入宿主机系统目录；这些不能靠环境变量全部移进项目。

`config.local.psd1`、生成文件、安装软盘、原始 VM 和 box 含有或可能残留测试凭据，不应提交或分享。此镜像没有 Sysprep/generalize，仅用于单台本地实验 VM，不用于加入域或部署多台正式计算机。guest 更新、快照、ISO 版本和外部插件依赖也会影响结果，这不是字节级可复现构建。

需要提交这套配置时，可在仓库根目录自行执行（本次未暂存或提交）：

```powershell
git add -- .gitignore infra/windows-vm
git commit -m "Add local Windows VMware lab with Packer and Vagrant"
```
