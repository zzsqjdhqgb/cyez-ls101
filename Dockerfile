#
# Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
# Proprietary code. Use is subject to the LICENSE file in the repository root.
#

# 使用 Node.js LTS 作为基础镜像
FROM node:24-slim

# 设置环境变量
ENV OPENCODE_PATH="/root/.opencode/bin"
ENV PATH="$OPENCODE_PATH:$PATH"
ENV YARN_ENABLE_GLOBAL_CACHE=true
ENV YARN_GLOBAL_FOLDER=/yarn/store

# 安装必要的系统依赖 (curl, git, sudo 等)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    openssh-client \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# 1. 安装并启用 yarn
RUN corepack enable && corepack prepare yarn@4.15.0



# 2. 安装 OpenCode (使用官方安装脚本)
RUN npm i -g opencode-ai@1.15.6

# 设置工作目录为仓库代码挂载点
WORKDIR /workspace

# 启动时默认运行 opencode
# 如果你希望启动后进入交互式 shell 但默认打开 opencode，可以改用这个命令
CMD ["/bin/bash", "-c", "yarn && opencode"]