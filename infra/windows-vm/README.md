# Windows 虚拟机自动化

宿主机入口是 **JavaScript + Yarn**。在 Windows x64 宿主机上，用 Packer 构建独立基础 box，再用 Vagrant 创建、关机和销毁一次性 VMware 虚拟机。

本轮实现虚拟机生命周期。`vm:cycle` 自动执行创建、等待 WinRM 就绪、关机和销毁，并在宿主机写入 JSON 结果。**尚未实现项目源码传入、guest 自动运行应用测试和测试产物导出**；生命周期成功不表示 Electron、SCM 或 UAC 测试通过。基础 box 不包含项目源码、应用依赖、应用服务或测试结果。

## 宿主机准备（一次）

- Windows x64，启用硬件虚拟化；使用原生终端，不使用 WSL。
- 安装 Node.js 22 或更新版本以及项目要求的 Yarn（根 package.json 的 packageManager）。脚本本身只使用 Node 内置模块，无需安装项目 node_modules；也可直接运行 `node infra/windows-vm/lab.mjs <操作>`。
- 安装 VMware Workstation Pro 17.x、Vagrant、Vagrant VMware Utility。Utility 是 provider 需要的宿主机服务，脚本不静默安装这些系统组件。
- 项目放在本地可写 NTFS 盘，建议至少 16 GB 内存和 100 GB 以上可用磁盘空间。默认 guest 为 4 核、8 GB、128 GB 动态磁盘。
- VMware NAT/DHCP（VMnet8）须可用。下载来源和固定版本见 [SOURCES.md](SOURCES.md)。

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
```

流程为：检查没有已存在的 Vagrant VM → 创建/启动 → 等待 WinRM → 关机 → 销毁。已有 VM（包括关机状态）时拒绝执行，避免删除调试现场。创建失败后仍尝试关机和销毁；关机失败后仍尝试销毁。任何阶段失败都会使命令返回非零，不会被后续清理成功掩盖。

每个操作在 `.local/results/<时间>-<操作>-<唯一标识>.json` 写入宿主机结果，包含步骤、起止时间、退出码及失败摘要。结果不含密码或环境变量，不是 guest 应用测试报告。外部命令的实时输出显示在终端；Packer 详细日志为 `.local/logs/packer.log`。

所有命令通过项目内状态目录和排他锁串行执行。进程被强制结束、断电或终端关闭时，无法保证 finally 清理或结果写入；可能保留 VM 和 `.local/operation.lock`。确认 Node、Packer、Vagrant 已退出后再移除该锁，随后运行 `yarn vm:status` 和 `yarn vm:destroy`。不要在另一个操作仍运行时删除锁或绕过入口直接调用 Vagrant。

## 后续应用测试流水线的边界

基础 box 保持通用。下一阶段应在 Vagrant 创建的临时 VM 中传入当次源码快照，再安装依赖、执行测试，将日志、Playwright 报告和退出码导出到宿主机 `.local/results/<run-id>/`，确认导出完成后关机、销毁。源码快照应包含当次未提交修改，并排除 .git、宿主机 node_modules、构建产物、VM 存储和本地凭据。当前 Vagrantfile 禁用共享目录，也没有 provision 应用。

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
yarn vm:test
yarn vm --help
```

单元测试使用模拟进程/网络覆盖下载与重试、ISO 格式和摘要校验、失败清理、凭据发布、锁、退出码和宿主机结果写入；它们不启动 Windows/VMware。真实 box 构建和 VM 生命周期需要在 Windows 宿主机运行上面的命令，目前未做原生实测。
