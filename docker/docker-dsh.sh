#!/bin/sh
set -eu

cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

# 进入 Docker 开发容器；容器内的 socat 将 0.0.0.0:3000 转发到
# dsh 的回环端口 127.0.0.1:3080。
docker compose run --rm --service-ports cyez-ls101-dev-docker \
  bash -lc '
    set -eu
    socat TCP-LISTEN:3000,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:3080 &
    proxy_pid=$!
    cleanup() {
      kill "$proxy_pid" 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM
    yarn
    exec dsh web --no-open --port 3080
  '
