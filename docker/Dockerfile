#
# Copyright (c) 2026 Haoting Ying (zzsqjdhqgb). All rights reserved.
# Proprietary code. Use is subject to the LICENSE file in the repository root.
#

# 使用 Node.js LTS 作为基础镜像
FROM node:24-bookworm-slim

# 设置环境变量
ENV YARN_ENABLE_GLOBAL_CACHE=true
ENV YARN_GLOBAL_FOLDER=/yarn/store

# 为 Electron safeStorage 提供固定的 D-Bus 会话和 Secret Service。
# Keyring 密码仅用于开发容器，不作为安全边界。
ENV XDG_RUNTIME_DIR=/tmp/ls101-xdg-runtime
ENV DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/ls101-session-bus
ENV LS101_DOCKER_KEYRING_PASSWORD=ls101-docker-dev

# 安装必要的系统依赖 (curl, git, sudo 等)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates git openssh-client sudo tar bzip2 \
    xvfb xauth \
    dbus dbus-x11 gnome-keyring libsecret-1-0 libsecret-tools \
    libglib2.0-0 libgtk-3-0 \
    libnss3 libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 \
    libcups2 libcairo2 libpango-1.0-0 \
    libdrm2 libgbm1 \
    libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxrandr2 libxkbcommon0 libxss1 \
    libasound2 \
    xdg-utils \
    vim python3 python3-pip python3-venv python-is-python3 build-essential pkg-config libasound2-dev libsecret-1-dev ffmpeg\
    fonts-liberation fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

RUN <<'EOF'
set -eu

cat > /usr/local/bin/ls101-container-entrypoint <<'SCRIPT'
#!/bin/sh
set -eu

mkdir -p "$XDG_RUNTIME_DIR" "$HOME/.local/share/keyrings"
chmod 700 "$XDG_RUNTIME_DIR"

# 容器重启后可能遗留旧的 socket 文件。
rm -f /tmp/ls101-session-bus

dbus-daemon \
  --session \
  --address="$DBUS_SESSION_BUS_ADDRESS" \
  --fork \
  --nopidfile

keyring_environment="$(
  printf '%s' "$LS101_DOCKER_KEYRING_PASSWORD" |
    gnome-keyring-daemon --unlock --components=secrets
)"

if [ -n "$keyring_environment" ]; then
  eval "$keyring_environment"
fi

# 提前确认 Secret Service 可写，避免到 Electron 启动后才暴露问题。
if ! secret-tool lookup application ls101-keyring-probe >/dev/null 2>&1; then
  printf 'ready' |
    secret-tool store \
      --label='LS101 Docker keyring probe' \
      application ls101-keyring-probe
fi

exec "$@"
SCRIPT

chmod 0755 /usr/local/bin/ls101-container-entrypoint
EOF

# 1. 安装并启用 yarn
RUN corepack enable && corepack prepare yarn@4.15.0

# 2. 安装 Claude Code 和 OpenAI Codex
RUN npm i -g \
    @anthropic-ai/claude-code@2.1.263 \
    @openai/codex@0.153.4

# 设置工作目录为仓库代码挂载点
WORKDIR /workspace

ENTRYPOINT ["/usr/local/bin/ls101-container-entrypoint"]

# 不指定默认 AI CLI；由 sbx-docker-codex.bat 或 sbx-docker-claude.bat 选择
# 需要时仍可通过 sbx-docker-shell.bat 进入容器 shell。
CMD ["/bin/bash"]
