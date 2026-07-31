#!/usr/bin/env bash
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

install -m 0755 -d /etc/apt/keyrings

curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

usermod -aG docker vagrant

ARCH="$(uname -m)"
URL="https://storage.googleapis.com/gvisor/releases/release/latest/${ARCH}"

curl -fsSL -o /usr/local/bin/runsc "${URL}/runsc"
curl -fsSL -o /usr/local/bin/runsc.sha512 "${URL}/runsc.sha512"
curl -fsSL -o /usr/local/bin/containerd-shim-runsc-v1 "${URL}/containerd-shim-runsc-v1"
curl -fsSL -o /usr/local/bin/containerd-shim-runsc-v1.sha512 "${URL}/containerd-shim-runsc-v1.sha512"

cd /usr/local/bin
sha512sum -c runsc.sha512
sha512sum -c containerd-shim-runsc-v1.sha512

rm -f runsc.sha512 containerd-shim-runsc-v1.sha512
chmod a+rx /usr/local/bin/runsc /usr/local/bin/containerd-shim-runsc-v1

mkdir -p /etc/docker

cat >/etc/docker/daemon.json <<'EOF'
{
  "runtimes": {
    "runsc": {
      "path": "/usr/local/bin/runsc",
      "runtimeArgs": [
        "--platform=systrap"
      ]
    }
  }
}
EOF

timedatectl set-ntp true || true
systemctl enable --now systemd-timesyncd || true

systemctl daemon-reload
systemctl enable docker
systemctl restart docker

docker info
docker run --rm hello-world
docker run --rm --runtime=runsc ubuntu:24.04 uname -a

docker system prune -af