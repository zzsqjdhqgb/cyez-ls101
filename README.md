<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 曹二听说101

基于 Electron、React 和 TypeScript 的英语听说考试工具，覆盖内容准备、试卷生成、考试作答、语音处理和批改结算。

> **项目状态：概念验证（PoC）**
>
> 当前版本仍在快速迭代，数据格式、界面和运行时依赖可能变化。软件不是稳定的公开发行版；请在受控环境中使用，并先备份重要数据。项目目前不接受外部代码贡献，参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 功能概览

- 试卷和模板：编辑题型、模板、函数库和评分单元，生成可运行的 .lsexam 试卷包
- 考试作答：播放文本、图片、音频和视频，支持倒计时、录音、回放和作答包导出
- 语音能力：内置 Pocket TTS；可安装 Qwen TTS、Qwen3 ASR 和发音评测扩展包
- 批改结算：导入 .lssubmission 作答包，进行人工或 AI 评分，结算批次并导出结果
- 本地数据：业务数据可放在受管理的自定义目录，应用通过 sandbox、preload 和 IPC 隔离系统访问

## 技术栈

| 类别     | 技术                               |
| -------- | ---------------------------------- |
| 桌面应用 | Electron 39                        |
| 前端     | React 19 + TypeScript              |
| 构建     | electron-vite + Vite 7             |
| 打包     | electron-builder 26                |
| 测试     | Vitest + Playwright                |
| 包管理   | Yarn 4.15.0（Node-modules linker） |

## 环境要求

- Node.js 24（CI 和发行构建使用的版本）
- Corepack，以及可访问模型下载源的网络环境
- Linux 无桌面环境运行 Electron 测试时需要 xvfb

## 开始使用

启用项目指定的 Yarn 版本并安装依赖：

```bash
corepack enable
corepack prepare yarn@4.15.0 --activate
yarn install
```

安装后的 setup 会校验或下载模型、运行时和图标资源。需要单独重新执行时：

```bash
yarn setup
```

启动开发环境：

```bash
yarn dev
```

Linux 容器或无桌面环境可使用：

```bash
yarn dev:docker
```

## 测试

常用分层测试命令：

```bash
yarn lint
yarn typecheck
yarn test:scripts
yarn test:vitest
```

Electron、renderer 组件和产品文档测试需要打包应用；Linux 无桌面环境应通过 Xvfb 运行：

```bash
xvfb-run -a yarn test:smoke
xvfb-run -a yarn test:playwright
xvfb-run -a yarn test:product-docs:run
```

完整测试入口是 `yarn test`。测试说明和失败产物位置见 [docs/testing.md](docs/testing.md)。

## 构建和分发

```bash
yarn build:test       # 当前平台 unpacked 测试包，不生成外部分发模型包
yarn build:win        # Windows 安装包
yarn build:linux      # Linux AppImage、Snap 和 deb
yarn build:release    # 发行构建流程
yarn start            # 预览已构建的 Electron 产物
```

输出位于 `dist/`。模型包和原生运行时资产可能需要额外下载，构建脚本会在缺少或校验失败时终止。发行流程的分支约定是先验证 `dev`，再合入 `main`，最后从目标版本提交创建 `vX.Y.Z` 标签。

## 项目结构

```text
src/main/                 Electron 主进程、IPC、协议和窗口管理
src/preload/              contextBridge 预加载桥
packages/                 领域包和 renderer（airouter、template-editor 等）
resources/builtin/         随应用发布的内置题型、模板和评分单元
resources/media/           提示音、头像等应用资源
scripts/                  setup、模型下载、打包和校验脚本
native/                   Qwen TTS 等原生运行时源码和补丁
tests/integration/         打包 Electron 集成测试
tests/components/          renderer 组件测试
tests/product-docs/        产品行为和文档测试
docs/                      工程文档与产品使用指南
electron-builder.yml       安装包、文件关联和额外资源配置
```

## 文件格式

应用使用 ZIP 容器保存可交换文件，并通过扩展名区分用途：

| 扩展名        | 用途                 |
| ------------- | -------------------- |
| .lsexam       | 试卷包               |
| .lsinterface  | 题型定义和题组交换包 |
| .lstemplate   | 试卷模板工作文档     |
| .lsfunclib    | 模板函数库发布包     |
| .lsschema     | 评分单元定义         |
| .lssubmission | 考生作答包           |

AI 模型、TTS runtime 和发音评测扩展使用带 manifest 和校验信息的 ZIP 包；它们不应直接放入 Git 管理的源码目录。

## 文档

- [docs/product/guide/README.md](docs/product/guide/README.md)：按内容准备、生成试卷、考试和批改组织的用户指南
- [docs/testing.md](docs/testing.md)：测试分层、命令和诊断产物
- [docs/engineering/testing/README.md](docs/engineering/testing/README.md)：Electron 测试维护约定
- [docs/engineering/qwen-tts.md](docs/engineering/qwen-tts.md)：Qwen TTS runtime 和模型包
- [docs/engineering/airouter-model-catalog.md](docs/engineering/airouter-model-catalog.md)：AI Router 模型目录

## 许可证

本项目为私有软件，使用限制和免责声明见根目录 [LICENSE](LICENSE)。未经著作权人明确授权，不得复制、修改、编译、运行或分发本项目及其编译产物。

## 第三方组件

第三方许可证随发行包放在 thirdparty-licenses/。源码仓库中的许可证文件包括 Pocket TTS、Qwen TTS、GGML、语音识别和相关模型运行时的说明。
