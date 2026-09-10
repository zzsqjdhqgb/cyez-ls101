# 下载来源清单

以下列出这套 Packer/Vagrant 环境直接引入的全部下载项，以及后续运行应用会触发的既有下载入口。核对日期：2026-09-10。本次读取了官方页面、HTTP 头和两个 ISO 的 8 字节卷标头，没有完整下载 ISO 或执行 Windows 二进制。

## 项目内的工具和镜像

| 项目                             | 固定版本/文件                                           | 来源、核验方式                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Packer                           | `1.14.1`，`packer_1.14.1_windows_amd64.zip`             | [官方 ZIP](https://releases.hashicorp.com/packer/1.14.1/packer_1.14.1_windows_amd64.zip)、[SHA256SUMS](https://releases.hashicorp.com/packer/1.14.1/packer_1.14.1_SHA256SUMS)、[签名](https://releases.hashicorp.com/packer/1.14.1/packer_1.14.1_SHA256SUMS.sig)。解压后包含 `packer.exe`。                                                                                                           |
| Packer VMware 插件               | `github.com/hashicorp/vmware`，`1.1.0`                  | [对应源代码 tag](https://github.com/hashicorp/packer-plugin-vmware/tree/v1.1.0)、[发布页](https://github.com/hashicorp/packer-plugin-vmware/releases/tag/v1.1.0)。`packer init` 负责从其插件发行渠道取得 Windows amd64 ZIP、校验清单及插件 EXE。仓库可能重定向到 VMware 组织，核对重定向后的归属和 tag。                                                                                              |
| Packer Vagrant 插件              | `github.com/hashicorp/vagrant`，`1.1.5`                 | [源代码 tag](https://github.com/hashicorp/packer-plugin-vagrant/tree/v1.1.5)、[发布页](https://github.com/hashicorp/packer-plugin-vagrant/releases/tag/v1.1.5)。由 `packer init` 下载 Windows amd64 插件并核验发行校验清单。                                                                                                                                                                          |
| Node.js（含 npm、Corepack）      | `24.20.0`，`node-v24.20.0-win-x64.zip`                  | [官方 ZIP](https://nodejs.org/dist/v24.20.0/node-v24.20.0-win-x64.zip)、[SHASUMS256.txt](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt)、[签名](https://nodejs.org/dist/v24.20.0/SHASUMS256.txt.sig)。guest 使用其中的 `node.exe` 和 Corepack，不安装 MSI。                                                                                                                                         |
| MinGit                           | `2.49.0`，release `v2.49.0.windows.1`                   | [官方 ZIP](https://github.com/git-for-windows/git/releases/download/v2.49.0.windows.1/MinGit-2.49.0-64-bit.zip)、[官方发布页及逐文件 SHA-256](https://github.com/git-for-windows/git/releases/tag/v2.49.0.windows.1)。解压出的 `git.exe`、辅助 EXE/DLL 均来自这一包，没有再单独下载 Git 安装器。                                                                                                      |
| Windows Server ISO               | Server 2022 Evaluation，English x64，Desktop Experience | [Microsoft Evaluation Center](https://www.microsoft.com/en-us/evalcenter/evaluate-windows-server-2022)。官方下载页的 English ISO 链接解析为下方固定微软 CDN 直链，vm:prepare 自动下载并记录首次内容摘要。                                                                                                                                                                                             |
| VMware Tools ISO                 | `13.1.5-25544008`，Windows x64 ISO                      | [Broadcom 官方支持门户](https://support.broadcom.com/)、[VMware 官方 Tools 发行目录](https://packages.vmware.com/tools/releases/)。默认自动下载下方固定版本并记录首次摘要；自备 ISO 则填写经过核对的 SHA-256。guest 额外检查 ISO 内 `setup64.exe` 的 Authenticode 有效且签发给 VMware/Broadcom。安装器和驱动均由此 ISO 提供。                                                                         |
| Vagrant VMware Desktop Ruby 插件 | `vagrant-vmware-desktop` `3.0.5`                        | [RubyGems 页面](https://rubygems.org/gems/vagrant-vmware-desktop/versions/3.0.5)、[包](https://rubygems.org/downloads/vagrant-vmware-desktop-3.0.5.gem)、[官方仓库](https://github.com/hashicorp/vagrant-vmware-desktop)。由 `yarn vm:up` / `yarn vm:cycle` 按需安装到项目 `VAGRANT_HOME`，不是 Packer 插件。当前发布元数据不列额外 runtime gem 依赖；Vagrant 自带的解析器/底层库仍随其全局安装提供。 |

### 自动下载 ISO 的具体来源

- Windows Server 2022：[微软官方下载页](https://www.microsoft.com/en-us/evalcenter/download-windows-server-2022) 的 English ISO [fwlink](https://go.microsoft.com/fwlink/p/?LinkID=2195280&clcid=0x409&culture=en-us&country=US) 在本次核对时重定向到 [固定 CDN ISO](https://software-static.download.prss.microsoft.com/sg/download/888969d5-f34g-4e03-ac9d-1f9786c66749/SERVER_EVAL_x64FRE_en-us.iso)。HEAD 返回 HTTP 200、5,044,094,976 字节；默认配置固定这个地址，不在运行时追踪可变 fwlink。
- VMware Tools：[固定 13.1.5 官方目录](https://packages.vmware.com/tools/releases/13.1.5/windows/)，文件 [VMware-tools-windows-13.1.5-25544008.iso](https://packages.vmware.com/tools/releases/13.1.5/windows/VMware-tools-windows-13.1.5-25544008.iso)，目录标示约 142 MB。没有采用可变 latest 地址。
- 两个直链均通过 Range 请求读取卷描述符前 8 字节，包含 ISO-9660 的 CD001 标识；这不是完整内容验证，也没有验证内部 Windows 镜像索引或 Tools 安装兼容性。
- 默认摘要模式 auto：通过固定官方主机的 HTTPS 下载，拒绝跨主机重定向，完成后记录 SHA-256 到本地 iso-lock.json。没有查到可直接采用的独立 Windows SHA-256 清单；VMware 的 .iso.sha 是二进制块哈希格式，不能当作普通整文件 SHA-256 文本。本轮不解析该格式或验证 .sig。
- 因此首次来源信任依赖官方 HTTPS，记录的 SHA-256 仅用于后续内容锁定；不声称与发布者独立摘要/签名完成比对。明确填写 SHA-256 时，脚本会在首次下载后立即比对。guest 保留 Tools setup64.exe 的 Authenticode 检查。

已读取官方清单并填入 `config.example.json` 的值（仍请自行核对）：

```text
packer_1.14.1_windows_amd64.zip
3b9a51744e343b696a15a490500758ce1f864632878d710ed18688e221639b97

node-v24.20.0-win-x64.zip
6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba

MinGit-2.49.0-64-bit.zip
971cdee7c0feaa1e41369c46da88d1000a24e79a6f50191c820100338fb7eca5

vagrant-vmware-desktop-3.0.5.gem（RubyGems 发布元数据；安装命令未额外强制此摘要）
a023783e85163c041bb767160b924ee036b1e07bf787e957450209fd7e18dc66
```

Packer 的插件版本在 HCL 中锁定，校验由 Packer 的插件安装机制完成；本项目没有另行固定每个插件 EXE 的摘要，也没有额外实现发布者签名验证。Packer 可能根据发行元数据使用 `releases.hashicorp.com` 或 GitHub release/CDN。准备后的本机实际文件及摘要记录在 `.local/logs/asset-inventory.json`，请结合官方发布信息复核。

SHA-256 只有在预期值来自可信渠道时才能帮助验证来源。对自己刚下载的未知文件执行 `Get-FileHash`，只能记录完整性，不能证明它来自 Microsoft/Broadcom。ISO 未提供可独立验证的公开摘要时，应先确认官方取得路径、数字签名/发行记录，再记录摘要以锁定此后使用的文件；不要把本地摘要标为“官方摘要”。签名核验可参考 [HashiCorp 官方说明](https://developer.hashicorp.com/well-architected-framework/operational-excellence/verify-hashicorp-binary) 和 [Node 发布密钥](https://github.com/nodejs/node#release-keys)。本方案不为签名核验自动安装 GPG。

这些版本用于固定初始配置，不表示都是最新版本或已验证的兼容组合。升级请同时修改版本、下载摘要和对应配置。

## 必须全局安装的宿主机组件

这些安装器也可以先保存到 `.local/downloads` 供审阅，但安装后的服务、驱动及应用目录是全局的，脚本不会替你静默安装。

| 组件                   | 官方入口                                                                                                                                                                     | 安装内容                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| VMware Workstation Pro | [Broadcom 支持门户](https://support.broadcom.com/)、[VMware Desktop Hypervisor 产品页](https://www.vmware.com/products/desktop-hypervisor/workstation-and-fusion)            | Workstation、NAT/DHCP、虚拟化驱动，以及 Packer/Vagrant 使用的 `vmrun.exe`、`vmware-vdiskmanager.exe` 等。目标为 Workstation Pro 17.x。 |
| Vagrant Windows amd64  | [安装页](https://developer.hashicorp.com/vagrant/install)、[官方发行目录](https://releases.hashicorp.com/vagrant/)                                                           | Vagrant MSI、内置 Ruby 与辅助工具。选定具体版本后核验同目录的 SHA256SUMS/签名及 MSI 签名。                                             |
| Vagrant VMware Utility | [官方安装说明](https://developer.hashicorp.com/vagrant/docs/providers/vmware/vagrant-vmware-utility)、[官方发行目录](https://releases.hashicorp.com/vagrant-vmware-utility/) | 宿主机 Utility 服务和 VMware provider 所需权限操作。按官方兼容要求选择版本，核验发行摘要/签名。                                        |

PowerShell、DISM、Mount-DiskImage、Windows 安装程序等使用 Windows 自带版本；没有引入 Chocolatey、Scoop、第三方 Windows box 或 ADK 下载。

## 之后安装应用时的下载

**以下不是 Packer 构建基础 box 的步骤。** 当你在 guest 执行 `yarn install`、setup、测试或打包时，现有项目还会下载下列内容。这部分实际版本、文件名、摘要应以当前 `yarn.lock` 和资产清单为准；不能把上面的基础环境清单当作整个应用的完整二进制 SBOM。

| 内容                                                              | 下载入口/发布者                                                                                                                                                                                                                                          | 仓库内追溯位置                                                                                                                                                |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Yarn `4.15.0`                                                     | Corepack 从 Yarn 发行渠道取得，入口 [Yarn 仓库](https://github.com/yarnpkg/berry)、[Yarn 分发站](https://repo.yarnpkg.com/)                                                                                                                              | 根 `package.json` 的 `packageManager`；Node 包中的 Corepack 配置                                                                                              |
| npm 依赖及平台二进制包（包括 esbuild、sherpa-onnx 等）            | [npm registry](https://registry.npmjs.org/)，具体发布者因包而异；Yarn 也可能使用其默认 registry `https://registry.yarnpkg.com`                                                                                                                           | [yarn.lock](../../yarn.lock)、[package.json](../../package.json)、[.yarnrc.yml](../../.yarnrc.yml)                                                            |
| Electron 的 `electron.exe` 及运行时                               | [Electron 官方 releases](https://github.com/electron/electron/releases)，由 `@electron/get` 下载                                                                                                                                                         | `yarn.lock` 的 Electron 版本及其安装脚本                                                                                                                      |
| electron-builder 辅助程序（app-builder、7zip、签名工具、NSIS 等） | npm 包及 [electron-builder-binaries](https://github.com/electron-userland/electron-builder-binaries/releases)                                                                                                                                            | `yarn.lock`、electron-builder 配置；根据实际构建目标按需下载                                                                                                  |
| FFmpeg                                                            | [ffmpeg-static 项目](https://github.com/eugeneware/ffmpeg-static)、其 [二进制发行仓库](https://github.com/eugeneware/ffmpeg-static/releases)                                                                                                             | `ffmpeg-static` 安装脚本和 `yarn.lock`                                                                                                                        |
| ONNX Runtime 原生库（若所用包需要额外下载）                       | [Microsoft onnxruntime](https://github.com/microsoft/onnxruntime/releases) 及 npm 包                                                                                                                                                                     | `onnxruntime-node` 安装脚本和 `yarn.lock`                                                                                                                     |
| Playwright 浏览器（若执行浏览器安装）                             | [Playwright](https://github.com/microsoft/playwright) 配置的微软官方 CDN                                                                                                                                                                                 | Playwright 对应版本的 `browsers.json`；此基础镜像不执行 `playwright install`                                                                                  |
| WinSW `2.12.0`，`WinSW.NET461.exe`                                | [上游文件](https://github.com/winsw/winsw/releases/download/v2.12.0/WinSW.NET461.exe)                                                                                                                                                                    | [download-service-assets.mjs](../../scripts/lab/download-service-assets.mjs)，固定 SHA-256 `b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f` |
| Qwen TTS Windows helper EXE 及模型                                | [本项目 runtime release](https://github.com/zzsqjdhqgb/cyez-ls101/releases/tag/qwen-tts-runtime-v0.3.1)、[模型 release](https://github.com/zzsqjdhqgb/cyez-ls101/releases/tag/qwen-tts-model-v1.0.0)；这些是本项目发布产物，不是 Microsoft/VMware 二进制 | [qwen-tts/assets.json](../../scripts/qwen-tts/assets.json)：每个文件、SHA-256、上游源码 revision                                                              |
| Pocket TTS 模型                                                   | [Kyutai Hugging Face 仓库](https://huggingface.co/kyutai/pocket-tts-without-voice-cloning)                                                                                                                                                               | [pocket-tts-assets.json](../../scripts/pocket-tts-assets.json)：revision 和逐文件 SHA-256                                                                     |
| STT/VAD 模型                                                      | [sherpa-onnx asr-models release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)、[模型仓库](https://huggingface.co/csukuangfj2/sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25)                                                               | [stt-model-assets.json](../../scripts/stt-model-assets.json)                                                                                                  |
| 发音模型                                                          | [ONNX Community 模型仓库](https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX)                                                                                                                                                        | [pronunciation-model-assets.json](../../scripts/pronunciation-model-assets.json)：revision 和逐文件 SHA-256                                                   |

上表仓库链接相对于 `infra/windows-vm`；完整应用依赖可能随 lockfile 更新，安装脚本也可能有间接下载。首次应用安装前，可先查看这些安装脚本及 setup 的 [任务入口](../../scripts/setup.js)。Windows 自身的更新、根证书和 Defender 更新可能访问 Microsoft 服务；它们不是此模板固定的下载产物。

## 参考代码

- [Chef Bento](https://github.com/chef/bento)，主要参考 `packer_templates/pkr-builder.pkr.hcl` 和 `pkr-sources.pkr.hcl` 的流程组织。
- [Vagrant VMware provider 配置](https://github.com/hashicorp/vagrant-vmware-desktop/blob/main/lib/vagrant-vmware-desktop/config.rb)，用于确认 `clone_directory` 等配置项；此参考链接指向可变的 main 分支。
- 本地脚本自行编写，没有执行 Bento 的远程 provision 脚本，也没有采用其关闭 UAC/Defender 的部分配置。
