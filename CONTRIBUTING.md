<!--
 Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
 Proprietary code. Use is subject to the LICENSE file in the repository root.
-->

# 贡献说明

> **当前项目处于概念验证阶段，暂不接受外部代码贡献。**

本仓库的代码、模型资产、构建产物和设计文档仍在快速调整。当前不开放外部 Pull Request、代码补丁或新的功能实现，也不承诺对外部 Issue 提供支持。若未来开放贡献流程，会在此文件中补充开发协议、任务范围、审查标准和行为准则。

## 内部维护环境

- Node.js 24
- Yarn 4.15.0，通过 Corepack 激活
- Linux 无桌面环境需要 xvfb

```bash
corepack enable
corepack prepare yarn@4.15.0 --activate
yarn install
```

安装或更新模型和运行时资源：

```bash
yarn setup
```

## 内部验证

提交或合并前，维护者应按变更范围执行：

```bash
yarn lint
yarn typecheck
yarn test:scripts
yarn test:vitest
xvfb-run -a yarn test:smoke
```

涉及 Electron 集成、renderer 或产品行为时，再运行相应的完整套件：

```bash
xvfb-run -a yarn test:playwright
xvfb-run -a yarn test:product-docs:run
```

测试分层和故障诊断见 [docs/testing.md](docs/testing.md)。发布前的分支顺序是先验证 `dev`，再合入 `main`；不要在未验证的本地工作区直接创建发行标签。

## 代码边界

维护代码时请保持现有安全边界：

- 主进程负责文件系统、原生模块、窗口和 IPC；renderer 不直接使用 Node.js API
- preload 只暴露固定、最小的 contextBridge API
- 文件和模型包必须经过结构校验、路径校验和完整性校验
- 外部模型、生成目录、测试报告和本地提交包不得提交到 Git

## 许可证

本项目为私有软件，使用限制见根目录 [LICENSE](LICENSE)。任何超出许可证明确范围的使用、复制、修改、编译或分发都需要著作权人的书面许可。
