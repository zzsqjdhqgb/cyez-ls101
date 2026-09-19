#!/usr/bin/env sh
#
# 在 sbx 内运行，用于确认 Docker Engine 可用并找出 socket 路径。
# 用法（在 Windows 仓库根目录）：
#   docker\sbx-doctor.bat
# 或直接：
#   sbx run --name cyez-ls101-dev shell -- ./docker/sbx-docker-doctor.sh
#
set -eu

echo "== docker CLI =="
if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker CLI；请确认 sbx 使用的是 shell-docker 模板。"
  exit 1
fi
docker version || true

echo
echo "== context / endpoint =="
docker context show 2>/dev/null || true
docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true

echo
echo "== socket 路径 =="
for candidate in \
  /var/run/docker.sock \
  /run/docker.sock \
  "$HOME/.docker/run/docker.sock" \
  "${XDG_RUNTIME_DIR:-/run/user/$(id -u)}/docker.sock"
do
  if [ -S "$candidate" ]; then
    ls -l "$candidate"
  fi
done

echo
echo "== daemon 信息 =="
docker info --format 'server={{.ServerVersion}} root={{.DockerRootDir}}' 2>/dev/null || true

echo
echo "== compose 插件 =="
docker compose version 2>/dev/null || echo "docker compose 不可用"

echo
echo "== 现有容器挂载（确认 socket 是否已挂入）=="
docker inspect --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}' \
  cyez-ls101-dev-docker 2>/dev/null || true
